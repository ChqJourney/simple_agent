import json
import sys
import tempfile
import unittest
from typing import Any, Dict, List, Optional

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from core.user import Message, Session
from llms.base import BaseLLM
from runtime.reporting import (
    ReportGenerationError,
    generate_standard_qa_report,
    generate_standard_qa_report_streaming,
    generate_standard_qa_summary,
    load_standard_qa_session,
)


class FakeLLM(BaseLLM):
    def __init__(self, content: str):
        super().__init__({"model": "fake-report-model"})
        self.content = content
        self.calls: List[List[Dict[str, Any]]] = []

    async def stream(self, messages: List[Dict], tools: Optional[List[Dict]] = None):
        if False:
            yield {}

    async def complete(self, messages: List[Dict], tools: Optional[List[Dict]] = None) -> Dict[str, Any]:
        self.calls.append(messages)
        return {
            "choices": [
                {
                    "message": {
                        "content": self.content,
                    },
                },
            ],
        }


class FakeStreamingLLM(FakeLLM):
    async def stream(self, messages: List[Dict], tools: Optional[List[Dict]] = None):
        self.calls.append(messages)
        for index in range(0, len(self.content), 24):
            yield {
                "choices": [
                    {
                        "delta": {
                            "content": self.content[index:index + 24],
                        },
                    }
                ]
            }

    async def complete(self, messages: List[Dict], tools: Optional[List[Dict]] = None) -> Dict[str, Any]:
        raise AssertionError("streaming report generation should not call complete")


class StandardQaReportingTest(unittest.IsolatedAsyncioTestCase):
    async def test_generates_and_caches_summary_with_background_llm_payload(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            session = Session("session-a", temp_dir, scenario_id="standard_qa")
            await session.add_message_async(Message(role="user", content="请检查 IEC 5.1", timestamp=session.created_at))
            await session.add_message_async(Message(role="assistant", content="结论：IEC 5.1 适用。", timestamp=session.created_at))

            llm = FakeLLM(json.dumps({
                "title": "IEC 5.1 摘要",
                "overview": "已确认 IEC 5.1 的适用性。",
                "key_points": ["IEC 5.1 适用"],
                "evidence_highlights": ["IEC.pdf page 12"],
                "open_questions": [],
            }, ensure_ascii=False))

            first = await generate_standard_qa_summary(session, llm)  # type: ignore[arg-type]
            second = await generate_standard_qa_summary(session, llm)  # type: ignore[arg-type]

            self.assertFalse(first["cached"])
            self.assertTrue(second["cached"])
            self.assertEqual("IEC 5.1 摘要", first["data"]["title"])
            self.assertEqual(1, len(llm.calls))
            self.assertIn("Preserve standard clause numbers", llm.calls[0][1]["content"])

    async def test_generates_report_and_requires_qa_sections(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            session = Session("session-a", temp_dir, scenario_id="standard_qa")
            await session.add_message_async(Message(role="user", content="问题", timestamp=session.created_at))
            await session.add_message_async(Message(role="assistant", content="回答", timestamp=session.created_at))

            llm = FakeLLM(json.dumps({
                "title": "专业报告",
                "executive_summary": "摘要",
                "qa_sections": [
                    {
                        "question": "问题",
                        "answer": "回答",
                        "evidence": [{"standard_clause": "5.1", "file": "IEC.pdf", "page": "12"}],
                        "uncertainties": [],
                    }
                ],
            }, ensure_ascii=False))

            payload = await generate_standard_qa_report(session, llm)  # type: ignore[arg-type]

            self.assertEqual("专业报告", payload["data"]["title"])
            self.assertEqual("5.1", payload["data"]["qa_sections"][0]["evidence"][0]["standard_clause"])

    async def test_streaming_report_generation_reports_token_progress(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            session = Session("session-a", temp_dir, scenario_id="standard_qa")
            await session.add_message_async(Message(role="user", content="请基于 IEC 60335-1 13.3 生成耐压测试说明", timestamp=session.created_at))
            await session.add_message_async(Message(role="assistant", content="IEC 60335-1 13.3 要求电气强度试验，测试电压和持续时间需保留。", timestamp=session.created_at))

            report_json = json.dumps({
                "title": "IEC 60335-1 耐压测试报告",
                "executive_summary": "本报告整理了耐压测试方法、依据条款和待确认项目。",
                "qa_sections": [
                    {
                        "question": "请基于 IEC 60335-1 13.3 生成耐压测试说明",
                        "answer": "应按 IEC 60335-1 13.3 执行电气强度试验，并记录测试电压、持续时间和判定结果。",
                        "evidence": [{"standard_clause": "13.3", "file": "IEC 60335-1.pdf", "page": "45"}],
                        "uncertainties": [],
                    }
                ],
            }, ensure_ascii=False)
            llm = FakeStreamingLLM(report_json)
            progress_events: List[Dict[str, Any]] = []

            async def record_progress(event: Dict[str, Any]) -> None:
                progress_events.append(event)

            payload = await generate_standard_qa_report_streaming(
                session,
                llm,  # type: ignore[arg-type]
                progress_callback=record_progress,
            )

            self.assertEqual("IEC 60335-1 耐压测试报告", payload["data"]["title"])
            self.assertTrue(any(event["phase"] == "llm_stream" for event in progress_events))
            self.assertGreater(progress_events[-1]["generated_tokens"], 0)

    async def test_rejects_non_standard_qa_sessions(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            session = Session("session-a", temp_dir, scenario_id="default")
            await session.add_message_async(Message(role="user", content="问题", timestamp=session.created_at))
            await session.add_message_async(Message(role="assistant", content="回答", timestamp=session.created_at))

            with self.assertRaises(ReportGenerationError):
                load_standard_qa_session(temp_dir, "session-a")


if __name__ == "__main__":
    unittest.main()
