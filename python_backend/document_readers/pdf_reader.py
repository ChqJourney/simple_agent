from __future__ import annotations

import contextlib
import hashlib
import io
import math
import re
import tempfile
from pathlib import Path
from dataclasses import asdict, dataclass, replace
from typing import TYPE_CHECKING, Any, Sequence

try:
    import pymupdf  # type: ignore
except Exception:  # pragma: no cover - exercised through runtime validation
    pymupdf = None

try:
    import pymupdf4llm  # type: ignore
except Exception:  # pragma: no cover - exercised through runtime validation
    pymupdf4llm = None

if TYPE_CHECKING:
    import pymupdf as pymupdf_types


_TEXT_BLOCK_TYPE = 0
_REPEATED_EDGE_RATIO_PADDING = 0.02
_REPEATED_EDGE_RATIO_MULTIPLIER = 1.5
_REPEATED_EDGE_RATIO_CAP = 0.12
_MIN_REPEATED_EDGE_PAGES = 3


@dataclass(frozen=True)
class ExtractionOptions:
    exclude_header_footer: bool = True
    header_ratio: float = 0.05
    footer_ratio: float = 0.05
    exclude_watermark: bool = True
    angle_threshold: float = 5.0
    exclude_tables: bool = True
    y_tolerance: float = 3.0


@dataclass(frozen=True)
class MarkdownOptions:
    write_images: bool = True
    embed_images: bool = False
    image_format: str = "png"
    dpi: int = 150
    force_text: bool = True
    ignore_graphics: bool = False
    detect_bg_color: bool = True
    ignore_alpha: bool = True
    table_strategy: str = "lines_strict"
    image_size_limit: float = 0.05
    graphics_limit: int | None = None
    fontsize_limit: float = 3.0
    ignore_code: bool = False
    extract_words: bool = False
    use_glyphs: bool = False


def _require_pymupdf() -> None:
    if pymupdf is None:
        raise RuntimeError("PyMuPDF is not installed. Install `pymupdf` to use PDF tools.")


def _require_pymupdf4llm() -> None:
    if pymupdf4llm is None:
        raise RuntimeError(
            "PyMuPDF4LLM is not installed. Install matching `pymupdf` and `pymupdf4llm` versions to use markdown PDF reads."
        )


def _normalize_text(text: str) -> str:
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r" ([,.:;!?])", r"\1", text)
    return text.strip()


def _normalize_page_text(lines: list[dict[str, Any]]) -> str:
    return "\n".join(line["text"] for line in lines if line["text"])


def _line_angle_degrees(line: dict[str, Any]) -> float:
    direction = line.get("dir")
    if not direction or len(direction) != 2:
        return 0.0
    dx, dy = direction
    return math.degrees(math.atan2(dy, dx))


def _bbox_intersects(a: Sequence[float], b: Sequence[float]) -> bool:
    ax0, ay0, ax1, ay1 = map(float, a)
    bx0, by0, bx1, by1 = map(float, b)
    return not (ax1 < bx0 or bx1 < ax0 or ay1 < by0 or by1 < ay0)


def _coerce_bbox(bbox: Sequence[float]) -> list[float]:
    return [round(float(value), 3) for value in bbox]


def _expanded_edge_ratio(base_ratio: float) -> float:
    return min(
        max(base_ratio * _REPEATED_EDGE_RATIO_MULTIPLIER, base_ratio + _REPEATED_EDGE_RATIO_PADDING),
        _REPEATED_EDGE_RATIO_CAP,
    )


def _edge_text_keys(text: str) -> set[str]:
    normalized = text.casefold().strip()
    if not normalized:
        return set()

    keys = {normalized}
    tokens = normalized.split()
    if not tokens:
        return keys

    if len(tokens) > 1 and re.fullmatch(r"\d+", tokens[0]):
        keys.add(" ".join(tokens[1:]))
    if len(tokens) > 1 and re.fullmatch(r"\d+", tokens[-1]):
        keys.add(" ".join(tokens[:-1]))
    if len(tokens) > 2 and re.fullmatch(r"\d+", tokens[0]) and re.fullmatch(r"\d+", tokens[-1]):
        keys.add(" ".join(tokens[1:-1]))

    return {key for key in keys if key}


