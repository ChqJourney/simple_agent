from __future__ import annotations

import argparse
import os
import shutil
from pathlib import Path
from typing import Any


DEFAULT_LANGUAGES = ("ch", "en")
DEFAULT_MODEL_SOURCE = "BOS"


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download and stage PaddleOCR models into a local sidecar models directory.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("models"),
        help="Directory where language-specific OCR models should be stored.",
    )
    parser.add_argument(
        "--languages",
        nargs="+",
        default=list(DEFAULT_LANGUAGES),
        help="PaddleOCR language codes to pre-download.",
    )
    return parser.parse_args()


def _is_non_empty_dir(path: Path) -> bool:
    return path.is_dir() and any(path.iterdir())


def _language_model_roots(base_dir: Path, lang: str) -> tuple[Path, Path]:
    language_root = base_dir / lang
    return (
        language_root / "text_detection",
        language_root / "text_recognition",
    )


def _cache_roots() -> list[Path]:
    candidates = [
        Path.home() / ".paddlex" / "official_models",
        Path.home() / ".paddleocr" / "whl",
    ]
    return [path for path in candidates if path.exists()]


def _normalize_model_path(value: Any) -> Path | None:
    if value is None:
        return None

    if isinstance(value, (str, os.PathLike)):
        candidate = Path(value)
        if candidate.name.lower() == "inference.yml":
            candidate = candidate.parent
        if candidate.exists():
            return candidate

    model_dir = getattr(value, "model_dir", None)
    if model_dir:
        normalized = _normalize_model_path(model_dir)
        if normalized is not None:
            return normalized

    config = getattr(value, "config", None)
    if config is not None:
        normalized = _normalize_model_path(config)
        if normalized is not None:
            return normalized

    for attr_name in ("path", "model_path", "inference_model_dir", "inference_model_path"):
        attr_value = getattr(value, attr_name, None)
        if attr_value:
            normalized = _normalize_model_path(attr_value)
            if normalized is not None:
                return normalized

    return None


def _copy_tree_contents(source: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    for child in source.iterdir():
        target = destination / child.name
        if child.is_dir():
            shutil.copytree(child, target, dirs_exist_ok=True)
        else:
            shutil.copy2(child, target)


def _copy_model_dir(source: Path, destination: Path) -> None:
    if not source.exists():
        raise RuntimeError(f"Model source directory does not exist: {source}")
    if not (source / "inference.yml").exists():
        raise RuntimeError(f"Model source directory is missing inference.yml: {source}")

    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True, exist_ok=True)
    _copy_tree_contents(source, destination)


def _iter_object_values(value: Any) -> list[Any]:
    values: list[Any] = []

    if isinstance(value, dict):
        values.extend(value.values())
        return values

    if isinstance(value, (list, tuple, set)):
        values.extend(value)
        return values

    for attr_name in dir(value):
        if attr_name.startswith("_"):
            continue
        try:
            attr_value = getattr(value, attr_name)
        except Exception:
            continue
        if callable(attr_value):
            continue
        values.append(attr_value)

    return values


def _discover_model_dirs_from_engine(engine: Any) -> tuple[Path | None, Path | None]:
    cache_roots = _cache_roots()
    if not cache_roots:
        return None, None

    det_dir: Path | None = None
    rec_dir: Path | None = None
    visited: set[int] = set()
    queue: list[Any] = [engine]

    while queue and (det_dir is None or rec_dir is None):
        current = queue.pop(0)
        current_id = id(current)
        if current_id in visited:
            continue
        visited.add(current_id)

        normalized = _normalize_model_path(current)
        if normalized is not None:
            normalized_resolved = normalized.resolve()
            is_in_cache = any(
                normalized_resolved == cache_root.resolve()
                or cache_root.resolve() in normalized_resolved.parents
                for cache_root in cache_roots
            )
            if is_in_cache:
                name = normalized_resolved.name.lower()
                if "det" in name and det_dir is None:
                    det_dir = normalized_resolved
                elif "rec" in name and rec_dir is None:
                    rec_dir = normalized_resolved

        queue.extend(_iter_object_values(current))

    return det_dir, rec_dir


def _find_latest_cache_model(kind: str) -> Path | None:
    matches: list[Path] = []
    for cache_root in _cache_roots():
        for candidate in cache_root.rglob("inference.yml"):
            parent = candidate.parent
            name = parent.name.lower()
            if kind in name:
                matches.append(parent)

    if not matches:
        return None

    matches.sort(key=lambda item: item.stat().st_mtime, reverse=True)
    return matches[0]


def _resolve_model_dirs(engine: Any) -> tuple[Path, Path]:
    det_dir, rec_dir = _discover_model_dirs_from_engine(engine)
    if det_dir is None:
        det_dir = _find_latest_cache_model("det")
    if rec_dir is None:
        rec_dir = _find_latest_cache_model("rec")

    if det_dir is None or rec_dir is None:
        raise RuntimeError(
            "Unable to locate downloaded PaddleOCR detection/recognition models in the local cache."
        )

    return det_dir, rec_dir


def _build_engine(lang: str) -> Any:
    from paddleocr import PaddleOCR  # type: ignore

    candidate_kwargs: list[dict[str, object]] = [
        {
            "lang": lang,
            "use_doc_preprocessor": False,
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
            print(f"Preparing PaddleOCR models for lang={lang} with kwargs={kwargs}")
            return PaddleOCR(**kwargs)
        except TypeError as exc:
            last_error = exc
            continue
        except Exception as exc:
            last_error = exc
            continue

    raise RuntimeError(
        f"Failed to initialize PaddleOCR for lang={lang}. Last error: {last_error}"
    )


def _ensure_language_models(output_dir: Path, lang: str) -> None:
    det_dir, rec_dir = _language_model_roots(output_dir, lang)
    det_dir.mkdir(parents=True, exist_ok=True)
    rec_dir.mkdir(parents=True, exist_ok=True)

    if _is_non_empty_dir(det_dir) and _is_non_empty_dir(rec_dir):
        print(f"Models already staged for lang={lang}: {det_dir} / {rec_dir}")
        return

    engine = _build_engine(lang)
    source_det_dir, source_rec_dir = _resolve_model_dirs(engine)

    print(f"Copying detection model for lang={lang}: {source_det_dir} -> {det_dir}")
    _copy_model_dir(source_det_dir, det_dir)
    print(f"Copying recognition model for lang={lang}: {source_rec_dir} -> {rec_dir}")
    _copy_model_dir(source_rec_dir, rec_dir)

    if not _is_non_empty_dir(det_dir) or not _is_non_empty_dir(rec_dir):
        raise RuntimeError(
            f"Failed to stage PaddleOCR models for lang={lang}: {det_dir} / {rec_dir}"
        )

    print(f"Prepared models for lang={lang}: {det_dir} / {rec_dir}")


def main() -> int:
    args = _parse_args()
    os.environ.setdefault("PADDLE_PDX_MODEL_SOURCE", DEFAULT_MODEL_SOURCE)

    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    languages = [str(language).strip() for language in args.languages if str(language).strip()]
    if not languages:
        raise SystemExit("At least one language must be provided.")

    for lang in languages:
        _ensure_language_models(output_dir, lang)

    print(f"Prepared OCR models under {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
