# Must Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the six agreed production issues without expanding scope beyond the approved set.

**Architecture:** Persist frontend config through a Tauri-aware storage adapter that writes under the app data directory while keeping browser fallback behavior for tests. Harden backend/session path handling and runtime timeouts with narrowly scoped helpers and regression tests. Replace panic-prone Tauri sidecar lifecycle calls with fallible helpers and tighten desktop fs permissions to app data plus user-authorized workspaces.

**Tech Stack:** React, Zustand, Vitest, Python/FastAPI, unittest, Rust/Tauri

---

### Task 1: Config Persistence In AppData

**Files:**
- Modify: `src/stores/configStore.ts`
- Modify: `src/utils/storage.ts`
- Test: `src/stores/configStore.test.ts`

**Step 1: Write the failing test**
- Add a store test that mocks Tauri fs/path APIs and expects config persistence to write under app data instead of `localStorage`.

**Step 2: Run test to verify it fails**
- Run: `npm test -- src/stores/configStore.test.ts`

**Step 3: Write minimal implementation**
- Add a Tauri-aware persist storage adapter and route config persistence through it.

**Step 4: Run test to verify it passes**
- Run: `npm test -- src/stores/configStore.test.ts`

### Task 2: Session Reservation And Path Safety

**Files:**
- Modify: `python_backend/main.py`
- Modify: `python_backend/runtime/logs.py`
- Modify: `python_backend/core/user.py`
- Test: `python_backend/tests/test_session_execution.py`
- Test: `python_backend/tests/test_run_logging.py`

**Step 1: Write the failing tests**
- Add a regression test proving reserved session state is released on early-return error paths.
- Add tests proving unsafe `session_id` values are rejected before file paths are built.

**Step 2: Run tests to verify they fail**
- Run: `python -m unittest python_backend.tests.test_session_execution python_backend.tests.test_run_logging`

**Step 3: Write minimal implementation**
- Centralize reserved-session cleanup in `main.py`.
- Validate `session_id` before log/session file access.

**Step 4: Run tests to verify they pass**
- Run: `python -m unittest python_backend.tests.test_session_execution python_backend.tests.test_run_logging`

### Task 3: LLM Timeouts

**Files:**
- Modify: `python_backend/llms/openai.py`
- Modify: `python_backend/llms/deepseek.py`
- Modify: `python_backend/llms/qwen.py`
- Modify: `python_backend/llms/ollama.py`
- Add: `python_backend/tests/test_llm_timeouts.py`

**Step 1: Write the failing tests**
- Assert the OpenAI-compatible clients and Ollama client sessions are initialized with finite defaults and runtime override support.

**Step 2: Run test to verify it fails**
- Run: `python -m unittest python_backend.tests.test_llm_timeouts`

**Step 3: Write minimal implementation**
- Add shared timeout extraction and wire it into each provider.

**Step 4: Run test to verify it passes**
- Run: `python -m unittest python_backend.tests.test_llm_timeouts`

### Task 4: Tauri Sidecar Hardening

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/lib.rs`

**Step 1: Write the failing tests**
- Add unit tests for fallible sidecar state helpers so poison/error paths return `Err` instead of panicking.

**Step 2: Run test to verify it fails**
- Run: `cargo test`

**Step 3: Write minimal implementation**
- Replace `expect`/`unwrap` sidecar lifecycle code with helper functions returning `Result`.

**Step 4: Run test to verify it passes**
- Run: `cargo test`

### Task 5: Desktop Permission Tightening

**Files:**
- Modify: `src-tauri/capabilities/default.json`

**Step 1: Update capability scope**
- Restrict default fs access to app data and rely on runtime workspace authorization for user-selected folders.

**Step 2: Verify config parses**
- Run: `cargo test`

### Task 6: Final Verification

**Files:**
- Modify: `src/stores/configStore.ts`
- Modify: `src/utils/storage.ts`
- Modify: `python_backend/main.py`
- Modify: `python_backend/runtime/logs.py`
- Modify: `python_backend/core/user.py`
- Modify: `python_backend/llms/openai.py`
- Modify: `python_backend/llms/deepseek.py`
- Modify: `python_backend/llms/qwen.py`
- Modify: `python_backend/llms/ollama.py`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`

**Step 1: Run targeted frontend tests**
- Run: `npm test -- src/stores/configStore.test.ts src/pages/SettingsPage.test.tsx`

**Step 2: Run targeted backend tests**
- Run: `python -m unittest python_backend.tests.test_session_execution python_backend.tests.test_run_logging python_backend.tests.test_llm_timeouts`

**Step 3: Run Rust verification**
- Run: `cargo test`

**Step 4: Run production build**
- Run: `npm run build`