def _markdown_line_text_keys(text: str) -> set[str]:
    normalized = text.strip()
    if not normalized:
        return set()

    normalized = re.sub(r"^\s{0,3}(#{1,6}|>|[-*+])\s+", "", normalized)
    normalized = re.sub(r"^\s{0,3}\d+\.\s+", "", normalized)
    normalized = normalized.strip("|` ").strip()
    return _edge_text_keys(_normalize_text(normalized))


def _collapse_blank_lines(text: str) -> str:
    collapsed = re.sub(r"\n{3,}", "\n\n", text)
    return collapsed.strip()


def _merge_visual_segments(
    segments: list[dict[str, Any]],
    *,
    y_tolerance: float,
) -> list[dict[str, Any]]:
    if not segments:
        return []

    ordered = sorted(segments, key=lambda item: (item["y"], item["x"]))
    groups: list[list[dict[str, Any]]] = []
    current_group = [ordered[0]]
    current_y = ordered[0]["y"]

    for segment in ordered[1:]:
        if abs(segment["y"] - current_y) <= y_tolerance:
            current_group.append(segment)
            current_y = min(item["y"] for item in current_group)
        else:
            groups.append(current_group)
            current_group = [segment]
            current_y = segment["y"]
    groups.append(current_group)

    merged_lines = []
    for group in groups:
        group.sort(key=lambda item: item["x"])
        text = _normalize_text(" ".join(item["text"] for item in group))
        if not text:
            continue

        x0 = min(float(item["bbox"][0]) for item in group)
        y0 = min(float(item["bbox"][1]) for item in group)
        x1 = max(float(item["bbox"][2]) for item in group)
        y1 = max(float(item["bbox"][3]) for item in group)

        merged_lines.append(
            {
                "line_number": 0,
                "text": text,
                "bbox": _coerce_bbox((x0, y0, x1, y1)),
                "angle": round(max(abs(item["angle"]) for item in group), 3),
            }
        )

    return merged_lines


def _parse_positive_int(value: str, label: str) -> int:
    if not value.strip():
        raise ValueError(f"{label} contains an empty value")
    number = int(value)
    if number < 1:
        raise ValueError(f"{label} must contain positive integers")
    return number


def parse_range_spec(
    spec: int | str | Sequence[int],
    *,
    label: str,
    max_value: int | None = None,
) -> list[int]:
    if isinstance(spec, int):
        values = [spec]
    elif isinstance(spec, str):
        parts = [part.strip() for part in spec.split(",")]
        values = []
        for part in parts:
            if not part:
                continue
            if "-" in part:
                start_text, end_text = [item.strip() for item in part.split("-", 1)]
                start = _parse_positive_int(start_text, label)
                end = _parse_positive_int(end_text, label)
                if start > end:
                    raise ValueError(f"{label} range start must be <= end: {start}-{end}")
                values.extend(range(start, end + 1))
            else:
                values.append(_parse_positive_int(part, label))
    else:
        values = []
        for item in spec:
            number = int(item)
            if number < 1:
                raise ValueError(f"{label} must contain positive integers")
            values.append(number)

    if not values:
        raise ValueError(f"{label} cannot be empty")

    normalized = sorted(set(values))
    if max_value is not None:
        invalid = [value for value in normalized if value > max_value]
        if invalid:
            singular = label[:-1] if label.endswith("s") else label
            raise ValueError(f"{label} {invalid} are out of range. Maximum {singular}: {max_value}")
    return normalized


def parse_page_spec(
    spec: int | str | Sequence[int],
    *,
    page_count: int,
) -> list[int]:
    if isinstance(spec, str):
        normalized = spec.strip().casefold()
        if normalized in {"all", "*"}:
            return list(range(1, page_count + 1))

    try:
        return parse_range_spec(spec, label="pages", max_value=page_count)
    except ValueError as exc:
        raise ValueError(
            "Invalid pages spec. Use 'all', a single page like '23', "
            "or a range like '34-40' or '1-3,8-10'."
        ) from exc


def _get_table_regions(page: "pymupdf_types.Page") -> list[list[float]]:
    regions: list[list[float]] = []
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            with contextlib.redirect_stderr(io.StringIO()):
                tables = page.find_tables()
    except Exception:
        return regions

    for table in tables:
        try:
            bbox = getattr(table, "bbox", None)
        except Exception:
            continue
        if bbox and len(bbox) == 4:
            regions.append(_coerce_bbox(bbox))
    return regions


