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
            "You are in Checklist Evaluation mode. First extract checklist rows, then gather "
            "evidence for each clause before judging it. Prefer workspace documents and approved "
            "reference materials over assumptions. If required evidence is missing, ask concise "
            "follow-up questions that group the missing information efficiently. For substantive "
            "outputs, structure each evaluated row with these fields: clause_id, requirement, "
            "evidence, judgement, confidence, and missing_info."
        ),
        "tool_allowlist": [
            "ask_question",
            "extract_checklist_rows",
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
        "loop_strategy": "checklist_evaluation",
    },
}


def get_scenario_spec(scenario_id: Optional[str]) -> ScenarioSpec:
    normalized = (scenario_id or "default").strip().lower()
    return SCENARIO_REGISTRY.get(normalized, SCENARIO_REGISTRY["default"])
