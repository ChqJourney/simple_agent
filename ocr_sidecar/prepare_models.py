from __future__ import annotations

import argparse
import os
from pathlib import Path


DEFAULT_LANGUAGES = ("ch", "en")


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


def _ensure_language_models(output_dir: Path, lang: str) -> None:
    from paddleocr import PaddleOCR  # type: ignore

    det_dir, rec_dir = _language_model_roots(output_dir, lang)
    det_dir.mkdir(parents=True, exist_ok=True)
    rec_dir.mkdir(parents=True, exist_ok=True)

    if _is_non_empty_dir(det_dir) and _is_non_empty_dir(rec_dir):
        print(f"Models already staged for lang={lang}: {det_dir} / {rec_dir}")
        return

    candidate_kwargs: list[dict[str, object]] = [
        {
            "lang": lang,
            "text_detection_model_dir": str(det_dir),
            "text_recognition_model_dir": str(rec_dir),
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
            "use_textline_orientation": False,
        },
        {
            "lang": lang,
            "det_model_dir": str(det_dir),
            "rec_model_dir": str(rec_dir),
            "use_angle_cls": False,
            "show_log": False,
        },
        {
            "lang": lang,
            "text_detection_model_dir": str(det_dir),
            "text_recognition_model_dir": str(rec_dir),
        },
        {
            "lang": lang,
            "det_model_dir": str(det_dir),
            "rec_model_dir": str(rec_dir),
        },
    ]

    last_error: Exception | None = None
    for kwargs in candidate_kwargs:
        try:
            print(f"Preparing PaddleOCR models for lang={lang} with kwargs={kwargs}")
            PaddleOCR(**kwargs)
        except TypeError as exc:
            last_error = exc
            continue
        except Exception as exc:
            last_error = exc
            continue

        if _is_non_empty_dir(det_dir) and _is_non_empty_dir(rec_dir):
            print(f"Prepared models for lang={lang}: {det_dir} / {rec_dir}")
            return

    raise RuntimeError(
        f"Failed to prepare PaddleOCR models for lang={lang}. Last error: {last_error}"
    )


def main() -> int:
    args = _parse_args()
    os.environ.setdefault("PADDLE_PDX_MODEL_SOURCE", "BOS")

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