def _default_markdown_asset_root() -> Path:
    return Path(tempfile.gettempdir()) / "work-agent-cache" / "pdf_markdown"


def _markdown_asset_dir(pdf_path: Path, page_number: int, asset_root: str | Path | None) -> Path:
    stat = pdf_path.stat()
    digest = hashlib.sha256(
        f"{pdf_path.resolve()}:{int(stat.st_size)}:{int(stat.st_mtime_ns)}".encode("utf-8")
    ).hexdigest()[:16]
    root = Path(asset_root) if asset_root is not None else _default_markdown_asset_root()
    return root / digest / f"page-{page_number}"


def _validate_markdown_options(options: MarkdownOptions) -> None:
    if options.write_images and options.embed_images:
        raise ValueError("write_images and embed_images cannot both be True")
    if options.dpi < 36:
        raise ValueError("dpi must be >= 36")
    if not 0 <= options.image_size_limit < 1:
        raise ValueError("image_size_limit must be >= 0 and < 1")
    if options.table_strategy not in {"lines_strict", "lines", "text"}:
        raise ValueError("table_strategy must be one of: lines_strict, lines, text")


class PdfReader:
    def __init__(self, pdf_path: str | Path):
        _require_pymupdf()
        self.pdf_path = Path(pdf_path)
        if not self.pdf_path.exists():
            raise FileNotFoundError(f"PDF file not found: {self.pdf_path}")
        self.doc = pymupdf.open(self.pdf_path)
        self._page_cache: dict[tuple[int, ExtractionOptions], dict[str, Any]] = {}
        self._repeated_edge_cache: dict[ExtractionOptions, dict[str, set[str]]] = {}

    def close(self) -> None:
        self.doc.close()

    def __enter__(self) -> "PdfReader":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    @property
    def page_count(self) -> int:
        return len(self.doc)

    def _validate_page_number(self, page_number: int) -> None:
        if page_number < 1 or page_number > self.page_count:
            raise ValueError(f"Page number {page_number} is out of range. Valid range: 1-{self.page_count}")

    def get_info(self) -> dict[str, Any]:
        metadata = {
            key: value
            for key, value in (self.doc.metadata or {}).items()
            if value not in (None, "")
        }
        toc = self.doc.get_toc()
        return {
            "pdf_path": str(self.pdf_path),
            "page_count": self.page_count,
            "has_outline": bool(toc),
            "outline_count": len(toc),
            "metadata": metadata,
        }

    def get_outline(self, max_depth: int | None = None) -> dict[str, Any]:
        outline_items: list[dict[str, Any]] = []
        for entry in self.doc.get_toc(simple=False):
            level, title, page_number, detail = entry
            if max_depth is not None and level > max_depth:
                continue
            detail = detail or {}
            destination = detail.get("to")
            outline_items.append(
                {
                    "level": level,
                    "title": title.strip(),
                    "page_number": page_number,
                    "dest_page_index": detail.get("page"),
                    "dest_x": round(float(destination.x), 3) if destination else None,
                    "dest_y": round(float(destination.y), 3) if destination else None,
                    "xref": detail.get("xref"),
                    "collapsed": detail.get("collapse"),
                }
            )
        return {
            "pdf_path": str(self.pdf_path),
            "page_count": self.page_count,
            "items": outline_items,
        }

    def _get_repeated_edge_texts(self, options: ExtractionOptions) -> dict[str, set[str]]:
        detection_options = replace(options, exclude_header_footer=False)
        cached = self._repeated_edge_cache.get(detection_options)
        if cached is not None:
            return cached

        page_occurrences = {"header": {}, "footer": {}}
        min_repeat_pages = 2 if self.page_count < _MIN_REPEATED_EDGE_PAGES else _MIN_REPEATED_EDGE_PAGES

        for page_number in range(1, self.page_count + 1):
            content = self._get_page_content(page_number, detection_options)
            header_limit = content["page_height"] * _expanded_edge_ratio(options.header_ratio)
            footer_limit = content["page_height"] * (1.0 - _expanded_edge_ratio(options.footer_ratio))

            seen_for_page = {"header": set(), "footer": set()}
            for line in content["lines"]:
                bbox = line["bbox"]
                line_top = float(bbox[1])
                line_bottom = float(bbox[3])
                text_keys = _edge_text_keys(line["text"])
                if not text_keys:
                    continue

                if line_top < header_limit:
                    seen_for_page["header"].update(text_keys)
                if line_bottom > footer_limit:
                    seen_for_page["footer"].update(text_keys)

            for region in ("header", "footer"):
                for text_key in seen_for_page[region]:
                    page_occurrences[region].setdefault(text_key, set()).add(page_number)

        repeated = {
            region: {
                text_key
                for text_key, pages in page_occurrences[region].items()
                if len(pages) >= min_repeat_pages
            }
            for region in ("header", "footer")
        }
        self._repeated_edge_cache[detection_options] = repeated
        return repeated

    def _get_page_content(
        self,
        page_number: int,
        options: ExtractionOptions,
    ) -> dict[str, Any]:
        self._validate_page_number(page_number)
        cache_key = (page_number, options)
        cached = self._page_cache.get(cache_key)
        if cached is not None:
            return cached

        page = self.doc[page_number - 1]
        page_rect = page.rect
        page_height = float(page_rect.height)
        header_limit = page_height * options.header_ratio if options.exclude_header_footer else 0.0
        footer_limit = page_height * (1.0 - options.footer_ratio) if options.exclude_header_footer else page_height
        repeated_header_limit = page_height * _expanded_edge_ratio(options.header_ratio)
        repeated_footer_limit = page_height * (1.0 - _expanded_edge_ratio(options.footer_ratio))
        table_regions = _get_table_regions(page) if options.exclude_tables else []
        repeated_edge_texts = (
            self._get_repeated_edge_texts(options)
            if options.exclude_header_footer
            else {"header": set(), "footer": set()}
        )

        visual_lines: list[dict[str, Any]] = []
        text_blocks: list[dict[str, Any]] = []
        text_dict = page.get_text("dict")

        for block in text_dict.get("blocks", []):
            if block.get("type") != _TEXT_BLOCK_TYPE or "lines" not in block:
                continue

            block_segments: list[dict[str, Any]] = []
            for line in block["lines"]:
                line_bbox = line.get("bbox")
                if not line_bbox or len(line_bbox) != 4:
                    continue

                if options.exclude_header_footer:
                    line_top = float(line_bbox[1])
                    line_bottom = float(line_bbox[3])
                    if line_top < header_limit or line_bottom > footer_limit:
                        continue

                angle = _line_angle_degrees(line)
                if options.exclude_watermark and abs(angle) > options.angle_threshold:
                    continue

                if options.exclude_tables and table_regions:
                    if any(_bbox_intersects(line_bbox, region) for region in table_regions):
                        continue

                spans = []
                for span in line.get("spans", []):
                    text = span.get("text", "")
                    if not text or not text.strip():
                        continue
                    span_bbox = span.get("bbox") or line_bbox
                    spans.append({"text": text, "bbox": span_bbox, "x": float(span_bbox[0])})

                if not spans:
                    continue

                spans.sort(key=lambda item: item["x"])
                line_text = _normalize_text(" ".join(span["text"] for span in spans))
                if not line_text:
                    continue

                block_segments.append(
                    {
                        "text": line_text,
                        "bbox": _coerce_bbox(line_bbox),
                        "x": float(line_bbox[0]),
                        "y": float(line_bbox[1]),
                        "angle": round(angle, 3),
                    }
                )

            block_lines = _merge_visual_segments(block_segments, y_tolerance=options.y_tolerance)
            if options.exclude_header_footer and block_lines:
                filtered_block_lines = []
                for line in block_lines:
                    bbox = line["bbox"]
                    line_top = float(bbox[1])
                    line_bottom = float(bbox[3])
                    text_keys = _edge_text_keys(line["text"])

                    if line_top < header_limit or line_bottom > footer_limit:
                        continue

                    is_repeated_header = (
                        line_top < repeated_header_limit
                        and any(key in repeated_edge_texts["header"] for key in text_keys)
                    )
                    is_repeated_footer = (
                        line_bottom > repeated_footer_limit
                        and any(key in repeated_edge_texts["footer"] for key in text_keys)
                    )
                    if is_repeated_header or is_repeated_footer:
                        continue

                    filtered_block_lines.append(line)
                block_lines = filtered_block_lines

            visual_lines.extend(block_lines)

            if block_lines:
                start_line = len(visual_lines) - len(block_lines) + 1
                end_line = len(visual_lines)
                text_blocks.append(
                    {
                        "block_number": len(text_blocks) + 1,
                        "bbox": _coerce_bbox(block["bbox"]),
                        "line_start": start_line,
                        "line_end": end_line,
                        "text": _normalize_page_text(block_lines),
                        "lines": block_lines,
                    }
                )

        for index, line in enumerate(visual_lines, start=1):
            line["line_number"] = index

        content = {
            "page_number": page_number,
            "page_width": round(float(page_rect.width), 3),
            "page_height": round(float(page_rect.height), 3),
            "total_lines": len(visual_lines),
            "table_regions": table_regions,
            "lines": visual_lines,
            "blocks": text_blocks,
            "text": _normalize_page_text(visual_lines),
        }
        self._page_cache[cache_key] = content
        return content

    def _markdown_exclusion_texts(
        self,
        page_number: int,
        options: ExtractionOptions,
    ) -> set[str]:
        raw_options = replace(
            options,
            exclude_header_footer=False,
            exclude_watermark=False,
            exclude_tables=False,
        )
        content = self._get_page_content(page_number, raw_options)
        forbidden: set[str] = set()

        if options.exclude_header_footer:
            repeated_edge_texts = self._get_repeated_edge_texts(options)
            header_limit = content["page_height"] * _expanded_edge_ratio(options.header_ratio)
            footer_limit = content["page_height"] * (1.0 - _expanded_edge_ratio(options.footer_ratio))
            for line in content["lines"]:
                bbox = line["bbox"]
                line_top = float(bbox[1])
                line_bottom = float(bbox[3])
                text_keys = _edge_text_keys(line["text"])
                if line_top < header_limit and any(key in repeated_edge_texts["header"] for key in text_keys):
                    forbidden.update(text_keys)
                if line_bottom > footer_limit and any(key in repeated_edge_texts["footer"] for key in text_keys):
                    forbidden.update(text_keys)

        if options.exclude_watermark:
            for line in content["lines"]:
                if abs(float(line.get("angle") or 0.0)) > options.angle_threshold:
                    forbidden.update(_edge_text_keys(line["text"]))

        return {item for item in forbidden if item}

    def _sanitize_markdown_text(
        self,
        text: str,
        *,
        page_number: int,
        options: ExtractionOptions,
    ) -> str:
        forbidden = self._markdown_exclusion_texts(page_number, options)
        if not forbidden:
            return _collapse_blank_lines(text)

        kept_lines: list[str] = []
        for line in text.splitlines():
            line_keys = _markdown_line_text_keys(line)
            if line_keys and any(key in forbidden for key in line_keys):
                continue
            kept_lines.append(line)
        return _collapse_blank_lines("\n".join(kept_lines))

    def _get_page_markdown(
        self,
        page_number: int,
        *,
        options: ExtractionOptions,
        markdown_options: MarkdownOptions,
        asset_root: str | Path | None = None,
    ) -> dict[str, Any]:
        _require_pymupdf4llm()
        _validate_markdown_options(markdown_options)
        self._validate_page_number(page_number)

        page = self.doc[page_number - 1]
        image_dir: Path | None = None
        image_path = ""
        if markdown_options.write_images and not markdown_options.embed_images:
            image_dir = _markdown_asset_dir(self.pdf_path, page_number, asset_root)
            image_dir.mkdir(parents=True, exist_ok=True)
            image_path = str(image_dir)

        margin_top = float(page.rect.height) * options.header_ratio if options.exclude_header_footer else 0.0
        margin_bottom = float(page.rect.height) * options.footer_ratio if options.exclude_header_footer else 0.0
        chunk_list = pymupdf4llm.helpers.pymupdf_rag.to_markdown(
            self.doc,
            pages=[page_number - 1],
            page_chunks=True,
            write_images=markdown_options.write_images and not markdown_options.embed_images,
            embed_images=markdown_options.embed_images,
            image_path=image_path,
            image_format=markdown_options.image_format,
            image_size_limit=markdown_options.image_size_limit,
            filename=str(self.pdf_path),
            force_text=markdown_options.force_text,
            margins=(0.0, margin_top, 0.0, margin_bottom),
            dpi=markdown_options.dpi,
            table_strategy=markdown_options.table_strategy,
            graphics_limit=markdown_options.graphics_limit,
            fontsize_limit=markdown_options.fontsize_limit,
            ignore_code=markdown_options.ignore_code,
            extract_words=markdown_options.extract_words,
            show_progress=False,
            use_glyphs=markdown_options.use_glyphs,
            ignore_alpha=markdown_options.ignore_alpha,
            ignore_graphics=markdown_options.ignore_graphics,
            detect_bg_color=markdown_options.detect_bg_color,
        )
        chunk = chunk_list[0] if chunk_list else {}
        metadata = dict(chunk.get("metadata") or {})
        markdown_text = self._sanitize_markdown_text(
            str(chunk.get("text") or ""),
            page_number=page_number,
            options=options,
        )

        return {
            "page_number": int(metadata.get("page") or page_number),
            "page_width": round(float(page.rect.width), 3),
            "page_height": round(float(page.rect.height), 3),
            "total_lines": len(markdown_text.splitlines()),
            "text": markdown_text,
            "format": "markdown",
            "metadata": metadata,
            "toc_items": list(chunk.get("toc_items") or []),
            "tables": list(chunk.get("tables") or []),
            "images": list(chunk.get("images") or []),
            "graphics": list(chunk.get("graphics") or []),
            "words": list(chunk.get("words") or []),
            "image_directory": str(image_dir) if image_dir is not None else None,
        }

    def read_pages(
        self,
        pages: int | str | Sequence[int],
        *,
        mode: str = "page_text",
        options: ExtractionOptions | None = None,
        markdown_options: MarkdownOptions | None = None,
        asset_root: str | Path | None = None,
    ) -> dict[str, Any]:
        options = options or ExtractionOptions()
        page_numbers = parse_page_spec(pages, page_count=self.page_count)
        allowed_modes = {"page_text", "visual_lines", "blocks", "markdown"}
        if mode not in allowed_modes:
            raise ValueError(f"Unsupported mode: {mode}. Supported modes: {sorted(allowed_modes)}")

        items = []
        for page_number in page_numbers:
            if mode == "markdown":
                page_item = self._get_page_markdown(
                    page_number,
                    options=options,
                    markdown_options=markdown_options or MarkdownOptions(),
                    asset_root=asset_root,
                )
            else:
                content = self._get_page_content(page_number, options)
                page_item = {
                    "page_number": page_number,
                    "page_width": content["page_width"],
                    "page_height": content["page_height"],
                    "total_lines": content["total_lines"],
                }
                if mode == "page_text":
                    page_item["text"] = content["text"]
                elif mode == "visual_lines":
                    page_item["lines"] = content["lines"]
                else:
                    page_item["blocks"] = content["blocks"]
            items.append(page_item)

        result = {
            "pdf_path": str(self.pdf_path),
            "page_count": self.page_count,
            "pages": page_numbers,
            "mode": mode,
            "filters": asdict(options),
            "items": items,
        }
        if mode == "markdown":
            result["markdown"] = asdict(markdown_options or MarkdownOptions())
        return result

    def read_lines(
        self,
        page: int,
        lines: str | Sequence[int],
        *,
        include_context: int = 0,
        options: ExtractionOptions | None = None,
    ) -> dict[str, Any]:
        options = options or ExtractionOptions()
        content = self._get_page_content(page, options)
        requested = parse_range_spec(lines, label="lines", max_value=content["total_lines"])
        requested_set = set(requested)

        if include_context < 0:
            raise ValueError("include_context must be >= 0")

        selected_numbers: set[int] = set(requested)
        if include_context:
            for number in requested:
                start = max(1, number - include_context)
                end = min(content["total_lines"], number + include_context)
                selected_numbers.update(range(start, end + 1))

        selected_items = []
        for line in content["lines"]:
            if line["line_number"] not in selected_numbers:
                continue
            selected_items.append({**line, "requested": line["line_number"] in requested_set})

        return {
            "pdf_path": str(self.pdf_path),
            "page_count": self.page_count,
            "page_number": page,
            "requested_lines": requested,
            "include_context": include_context,
            "total_lines": content["total_lines"],
            "filters": asdict(options),
            "items": selected_items,
        }

    def search(
        self,
        query: str,
        *,
        top_k: int = 5,
        search_mode: str = "page",
        max_pages: int | None = None,
        options: ExtractionOptions | None = None,
    ) -> dict[str, Any]:
        if not query or not query.strip():
            raise ValueError("query cannot be empty")
        if top_k < 1:
            raise ValueError("top_k must be >= 1")
        if max_pages is not None and max_pages < 1:
            raise ValueError("max_pages must be >= 1")

        options = options or ExtractionOptions()
        query_normalized = query.casefold().strip()
        items: list[dict[str, Any]] = []
        page_numbers = list(range(1, self.page_count + 1))
        if max_pages is not None:
            page_numbers = page_numbers[:max_pages]

        if search_mode == "page":
            for page_number in page_numbers:
                content = self._get_page_content(page_number, options)
                text = content["text"]
                match_count = text.casefold().count(query_normalized)
                if not match_count:
                    continue
                lines = [line["text"] for line in content["lines"] if query_normalized in line["text"].casefold()]
                snippet = "\n".join(lines[:3]) if lines else text[:400]
                items.append(
                    {
                        "page_number": page_number,
                        "match_count": match_count,
                        "snippet": snippet,
                    }
                )
            items.sort(key=lambda item: (-item["match_count"], item["page_number"]))
        elif search_mode == "line":
            for page_number in page_numbers:
                content = self._get_page_content(page_number, options)
                for line in content["lines"]:
                    if query_normalized in line["text"].casefold():
                        items.append(
                            {
                                "page_number": page_number,
                                "line_number": line["line_number"],
                                "text": line["text"],
                                "bbox": line["bbox"],
                            }
                        )
                        if len(items) >= top_k:
                            break
                if len(items) >= top_k:
                    break
        else:
            raise ValueError("search_mode must be 'page' or 'line'")

        return {
            "pdf_path": str(self.pdf_path),
            "page_count": self.page_count,
            "scanned_pages": len(page_numbers),
            "query": query,
            "search_mode": search_mode,
            "top_k": top_k,
            "max_pages": max_pages,
            "filters": asdict(options),
            "items": items[:top_k],
        }

    def render_pages_to_images(
        self,
        pages: int | str | Sequence[int],
        *,
        output_dir: str | Path,
        dpi: int = 144,
        image_format: str = "png",
    ) -> dict[str, Any]:
        page_numbers = parse_page_spec(pages, page_count=self.page_count)
        try:
            normalized_dpi = int(dpi)
        except (TypeError, ValueError):
            raise ValueError("dpi must be an integer")
        if normalized_dpi < 36:
            raise ValueError("dpi must be >= 36")

        normalized_format = str(image_format or "png").strip().lower()
        if normalized_format != "png":
            raise ValueError("Only png image output is currently supported")

        output_root = Path(output_dir)
        output_root.mkdir(parents=True, exist_ok=True)
        scale = normalized_dpi / 72.0
        matrix = pymupdf.Matrix(scale, scale)

        items: list[dict[str, Any]] = []
        for page_number in page_numbers:
            self._validate_page_number(page_number)
            page = self.doc[page_number - 1]
            pixmap = page.get_pixmap(matrix=matrix, alpha=False)
            image_path = output_root / f"page-{page_number}.{normalized_format}"
            pixmap.save(str(image_path))
            items.append(
                {
                    "page_number": page_number,
                    "image_path": str(image_path),
                    "width": int(pixmap.width),
                    "height": int(pixmap.height),
                    "dpi": normalized_dpi,
                    "image_format": normalized_format,
                }
            )

        return {
            "pdf_path": str(self.pdf_path),
            "page_count": self.page_count,
            "pages": page_numbers,
            "dpi": normalized_dpi,
            "image_format": normalized_format,
            "items": items,
        }


