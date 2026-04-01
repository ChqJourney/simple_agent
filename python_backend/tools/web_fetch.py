import logging
import re
from html.parser import HTMLParser
from typing import Any, Optional

import httpx

from .base import BaseTool, ToolResult
from .policies import ToolExecutionPolicy

logger = logging.getLogger(__name__)

MAX_TEXT_CHARS = 80_000
MAX_RAW_BODY_BYTES = 200 * 1024

ALLOWED_SCHEMES = {"http", "https"}

STRIP_TAGS = frozenset(
    {
        "script",
        "style",
        "noscript",
        "iframe",
        "nav",
        "header",
        "footer",
        "aside",
        "form",
        "button",
        "svg",
        "math",
    }
)

SELF_CLOSING_TAGS = frozenset(
    {
        "br",
        "hr",
        "img",
        "input",
        "meta",
        "link",
        "area",
        "base",
        "col",
        "embed",
        "source",
        "track",
        "wbr",
    }
)

BLOCK_TAGS = frozenset(
    {
        "p",
        "div",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "ul",
        "ol",
        "li",
        "table",
        "tr",
        "blockquote",
        "pre",
        "figure",
        "figcaption",
        "section",
        "article",
        "main",
        "details",
        "summary",
    }
)


class _HTMLTextExtractor(HTMLParser):
    """Extract readable text from HTML, stripping scripts/styles and collapsing whitespace."""

    def __init__(self) -> None:
        super().__init__()
        self._text_parts: list[str] = []
        self._strip_depth = 0
        self._last_was_block = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        tag_lower = tag.lower()
        if tag_lower in STRIP_TAGS:
            self._strip_depth += 1
        if self._strip_depth == 0 and tag_lower in BLOCK_TAGS:
            if not self._last_was_block:
                self._text_parts.append("\n\n")
            self._last_was_block = True
        if tag_lower == "br":
            self._text_parts.append("\n")
            self._last_was_block = False

    def handle_endtag(self, tag: str) -> None:
        tag_lower = tag.lower()
        if tag_lower in STRIP_TAGS:
            self._strip_depth = max(0, self._strip_depth - 1)
        if tag_lower in BLOCK_TAGS:
            self._last_was_block = True

    def handle_data(self, data: str) -> None:
        if self._strip_depth > 0:
            return
        text = data.strip()
        if not text:
            return
        self._last_was_block = False
        self._text_parts.append(text)

    def get_text(self) -> str:
        raw = "".join(self._text_parts)
        collapsed = re.sub(r"\n{3,}", "\n\n", raw)
        return collapsed.strip()


def _extract_text_from_html(html: str) -> str:
    extractor = _HTMLTextExtractor()
    extractor.feed(html)
    return extractor.get_text()


def _validate_url(url: str) -> Optional[str]:
    """Return error string if URL is invalid, None if OK."""
    if not url or not url.strip():
        return "URL is empty"

    url_stripped = url.strip()

    try:
        parsed = httpx.URL(url_stripped)
    except Exception:
        return f"Invalid URL: {url_stripped}"

    if parsed.scheme not in ALLOWED_SCHEMES:
        return f"Unsupported scheme '{parsed.scheme}'. Only http and https are allowed."

    return None


