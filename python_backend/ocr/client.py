from __future__ import annotations

from pathlib import Path

import httpx

from .contracts import (
    AUTH_HEADER_NAME,
    DEFAULT_OCR_REQUEST_TIMEOUT_SECONDS,
    OcrHealthResponse,
    OcrImageResponse,
    OcrSidecarConnection,
)


class OcrSidecarClient:
    async def health(
        self,
        connection: OcrSidecarConnection,
        *,
        timeout_seconds: int = 5,
    ) -> OcrHealthResponse:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.get(
                f"{connection.base_url}/health",
                headers={AUTH_HEADER_NAME: connection.auth_token},
            )
            response.raise_for_status()
            return OcrHealthResponse.model_validate(response.json())

    async def ocr_image(
        self,
        connection: OcrSidecarConnection,
        image_path: Path,
        *,
        lang: str,
        detail_level: str,
        timeout_seconds: int = DEFAULT_OCR_REQUEST_TIMEOUT_SECONDS,
    ) -> OcrImageResponse:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.post(
                f"{connection.base_url}/ocr/image",
                headers={AUTH_HEADER_NAME: connection.auth_token},
                json={
                    "image_path": str(image_path),
                    "lang": lang,
                    "detail_level": detail_level,
                },
            )
            response.raise_for_status()
            return OcrImageResponse.model_validate(response.json())