def get_pdf_info(pdf_path: str | Path) -> dict[str, Any]:
    with PdfReader(pdf_path) as reader:
        return reader.get_info()


def get_pdf_outline(pdf_path: str | Path, max_depth: int | None = None) -> dict[str, Any]:
    with PdfReader(pdf_path) as reader:
        return reader.get_outline(max_depth=max_depth)


def read_pdf_pages(
    pdf_path: str | Path,
    pages: int | str | Sequence[int],
    *,
    mode: str = "page_text",
    exclude_header_footer: bool = True,
    header_ratio: float = 0.05,
    footer_ratio: float = 0.05,
    exclude_watermark: bool = True,
    angle_threshold: float = 5.0,
    exclude_tables: bool = True,
    y_tolerance: float = 3.0,
    write_images: bool = True,
    embed_images: bool = False,
    image_format: str = "png",
    dpi: int = 150,
    force_text: bool = True,
    ignore_graphics: bool = False,
    detect_bg_color: bool = True,
    ignore_alpha: bool = True,
    table_strategy: str = "lines_strict",
    image_size_limit: float = 0.05,
    graphics_limit: int | None = None,
    fontsize_limit: float = 3.0,
    ignore_code: bool = False,
    extract_words: bool = False,
    use_glyphs: bool = False,
    asset_root: str | Path | None = None,
) -> dict[str, Any]:
    options = ExtractionOptions(
        exclude_header_footer=exclude_header_footer,
        header_ratio=header_ratio,
        footer_ratio=footer_ratio,
        exclude_watermark=exclude_watermark,
        angle_threshold=angle_threshold,
        exclude_tables=exclude_tables,
        y_tolerance=y_tolerance,
    )
    markdown_options = MarkdownOptions(
        write_images=write_images,
        embed_images=embed_images,
        image_format=image_format,
        dpi=dpi,
        force_text=force_text,
        ignore_graphics=ignore_graphics,
        detect_bg_color=detect_bg_color,
        ignore_alpha=ignore_alpha,
        table_strategy=table_strategy,
        image_size_limit=image_size_limit,
        graphics_limit=graphics_limit,
        fontsize_limit=fontsize_limit,
        ignore_code=ignore_code,
        extract_words=extract_words,
        use_glyphs=use_glyphs,
    )
    with PdfReader(pdf_path) as reader:
        return reader.read_pages(
            pages,
            mode=mode,
            options=options,
            markdown_options=markdown_options,
            asset_root=asset_root,
        )


