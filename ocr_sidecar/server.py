from __future__ import annotations

import argparse
import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Iterable

import uvicorn
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger("ocr_sidecar")
AUTH_HEADER_NAME = "x-work-agent-ocr-auth"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8790
DEFAULT_LANGUAGE = "ch"
SUPPORTED_DETAIL_LEVELS = {"text", "lines", "blocks"}


class HealthResponse(BaseModel):
    status: str
    engine: str = "paddle"
    version: str = "0.1.0"
    api_version: int = 1
    warmed_languages: list[str] = Field(default_factory=list)


class ImageOcrRequest(BaseModel):
    image_path: str = Field(description="Absolute path to an image file on the local machine.")
    lang: str = Field(default=DEFAULT_LANGUAGE, description="Paddle OCR language code, for example 'ch' or 'en'.")
    detail_level: str = Field(
        default="lines",
        description="Return shape: text, lines, or blocks. All levels include the flattened text.",
    )


class OcrLine(BaseModel):
    text: str
    bbox: list[float]
    score: float | None = None


class ImageOcrResponse(BaseModel):
    success: bool
    text: str
    lines: list[OcrLine] = Field(default_factory=list)
    blocks: list[dict[str, Any]] = Field(default_factory=list)
    elapsed_ms: int
    model: dict[str, Any]


class PaddleOcrEngineCache:
    def __init__(self) -> None:
        self._engines: dict[str, Any] = {}
        self._lock = threading.RLock()

    def warmed_languages(self) -> list[str]:
        with self._lock:
            return sorted(self._engines.keys())

    def get_engine(self, lang: str) -> Any:
        normalized_lang = (lang or DEFAULT_LANGUAGE).strip() or DEFAULT_LANGUAGE

        with self._lock:
            existing = self._engines.get(normalized_lang)
            if existing is not None:
                return existing

            engine = self._create_engine(normalized_lang)
            self._engines[normalized_lang] = engine
            return engine

    @staticmethod
    def _create_engine(lang: str) -> Any:
        try:
            from paddleocr import PaddleOCR  # type: ignore
        except Exception as exc:  # pragma: no cover - exercised in Windows runtime
            raise RuntimeError(
                "PaddleOCR is not installed. Build the OCR sidecar with paddleocr and paddlepaddle included."
            ) from exc

        candidate_kwargs: list[dict[str, Any]] = [
            {
                "lang": lang,
                "use_doc_orientation_classify": False,
                "use_doc_unwarping": False,
                "use_textline_orientation": False,
            },
            {
                "lang": lang,
                "use_angle_cls": False,
                "show_log": False,
            },
            {
                "lang": lang,
            },
        ]

        last_error: Exception | None = None
        for kwargs in candidate_kwargs:
            try:
                logger.info("Initializing PaddleOCR engine with kwargs=%s", kwargs)
                return PaddleOCR(**kwargs)
            except TypeError as exc:
                last_error = exc
                continue

        if last_error is not None:
            raise RuntimeError(f"Failed to initialize PaddleOCR for lang={lang}: {last_error}") from last_error
        raise RuntimeError(f"Failed to initialize PaddleOCR for lang={lang}")


