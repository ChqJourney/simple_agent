from __future__ import annotations

import csv
import re
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from document_readers.excel_reader import ExcelReader
from document_readers.word_reader import WordReader
from runtime.config import get_enabled_reference_library_roots

from .base import BaseTool, ToolResult
from .path_utils import resolve_path_in_root, resolve_workspace_path

CSV_EXTENSIONS = {".csv", ".tsv"}
TEXT_TABLE_EXTENSIONS = {".md", ".txt"}
WORD_EXTENSIONS = {".docx"}
EXCEL_EXTENSIONS = {".xlsx"}
SUPPORTED_EXTENSIONS = CSV_EXTENSIONS | TEXT_TABLE_EXTENSIONS | WORD_EXTENSIONS | EXCEL_EXTENSIONS
CLAUSE_RE = re.compile(r"^(?:clause\s*)?(?:\d+[a-z]?)(?:\.\d+[a-z]?){0,6}$", re.IGNORECASE)
MARKDOWN_SEPARATOR_RE = re.compile(r"^\s*:?-{3,}:?\s*$")

HEADER_ROLE_KEYWORDS: Dict[str, tuple[str, ...]] = {
    "clause": ("clause", "cl.", "item", "requirement no", "clause no", "clause id", "paragraph"),
    "requirement": ("requirement", "description", "test", "inspection", "criteria", "criterion", "content"),
    "evidence": ("evidence", "remark", "remarks", "comment", "comments", "observation", "finding", "record", "notes"),
    "judgement": ("judgement", "judgment", "verdict", "result", "decision", "status", "pass/fail", "p/f"),
}
VERDICT_WORDS = {
    "p",
    "f",
    "n/a",
    "na",
    "pass",
    "fail",
    "ok",
    "ng",
    "yes",
    "no",
    "complies",
    "comply",
    "non-compliant",
    "not compliant",
}


def _normalize_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _normalize_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", _normalize_text(value).lower()).strip()


def _looks_like_clause_id(value: str) -> bool:
    normalized = _normalize_text(value)
    return bool(normalized and CLAUSE_RE.match(normalized))


def _looks_like_verdict(value: str) -> bool:
    normalized = _normalize_text(value).lower()
    if not normalized:
        return False
    if normalized in VERDICT_WORDS:
        return True
    if len(normalized) <= 4 and normalized.replace("/", "").replace("-", "").isalnum():
        return normalized in VERDICT_WORDS
    return False


def _infer_header_roles(headers: List[str]) -> Dict[str, List[int]]:
    roles: Dict[str, List[int]] = {key: [] for key in HEADER_ROLE_KEYWORDS}
    for index, header in enumerate(headers):
        normalized = _normalize_header(header)
        if not normalized:
            continue
        for role, keywords in HEADER_ROLE_KEYWORDS.items():
            if any(keyword in normalized for keyword in keywords):
                roles[role].append(index)
    return roles


def _is_likely_checklist_shape(headers: List[str], roles: Dict[str, List[int]], row_cells: List[str]) -> bool:
    if roles["requirement"] and (roles["clause"] or roles["judgement"] or roles["evidence"]):
        return True
    if headers and len([header for header in headers if _normalize_text(header)]) >= 3:
        matched_roles = sum(1 for key in ("clause", "requirement", "evidence", "judgement") if roles[key])
        if matched_roles >= 2:
            return True
    non_empty = [cell for cell in row_cells if cell]
    return len(non_empty) >= 3 and (_looks_like_clause_id(non_empty[0]) or _looks_like_verdict(non_empty[-1]))


def _looks_like_checklist_header(headers: List[str], roles: Dict[str, List[int]]) -> bool:
    if roles["requirement"] and (roles["clause"] or roles["judgement"] or roles["evidence"]):
        return True
    if headers and len([header for header in headers if _normalize_text(header)]) >= 3:
        matched_roles = sum(1 for key in ("clause", "requirement", "evidence", "judgement") if roles[key])
        if matched_roles >= 2:
            return True
    return False


def _extract_field_by_role(cells: List[str], indexes: List[int]) -> str:
    values = [cells[index] for index in indexes if 0 <= index < len(cells) and cells[index]]
    return " | ".join(values)


