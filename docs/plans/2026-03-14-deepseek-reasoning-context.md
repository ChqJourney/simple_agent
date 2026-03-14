# DeepSeek Reasoning Context Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve assistant `reasoning_content` in serialized LLM history so DeepSeek tool-call follow-ups remain valid.

**Architecture:** Keep the fix in shared session message serialization rather than adding provider-specific branching. Add a regression test that reproduces the missing field on assistant messages with tool calls, then make the smallest serialization change to include the field when present.

**Tech Stack:** Python, unittest, session message serialization in `python_backend/core/user.py`

---

### Task 1: Preserve assistant reasoning content in LLM history

**Files:**
- Modify: `python_backend/tests/test_multimodal_messages.py`
- Modify: `python_backend/core/user.py`

**Step 1: Write the failing test**

Add a test that stores an assistant message with `content`, `tool_calls`, and `reasoning_content`, then asserts `Session.get_messages_for_llm()` includes `reasoning_content`.

**Step 2: Run test to verify it fails**

Run: `python -m unittest python_backend.tests.test_multimodal_messages.MultimodalMessageTests.test_get_messages_for_llm_preserves_assistant_reasoning_content`

Expected: FAIL because serialized messages omit `reasoning_content`.

**Step 3: Write minimal implementation**

Update `Session.get_messages_for_llm()` to include `reasoning_content` when present on a stored message.

**Step 4: Run tests to verify they pass**

Run: `python -m unittest python_backend.tests.test_multimodal_messages python_backend.tests.test_reasoning_streaming`

Expected: PASS.