def _coerce_sequence(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    to_list = getattr(value, "tolist", None)
    if callable(to_list):
        converted = to_list()
        if isinstance(converted, list):
            return converted
    return [value]


def _extract_value(item: Any, *keys: str) -> Any:
    for key in keys:
        if isinstance(item, dict) and key in item:
            return item[key]
        if hasattr(item, key):
            return getattr(item, key)
    return None


def _bbox_from_polygon(polygon: Any) -> list[float]:
    points = _coerce_sequence(polygon)
    xs: list[float] = []
    ys: list[float] = []

    for point in points:
        coords = _coerce_sequence(point)
        if len(coords) < 2:
            continue
        try:
            xs.append(float(coords[0]))
            ys.append(float(coords[1]))
        except (TypeError, ValueError):
            continue

    if not xs or not ys:
        return [0.0, 0.0, 0.0, 0.0]

    return [min(xs), min(ys), max(xs), max(ys)]


def _parse_legacy_ocr_result(raw_result: Any) -> list[dict[str, Any]]:
    pages = _coerce_sequence(raw_result)
    if pages and not isinstance(pages[0], (list, tuple)):
        pages = [pages]

    parsed_pages: list[dict[str, Any]] = []
    for page_index, page in enumerate(pages, start=1):
        lines: list[dict[str, Any]] = []
        for item in _coerce_sequence(page):
            parts = _coerce_sequence(item)
            if len(parts) < 2:
                continue

            polygon = parts[0]
            text_score = _coerce_sequence(parts[1])
            text = str(text_score[0]) if text_score else ""
            score: float | None = None
            if len(text_score) > 1:
                try:
                    score = float(text_score[1])
                except (TypeError, ValueError):
                    score = None

            if not text.strip():
                continue

            lines.append(
                {
                    "text": text,
                    "bbox": _bbox_from_polygon(polygon),
                    "score": score,
                }
            )

        parsed_pages.append({"page_number": page_index, "lines": lines})

    return parsed_pages


def _parse_predict_page(page_result: Any, page_index: int) -> dict[str, Any]:
    container = _extract_value(page_result, "res")
    if container is None:
        container = page_result

    texts = _coerce_sequence(_extract_value(container, "rec_texts", "texts"))
    scores = _coerce_sequence(_extract_value(container, "rec_scores", "scores"))
    polygons = _coerce_sequence(_extract_value(container, "dt_polys", "polys", "boxes"))

    line_count = min(len(texts), len(polygons)) if polygons else len(texts)
    lines: list[dict[str, Any]] = []
    for index in range(line_count):
        text = str(texts[index] or "")
        if not text.strip():
            continue

        score: float | None = None
        if index < len(scores):
            try:
                score = float(scores[index])
            except (TypeError, ValueError):
                score = None

        polygon = polygons[index] if index < len(polygons) else []
        lines.append(
            {
                "text": text,
                "bbox": _bbox_from_polygon(polygon),
                "score": score,
            }
        )

    return {"page_number": page_index, "lines": lines}


def _parse_predict_result(raw_result: Any) -> list[dict[str, Any]]:
    pages = _coerce_sequence(raw_result)
    return [_parse_predict_page(page_result, page_index) for page_index, page_result in enumerate(pages, start=1)]


def _flatten_text(lines: Iterable[dict[str, Any]]) -> str:
    return "\n".join(str(item.get("text") or "") for item in lines if str(item.get("text") or "").strip())


def _build_blocks(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not lines:
        return []

    return [
        {
            "text": _flatten_text(lines),
            "bbox": [
                min(float(item["bbox"][0]) for item in lines),
                min(float(item["bbox"][1]) for item in lines),
                max(float(item["bbox"][2]) for item in lines),
                max(float(item["bbox"][3]) for item in lines),
            ],
            "line_count": len(lines),
        }
    ]


def _run_ocr(engine_cache: PaddleOcrEngineCache, image_path: Path, lang: str) -> list[dict[str, Any]]:
    engine = engine_cache.get_engine(lang)

    if hasattr(engine, "predict"):
        raw_result = engine.predict(str(image_path))
        parsed = _parse_predict_result(raw_result)
        if any(page["lines"] for page in parsed):
            return parsed

    if hasattr(engine, "ocr"):
        raw_result = engine.ocr(str(image_path), cls=False)
        parsed = _parse_legacy_ocr_result(raw_result)
        if any(page["lines"] for page in parsed):
            return parsed

    raise RuntimeError("PaddleOCR did not return any parseable OCR output.")


def create_app(auth_token: str | None = None, warmup_langs: list[str] | None = None) -> FastAPI:
    engine_cache = PaddleOcrEngineCache()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        for lang in warmup_langs or []:
            try:
                engine_cache.get_engine(lang)
            except Exception:
                logger.exception("Failed to warm OCR engine for lang=%s", lang)
                raise
        yield

    app = FastAPI(title="Work Agent OCR Sidecar", version="0.1.0", lifespan=lifespan)
    app.state.auth_token = auth_token.strip() if auth_token else ""
    app.state.engine_cache = engine_cache

    def ensure_authorized(header_value: str | None) -> None:
        expected_token = str(app.state.auth_token or "")
        if not expected_token:
            return
        provided = (header_value or "").strip()
        if provided != expected_token:
            raise HTTPException(status_code=401, detail="Invalid OCR sidecar auth token")

    @app.get("/health", response_model=HealthResponse)
    async def health(
        x_work_agent_ocr_auth: str | None = Header(default=None, alias=AUTH_HEADER_NAME),
    ) -> HealthResponse:
        ensure_authorized(x_work_agent_ocr_auth)
        return HealthResponse(
            status="ok",
            warmed_languages=app.state.engine_cache.warmed_languages(),
        )

    @app.post("/ocr/image", response_model=ImageOcrResponse)
    async def ocr_image(
        request: ImageOcrRequest,
        x_work_agent_ocr_auth: str | None = Header(default=None, alias=AUTH_HEADER_NAME),
    ) -> ImageOcrResponse:
        ensure_authorized(x_work_agent_ocr_auth)

        detail_level = (request.detail_level or "lines").strip().lower()
        if detail_level not in SUPPORTED_DETAIL_LEVELS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported detail_level '{request.detail_level}'. Expected one of {sorted(SUPPORTED_DETAIL_LEVELS)}.",
            )

        image_path = Path(request.image_path)
        if not image_path.exists():
            raise HTTPException(status_code=404, detail=f"Image file not found: {image_path}")
        if not image_path.is_file():
            raise HTTPException(status_code=400, detail=f"Path is not a file: {image_path}")

        started = time.perf_counter()
        try:
            pages = _run_ocr(app.state.engine_cache, image_path, request.lang)
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("OCR failed for image=%s lang=%s", image_path, request.lang)
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        lines = [
            OcrLine(text=line["text"], bbox=line["bbox"], score=line.get("score"))
            for page in pages
            for line in page["lines"]
        ]
        blocks = _build_blocks([line.model_dump(mode="python") for line in lines])

        if detail_level == "text":
            response_lines: list[OcrLine] = []
            response_blocks: list[dict[str, Any]] = []
        elif detail_level == "blocks":
            response_lines = []
            response_blocks = blocks
        else:
            response_lines = lines
            response_blocks = blocks

        return ImageOcrResponse(
            success=True,
            text=_flatten_text(line.model_dump(mode="python") for line in lines),
            lines=response_lines,
            blocks=response_blocks,
            elapsed_ms=int((time.perf_counter() - started) * 1000),
            model={
                "engine": "paddle",
                "lang": (request.lang or DEFAULT_LANGUAGE).strip() or DEFAULT_LANGUAGE,
            },
        )

    return app


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the Work Agent OCR sidecar.")
    parser.add_argument("--host", default=os.environ.get("WORK_AGENT_OCR_HOST", DEFAULT_HOST))
    parser.add_argument("--port", type=int, default=int(os.environ.get("WORK_AGENT_OCR_PORT", DEFAULT_PORT)))
    parser.add_argument("--auth-token", default=os.environ.get("WORK_AGENT_OCR_AUTH_TOKEN", ""))
    parser.add_argument(
        "--warmup-lang",
        action="append",
        default=[],
        help="Optional language code to initialize during startup. Can be supplied multiple times.",
    )
    parser.add_argument("--log-level", default=os.environ.get("WORK_AGENT_OCR_LOG_LEVEL", "info"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    logging.basicConfig(
        level=getattr(logging, str(args.log_level).upper(), logging.INFO),
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )
    app = create_app(
        auth_token=str(args.auth_token or ""),
        warmup_langs=[str(item).strip() for item in args.warmup_lang if str(item).strip()],
    )
    uvicorn.run(app, host=args.host, port=int(args.port))


if __name__ == "__main__":
    main()