def _build_checklist_row(
    *,
    cells: List[str],
    headers: List[str],
    roles: Dict[str, List[int]],
    row_id: str,
    locator: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    non_empty = [cell for cell in cells if cell]
    if not non_empty:
        return None

    clause_id = _extract_field_by_role(cells, roles["clause"])
    requirement = _extract_field_by_role(cells, roles["requirement"])
    raw_evidence = _extract_field_by_role(cells, roles["evidence"])
    raw_judgement = _extract_field_by_role(cells, roles["judgement"])

    if not clause_id and cells and _looks_like_clause_id(cells[0]):
        clause_id = cells[0]
    if not requirement:
        requirement_index = 1 if len(cells) > 1 else None
        if roles["clause"] and roles["clause"][0] == 0 and len(cells) > 1:
            requirement_index = 1
        if requirement_index is not None and requirement_index < len(cells):
            requirement = cells[requirement_index]
    if not raw_judgement and len(non_empty) >= 3 and _looks_like_verdict(non_empty[-1]):
        raw_judgement = non_empty[-1]
    if not raw_evidence and len(non_empty) >= 4:
        middle = non_empty[2:-1] if raw_judgement else non_empty[2:]
        raw_evidence = " | ".join(item for item in middle if item)

    if not clause_id and not requirement:
        return None

    return {
        "row_id": row_id,
        "clause_id": clause_id,
        "requirement": requirement,
        "raw_evidence": raw_evidence,
        "raw_judgement": raw_judgement,
        "source_text": " | ".join(non_empty),
        "locator": locator,
        "column_headers": [header for header in headers if _normalize_text(header)],
    }


class ExtractChecklistRowsTool(BaseTool):
    name = "extract_checklist_rows"
    description = (
        "Extract structured checklist rows from a checklist document. Supports Word tables, Excel sheets, "
        "CSV/TSV tables, and simple markdown-style pipe tables. Returns clause ids, requirements, "
        "raw evidence fields, and raw judgements so the model can evaluate each row."
    )
    display_name = "Extract Checklist Rows"
    category = "workspace"
    read_only = True
    risk_level = "low"
    preferred_order = 16
    use_when = "Use when a checklist document needs to be converted into structured clause rows before evaluation."
    avoid_when = "Avoid when you only need one small excerpt or are answering a normal evidence question."
    user_summary_template = "Extracting checklist rows from {path}"
    result_preview_fields = ["summary", "rows"]
    tags = ["checklist", "document", "safe-read", "structure"]
    parameters = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Checklist file path. Relative to workspace by default, or relative to `reference_root_id` when provided.",
            },
            "reference_root_id": {
                "type": "string",
                "description": "Optional reference library root id when the checklist lives in the global reference library.",
            },
            "table_index": {
                "type": "integer",
                "description": "Optional 1-based Word table index to target a specific checklist table.",
            },
            "sheet_name": {
                "type": "string",
                "description": "Optional Excel sheet name to target a specific worksheet.",
            },
            "row_start": {
                "type": "integer",
                "description": "Optional 1-based row start filter.",
            },
            "row_end": {
                "type": "integer",
                "description": "Optional 1-based row end filter.",
            },
            "max_rows": {
                "type": "integer",
                "default": 200,
                "description": "Maximum checklist rows to return.",
            },
            "encoding": {
                "type": "string",
                "default": "utf-8",
                "description": "Text encoding for CSV, TSV, markdown, or text checklists.",
            },
        },
        "required": ["path"],
        "additionalProperties": False,
    }

    def __init__(self, config_getter: Callable[[], Optional[Dict[str, Any]]]) -> None:
        super().__init__()
        self._config_getter = config_getter

    def _resolve_reference_root(self, reference_root_id: str) -> tuple[Optional[Dict[str, Any]], Optional[str]]:
        normalized_root_id = _normalize_text(reference_root_id)
        if not normalized_root_id:
            return None, "reference_root_id is empty"

        config = self._config_getter() or {}
        for root in get_enabled_reference_library_roots(config, kind="checklist"):
            candidate_root_id = _normalize_text(root.get("id"))
            if candidate_root_id == normalized_root_id:
                return root, None
        return None, f"Checklist reference library root is not available: {reference_root_id}"

    def _resolve_source_path(
        self,
        *,
        path: str,
        workspace_path: Optional[str],
        reference_root_id: Optional[str],
        reference_library_roots: Optional[list[str]] = None,
    ) -> tuple[Optional[Path], Dict[str, Any], Optional[str]]:
        if reference_root_id:
            root, root_error = self._resolve_reference_root(reference_root_id)
            if root_error or root is None:
                return None, {}, root_error or "Invalid reference root"
            root_path = Path(str(root.get("path") or "")).resolve()
            file_path, resolve_error = resolve_path_in_root(path, root_path)
            metadata = {
                "source": "reference_library",
                "reference_root_id": _normalize_text(root.get("id")) or str(root_path),
                "reference_root_label": _normalize_text(root.get("label")) or root_path.name,
                "reference_root_path": str(root_path),
                "relative_path": path.strip(),
            }
            return file_path, metadata, resolve_error

        file_path, resolve_error = resolve_workspace_path(
            path,
            workspace_path,
            reference_library_roots=reference_library_roots,
            allow_reference_library=True,
        )
        return file_path, {"source": "workspace"}, resolve_error

    @staticmethod
    def _normalize_max_rows(max_rows: int) -> int:
        try:
            return max(1, min(1000, int(max_rows)))
        except (TypeError, ValueError):
            return 200

    @staticmethod
    def _within_requested_rows(row_index: int, row_start: Optional[int], row_end: Optional[int]) -> bool:
        if row_start is not None and row_index < row_start:
            return False
        if row_end is not None and row_index > row_end:
            return False
        return True

    def _extract_docx_rows(
        self,
        file_path: Path,
        *,
        table_index: Optional[int],
        row_start: Optional[int],
        row_end: Optional[int],
        max_rows: int,
    ) -> tuple[List[Dict[str, Any]], Dict[str, Any]]:
        reader = WordReader(file_path)
        tables = reader.tables
        if table_index is not None:
            if table_index < 1 or table_index > len(tables):
                raise ValueError(f"Table index {table_index} is out of range (table count: {len(tables)})")
            tables = [tables[table_index - 1]]

        extracted_rows: List[Dict[str, Any]] = []
        tables_scanned = 0
        tables_matched = 0
        skipped_rows = 0
        truncated = False

        for table in tables:
            tables_scanned += 1
            headers = [str(header or "") for header in (table.get("column_headers") or [])]
            roles = _infer_header_roles(headers)
            preview_cells = [
                _normalize_text(cell.get("text"))
                for row in table.get("rows", [])
                for cell in row.get("cells", [])
            ][:4]
            if table_index is None and not _is_likely_checklist_shape(headers, roles, preview_cells):
                continue
            tables_matched += 1
            header_row_index = int(table["header_row_index"]) if table.get("header_row_index") else None

            for row in table.get("rows", []):
                row_index = int(row["row_index"])
                if header_row_index is not None and row_index == header_row_index:
                    continue
                if not self._within_requested_rows(row_index, row_start, row_end):
                    continue
                cells = [_normalize_text(cell.get("text")) for cell in row.get("cells", [])]
                extracted = _build_checklist_row(
                    cells=cells,
                    headers=headers,
                    roles=roles,
                    row_id=f"{file_path.stem}:table-{int(table['table_index'])}:row-{row_index}",
                    locator={
                        "type": "word_table_row",
                        "table_index": int(table["table_index"]),
                        "row_index": row_index,
                    },
                )
                if extracted is None:
                    skipped_rows += 1
                    continue
                if len(extracted_rows) >= max_rows:
                    truncated = True
                    break
                extracted["table_index"] = int(table["table_index"])
                extracted["table_title"] = str(table.get("title") or "")
                extracted["table_type"] = str(table.get("table_type") or "grid")
                extracted_rows.append(extracted)
            if len(extracted_rows) >= max_rows:
                break

        return extracted_rows, {
            "containers_scanned": tables_scanned,
            "containers_matched": tables_matched,
            "skipped_rows": skipped_rows,
            "truncated": truncated,
        }

    def _extract_xlsx_rows(
        self,
        file_path: Path,
        *,
        sheet_name: Optional[str],
        row_start: Optional[int],
        row_end: Optional[int],
        max_rows: int,
    ) -> tuple[List[Dict[str, Any]], Dict[str, Any]]:
        reader = ExcelReader(file_path)
        sheets = reader.sheets
        if sheet_name:
            sheets = [sheet for sheet in sheets if str(sheet.get("sheet_name") or "") == sheet_name]
            if not sheets:
                raise ValueError(f"Sheet not found: {sheet_name}")

        extracted_rows: List[Dict[str, Any]] = []
        sheets_scanned = 0
        sheets_matched = 0
        skipped_rows = 0
        truncated = False

        for sheet in sheets:
            sheets_scanned += 1
            headers = [str(header or "") for header in (sheet.get("column_headers") or [])]
            roles = _infer_header_roles(headers)
            preview_cells = [
                _normalize_text(cell.get("text"))
                for row in sheet.get("rows", [])
                for cell in row.get("cells", [])
            ][:4]
            if sheet_name is None and not _is_likely_checklist_shape(headers, roles, preview_cells):
                continue
            sheets_matched += 1
            header_row_index = int(sheet["header_row_index"]) if sheet.get("header_row_index") else None

            for row in sheet.get("rows", []):
                row_index = int(row["row_index"])
                if header_row_index is not None and row_index == header_row_index:
                    continue
                if not self._within_requested_rows(row_index, row_start, row_end):
                    continue
                cells = [_normalize_text(cell.get("text")) for cell in row.get("cells", [])]
                extracted = _build_checklist_row(
                    cells=cells,
                    headers=headers,
                    roles=roles,
                    row_id=f"{file_path.stem}:{str(sheet['sheet_name'])}:row-{row_index}",
                    locator={
                        "type": "excel_row",
                        "sheet_name": str(sheet["sheet_name"]),
                        "row_index": row_index,
                    },
                )
                if extracted is None:
                    skipped_rows += 1
                    continue
                if len(extracted_rows) >= max_rows:
                    truncated = True
                    break
                extracted["sheet_name"] = str(sheet["sheet_name"])
                extracted_rows.append(extracted)
            if len(extracted_rows) >= max_rows:
                break

        return extracted_rows, {
            "containers_scanned": sheets_scanned,
            "containers_matched": sheets_matched,
            "skipped_rows": skipped_rows,
            "truncated": truncated,
        }

    @staticmethod
    def _read_tabular_text_rows(file_path: Path, *, encoding: str) -> List[List[str]]:
        raw_text = file_path.read_text(encoding=encoding, errors="replace")
        lines = [line.rstrip() for line in raw_text.splitlines() if line.strip()]
        if not lines:
            return []

        if file_path.suffix.lower() == ".tsv":
            delimiter = "\t"
        elif file_path.suffix.lower() == ".csv":
            delimiter = ","
        elif any("|" in line for line in lines[:5]):
            parsed_rows: List[List[str]] = []
            for line in lines:
                stripped = line.strip().strip("|")
                cells = [_normalize_text(cell) for cell in stripped.split("|")]
                if cells and all(MARKDOWN_SEPARATOR_RE.match(cell or "") for cell in cells):
                    continue
                if any(cells):
                    parsed_rows.append(cells)
            return parsed_rows
        else:
            delimiter = ","

        reader = csv.reader(lines, delimiter=delimiter)
        return [[_normalize_text(cell) for cell in row] for row in reader if any(_normalize_text(cell) for cell in row)]

    def _extract_text_rows(
        self,
        file_path: Path,
        *,
        row_start: Optional[int],
        row_end: Optional[int],
        max_rows: int,
        encoding: str,
    ) -> tuple[List[Dict[str, Any]], Dict[str, Any]]:
        rows = self._read_tabular_text_rows(file_path, encoding=encoding)
        if not rows:
            return [], {"containers_scanned": 1, "containers_matched": 0, "skipped_rows": 0}

        headers = rows[0]
        roles = _infer_header_roles(headers)
        empty_roles = _infer_header_roles([])
        header_like = _looks_like_checklist_header(headers, roles)
        preview_rows = rows[1:4] if header_like else rows[:3]
        container_like = header_like or any(
            _is_likely_checklist_shape([], empty_roles, row) for row in preview_rows
        )
        if not container_like:
            return [], {
                "containers_scanned": 1,
                "containers_matched": 0,
                "skipped_rows": 0,
                "truncated": False,
            }

        data_rows = rows[1:] if header_like else rows
        extracted_rows: List[Dict[str, Any]] = []
        skipped_rows = 0
        truncated = False

        for offset, row in enumerate(data_rows, start=2 if header_like else 1):
            if not self._within_requested_rows(offset, row_start, row_end):
                continue
            if not header_like and not _is_likely_checklist_shape([], empty_roles, row):
                skipped_rows += 1
                continue
            extracted = _build_checklist_row(
                cells=row,
                headers=headers if header_like else [],
                roles=roles if header_like else empty_roles,
                row_id=f"{file_path.stem}:row-{offset}",
                locator={
                    "type": "text_table_row",
                    "row_index": offset,
                },
            )
            if extracted is None:
                skipped_rows += 1
                continue
            if len(extracted_rows) >= max_rows:
                truncated = True
                break
            extracted_rows.append(extracted)

        return extracted_rows, {
            "containers_scanned": 1,
            "containers_matched": 1,
            "skipped_rows": skipped_rows,
            "truncated": truncated,
        }

    async def execute(
        self,
        path: str,
        tool_call_id: str = "",
        workspace_path: Optional[str] = None,
        reference_library_roots: Optional[list[str]] = None,
        reference_root_id: Optional[str] = None,
        table_index: Optional[int] = None,
        sheet_name: Optional[str] = None,
        row_start: Optional[int] = None,
        row_end: Optional[int] = None,
        max_rows: int = 200,
        encoding: str = "utf-8",
        **_: Any,
    ) -> ToolResult:
        file_path, source_metadata, resolve_error = self._resolve_source_path(
            path=path,
            workspace_path=workspace_path,
            reference_root_id=reference_root_id,
            reference_library_roots=reference_library_roots,
        )
        if resolve_error or file_path is None:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=resolve_error or "Invalid path",
            )

        if not file_path.exists():
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=f"File not found: {path}",
            )

        if not file_path.is_file():
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=f"Path is not a file: {file_path}",
            )

        suffix = file_path.suffix.lower()
        if suffix not in SUPPORTED_EXTENSIONS:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=f"Unsupported checklist file type: {file_path.suffix or '(none)'}",
            )

        normalized_max_rows = self._normalize_max_rows(max_rows)

        try:
            if suffix in WORD_EXTENSIONS:
                rows, stats = self._extract_docx_rows(
                    file_path,
                    table_index=table_index,
                    row_start=row_start,
                    row_end=row_end,
                    max_rows=normalized_max_rows,
                )
                document_type = "docx"
            elif suffix in EXCEL_EXTENSIONS:
                rows, stats = self._extract_xlsx_rows(
                    file_path,
                    sheet_name=sheet_name,
                    row_start=row_start,
                    row_end=row_end,
                    max_rows=normalized_max_rows,
                )
                document_type = "xlsx"
            else:
                rows, stats = self._extract_text_rows(
                    file_path,
                    row_start=row_start,
                    row_end=row_end,
                    max_rows=normalized_max_rows,
                    encoding=encoding,
                )
                document_type = "text"
        except (OSError, RuntimeError, UnicodeDecodeError, ValueError, csv.Error) as exc:
            return ToolResult(
                tool_call_id=tool_call_id,
                tool_name=self.name,
                success=False,
                output=None,
                error=str(exc),
            )

        output = {
            "event": "checklist_rows",
            "path": str(file_path),
            "document_type": document_type,
            "truncated": bool(stats.get("truncated")),
            "rows": rows,
            "summary": {
                "row_count": len(rows),
                "containers_scanned": stats["containers_scanned"],
                "containers_matched": stats["containers_matched"],
                "skipped_rows": stats["skipped_rows"],
            },
            **source_metadata,
        }
        return ToolResult(
            tool_call_id=tool_call_id,
            tool_name=self.name,
            success=True,
            output=output,
        )
