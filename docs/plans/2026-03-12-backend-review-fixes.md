# Backend Review Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the four backend review findings with a focused runtime-state refactor and regression coverage.

**Architecture:** Keep the backend entrypoint-based architecture, but replace scattered mutable globals with a small runtime state container that owns task and workspace mappings. Preserve existing public message types while making interrupt and session-run handling correct under concurrency.

**Tech Stack:** Python 3.10+, FastAPI, asyncio, unittest

---

## Task 1: Add failing tests for interrupt and file write behavior

**Files:**
- Modify: `python_backend/tests/test_reasoning_streaming.py`
- Create: `python_backend/tests/test_file_write_tool.py`

**Step 1: Write failing interrupt regression test**

Add a test that interrupts a streaming run mid-response and asserts:

- frontend receives `interrupted`
- frontend does not receive `completed`
- session history does not persist an empty assistant message

**Step 2: Write failing file write regression test**

Add a test that writes content without a trailing newline and asserts the file content matches exactly.

**Step 3: Run tests to verify they fail**

Run:

```bash
python -m unittest python_backend.tests.test_reasoning_streaming python_backend.tests.test_file_write_tool -v
```

Expected: failures matching the current interrupt/completion and newline-mutation bugs.

## Task 2: Add failing tests for session reservation and per-connection workspace fallback

**Files:**
- Modify: `python_backend/tests/test_session_execution.py`

**Step 1: Write failing atomic-session test**

Add a test that forces two concurrent `handle_user_message()` calls for the same `session_id` to contend and asserts only one run starts.

**Step 2: Write failing workspace isolation test**

Add a test that sets different workspaces for two connections, omits `workspace_path` from message payloads, and asserts sessions are created in the correct connection-local workspace.

**Step 3: Run the test to verify it fails**

Run:

```bash
python -m unittest python_backend.tests.test_session_execution -v
```

Expected: failures proving the race and global workspace leakage.

## Task 3: Implement runtime state refactor in backend entrypoint

**Files:**
- Modify: `python_backend/main.py`

**Step 1: Introduce a runtime state container**

Move task tracking and connection workspace mappings into a single object.

**Step 2: Make session run reservation atomic**

Reserve the session slot while holding the shared state lock, then replace the reservation with the real task.

**Step 3: Switch workspace fallback to per-connection state**

Update workspace reads and writes to use connection-scoped mappings.

**Step 4: Run targeted backend tests**

Run:

```bash
python -m unittest python_backend.tests.test_session_execution python_backend.tests.test_connection_routing -v
```

Expected: all pass.

## Task 4: Implement interrupt and file write behavior fixes

**Files:**
- Modify: `python_backend/core/agent.py`
- Modify: `python_backend/tools/file_write.py`

**Step 1: Make interrupt explicit in agent streaming**

Ensure interrupted runs emit `interrupted`, skip persistence of empty assistant output, and never emit `completed`.

**Step 2: Preserve exact file content in file write**

Remove the forced newline append and keep the rest of the tool contract unchanged.

**Step 3: Run targeted tests**

Run:

```bash
python -m unittest python_backend.tests.test_reasoning_streaming python_backend.tests.test_file_write_tool -v
```

Expected: all pass.

## Task 5: Run full backend verification

**Files:**
- Modify: `python_backend/main.py`
- Modify: `python_backend/core/agent.py`
- Modify: `python_backend/tools/file_write.py`
- Modify: `python_backend/tests/test_session_execution.py`
- Modify: `python_backend/tests/test_reasoning_streaming.py`
- Create: `python_backend/tests/test_file_write_tool.py`

**Step 1: Run backend regression suite**

```bash
python -m unittest python_backend.tests.test_config_normalization python_backend.tests.test_connection_routing python_backend.tests.test_session_execution python_backend.tests.test_model_capabilities python_backend.tests.test_provider_reasoning_requests python_backend.tests.test_reasoning_streaming python_backend.tests.test_file_write_tool -v
```

Expected: all tests pass.

**Step 2: Check diff hygiene**

```bash
git diff --check
```

Expected: exit code 0.