def read_pdf_lines(
    pdf_path: str | Path,
    page_number: int,
    line_numbers: str | Sequence[int],
    *,
    include_context: int = 0,
    exclude_header_footer: bool = True,
    header_ratio: float = 0.05,
    footer_ratio: float = 0.05,
    exclude_watermark: bool = True,
    angle_threshold: float = 5.0,
    exclude_tables: bool = True,
    y_tolerance: float = 3.0,
) -> dict[str, Any]:
    options = ExtractionOptions(
        exclude_header_footer=exclude_header_footer,
        header_ratio=header_ratio,
        footer_ratio=footer_ratio,
        exclude_watermark=exclude_watermark,
        angle_threshold=angle_threshold,
        exclude_tables=exclude_tables,
        y_tolerance=y_tolerance,
    )
    with PdfReader(pdf_path) as reader:
        return reader.read_lines(page=page_number, lines=line_numbers, include_context=include_context, options=options)


def search_pdf(
    pdf_path: str | Path,
    query: str,
    *,
    top_k: int = 5,
    search_mode: str = "page",
    max_pages: int | None = None,
    exclude_header_footer: bool = True,
    header_ratio: float = 0.05,
    footer_ratio: float = 0.05,
    exclude_watermark: bool = True,
    angle_threshold: float = 5.0,
    exclude_tables: bool = True,
    y_tolerance: float = 3.0,
) -> dict[str, Any]:
    options = ExtractionOptions(
        exclude_header_footer=exclude_header_footer,
        header_ratio=header_ratio,
        footer_ratio=footer_ratio,
        exclude_watermark=exclude_watermark,
        angle_threshold=angle_threshold,
        exclude_tables=exclude_tables,
        y_tolerance=y_tolerance,
    )
    with PdfReader(pdf_path) as reader:
        return reader.search(
            query,
            top_k=top_k,
            search_mode=search_mode,
            max_pages=max_pages,
            options=options,
        )


def render_pdf_pages_to_images(
    pdf_path: str | Path,
    pages: int | str | Sequence[int],
    *,
    output_dir: str | Path,
    dpi: int = 144,
    image_format: str = "png",
) -> dict[str, Any]:
    with PdfReader(pdf_path) as reader:
        return reader.render_pages_to_images(
            pages,
            output_dir=output_dir,
            dpi=dpi,
            image_format=image_format,
        )