class WebFetchTool(BaseTool):
    name = "web_fetch"
    description = (
        "Fetch content from a URL via HTTP/HTTPS. "
        "Supports two modes: 'text' (cleaned readable text extracted from HTML) and 'raw' (full HTTP response). "
        "NOTE: This tool performs simple HTTP requests and does NOT execute JavaScript. "
        "Pages that require client-side rendering (e.g. React/Vue SPAs) may return empty or incomplete content. "
        "For JS-rendered pages, consider using a headless browser tool or an external rendering service."
    )
    display_name = "Web Fetch"
    category = "general"
    read_only = True
    risk_level = "low"
    preferred_order = 50
    use_when = "Use when you need to retrieve content from a publicly accessible web page or API endpoint."
    avoid_when = "Avoid when the target page requires JavaScript rendering, authentication, or CAPTCHA solving."
    user_summary_template = "Fetching content from {url}"
    result_preview_fields = ["url", "mode", "title", "status_code"]
    tags = ["web", "fetch", "http"]
    policy = ToolExecutionPolicy(timeout_seconds=30)

    parameters: dict = {
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "URL to fetch (http or https only)",
            },
            "mode": {
                "type": "string",
                "enum": ["text", "raw"],
                "default": "text",
                "description": (
                    "Output mode. 'text': extract cleaned readable text from HTML (default). "
                    "'raw': return full HTTP response including status code, headers, and body."
                ),
            },
            "timeout_seconds": {
                "type": "integer",
                "default": 30,
                "description": "Request timeout in seconds (max 120)",
            },
            "verify_ssl": {
                "type": "boolean",
                "default": True,
                "description": "Whether to verify SSL certificates. Set to False for self-signed certs.",
            },
        },
        "required": ["url"],
    }

    async def execute(
        self,
        url: str,
        tool_call_id: str = "",
        mode: str = "text",
        timeout_seconds: int = 30,
        verify_ssl: bool = True,
        **kwargs: Any,
    ) -> ToolResult:
        url_error = _validate_url(url)
        if url_error:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=url_error,
            )

        url_stripped = url.strip()

        if mode not in ("text", "raw"):
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=f"Invalid mode '{mode}'. Must be 'text' or 'raw'.",
            )

        timeout = min(max(int(timeout_seconds), 1), 120)

        try:
            async with httpx.AsyncClient(
                timeout=timeout,
                follow_redirects=True,
                verify=verify_ssl,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0.0.0 Safari/537.36"
                    ),
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
                },
            ) as client:
                response = await client.get(url_stripped)

                if mode == "raw":
                    body_bytes = response.content
                    body_truncated = False
                    if len(body_bytes) > MAX_RAW_BODY_BYTES:
                        body_bytes = body_bytes[:MAX_RAW_BODY_BYTES]
                        body_truncated = True

                    try:
                        body_text = body_bytes.decode("utf-8", errors="replace")
                    except Exception:
                        body_text = body_bytes.decode("latin-1", errors="replace")

                    return ToolResult(
                        tool_call_id=tool_call_id,
                        tool_name=self.name,
                        success=response.status_code < 400,
                        output={
                            "mode": "raw",
                            "url": str(response.url),
                            "status_code": response.status_code,
                            "headers": dict(response.headers),
                            "body": body_text,
                            "body_truncated": body_truncated,
                        },
                    )

                html = response.text
                if response.status_code >= 400:
                    return ToolResult(
                        tool_call_id=tool_call_id,
                        tool_name=self.name,
                        success=False,
                        output=None,
                        error=f"HTTP {response.status_code} from {url_stripped}",
                    )

                title_match = re.search(
                    r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL
                )
                title = title_match.group(1).strip() if title_match else ""

                text_content = _extract_text_from_html(html)
                truncated = False
                if len(text_content) > MAX_TEXT_CHARS:
                    text_content = text_content[:MAX_TEXT_CHARS]
                    truncated = True

                if not text_content and not title:
                    logger.warning(
                        "web_fetch: empty content from %s (final_url=%s, status=%d). "
                        "Page may require JavaScript rendering.",
                        url_stripped,
                        str(response.url),
                        response.status_code,
                    )

                return ToolResult(
                    tool_call_id=tool_call_id,
                    tool_name=self.name,
                    success=True,
                    output={
                        "mode": "text",
                        "url": str(response.url),
                        "title": title,
                        "content": text_content,
                        "truncated": truncated,
                        "content_length": len(text_content),
                    },
                )

        except httpx.TimeoutException:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=f"Request timed out after {timeout} seconds",
            )
        except httpx.TooManyRedirects:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error="Too many redirects",
            )
        except httpx.HTTPError as e:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=f"HTTP error: {str(e)}",
            )
        except Exception as e:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=str(e),
            )
