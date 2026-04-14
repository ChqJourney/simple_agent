from __future__ import annotations

from typing import Any, Dict, List, Optional, TypedDict


class ScenarioSpec(TypedDict):
    scenario_id: str
    label: str
    description: str
    system_prompt_addendum: str
    tool_allowlist: Optional[List[str]]
    tool_denylist: Optional[List[str]]
    runtime_overrides: Dict[str, Any]
    loop_strategy: str


SCENARIO_REGISTRY: Dict[str, ScenarioSpec] = {
    "default": {
        "scenario_id": "default",
        "label": "Default",
        "description": "General assistant behavior.",
        "system_prompt_addendum": "",
        "tool_allowlist": None,
        "tool_denylist": [
            "extract_checklist_rows",
            "read_reference_segment",
            "search_reference_library",
        ],
        "runtime_overrides": {},
        "loop_strategy": "default_chat",
    },
    "standard_qa": {
        "scenario_id": "standard_qa",
        "label": "Standard QA",
        "description": "Evidence-driven Q&A with standards and workspace sources.",
        "system_prompt_addendum": (
            "You are in Standard QA mode. Prioritize evidence from workspace documents "
            "and approved reference materials. Prefer retrieving evidence before answering. "
            "If the available evidence is insufficient, ask the user a focused clarifying "
            "question before answering. Distinguish confirmed facts from assumptions, and "
            "structure substantive answers using these sections when applicable: Conclusion, "
            "Evidence, Uncertainties, and Needed Information."
        ),
        "tool_allowlist": [
            "ask_question",
            "file_read",
            "get_document_structure",
            "list_directory_tree",
            "pdf_get_info",
            "pdf_get_outline",
            "pdf_read_lines",
            "pdf_read_pages",
            "pdf_search",
            "read_document_segment",
            "read_reference_segment",
            "search_documents",
            "search_reference_library",
        ],
        "tool_denylist": None,
        "runtime_overrides": {},
        "loop_strategy": "evidence_qa",
    },
    "checklist_evaluation": {
        "scenario_id": "checklist_evaluation",
        "label": "Checklist Evaluation",
        "description": "Evaluate checklist items with evidence and judgements.",
        "system_prompt_addendum": (
            "You are in Checklist Evaluation mode. Treat checklist extraction as an AI-first task. "
            "You may use extract_checklist_rows as a helper, but do not rely on it exclusively. "
            "If helper extraction is empty, incomplete, or not suitable for the document format, "
            "read the checklist source directly and derive the rows yourself from the document content. "
            "Then gather evidence for each clause before judging it. Prioritize checklist files and "
            "evidence files that the user explicitly names before exploring unrelated workspace files. "
            "Prefer workspace documents and approved reference materials over assumptions. If required evidence is missing, ask "
            "concise follow-up questions that group the missing information efficiently. Your final "
            "answer must begin with a single ```json fenced block containing an object with optional "
            "checklist_title, optional source_label, and a required rows array. Each row object must "
            "include these fields: clause_id, requirement, evidence, judgement, confidence, and "
            "missing_info. Use judgement values pass, fail, unknown, or na. After the JSON block, "
            "you may add a brief human-readable summary. When the user asks you to create, export, "
            "or save a result file, use file_write directly with the full target content instead of "
            "trying to read a not-yet-existing output path first. Do not return only prose or per-clause mini tables."
        ),
        "tool_allowlist": [
            "ask_question",
            "extract_checklist_rows",
            "file_read",
            "file_write",
            "get_document_structure",
            "list_directory_tree",
            "pdf_get_info",
            "pdf_get_outline",
            "pdf_read_lines",
            "pdf_read_pages",
            "pdf_search",
            "read_document_segment",
            "read_reference_segment",
            "search_documents",
            "search_reference_library",
        ],
        "tool_denylist": None,
        "runtime_overrides": {},
        "loop_strategy": "checklist_evaluation",
    },
}


def get_scenario_spec(scenario_id: Optional[str]) -> ScenarioSpec:
    normalized = (scenario_id or "default").strip().lower()
    return SCENARIO_REGISTRY.get(normalized, SCENARIO_REGISTRY["default"])
