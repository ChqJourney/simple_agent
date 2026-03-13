# Conversation And Background Model Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make normal chat messages always use the primary conversation model, reserve the secondary model for background tasks, and remove the locked-model UI from the workspace page.

**Architecture:** Replace prompt-shape routing with explicit conversation/background profile helpers. Keep session lock semantics for the conversation path only, and make title generation resolve its own background-profile LLM.

**Tech Stack:** Python backend, FastAPI websocket runtime, React, TypeScript, Vitest, unittest

---

### Task 1: Update backend routing semantics

**Files:**
- Modify: `python_backend/runtime/router.py`
- Test: `python_backend/tests/test_model_router.py`

**Step 1: Write the failing tests**

Add tests for:

- `resolve_conversation_profile()` returning the primary profile
- `resolve_background_profile()` returning the secondary profile when present
- `resolve_background_profile()` falling back to primary when no secondary profile exists

**Step 2: Run test to verify it fails**

Run:

```powershell
python -m unittest python_backend.tests.test_model_router.ModelRouterTests -v
```

Expected:

- tests fail because the old task-kind router API is still in place

**Step 3: Write minimal implementation**

Implement explicit profile helpers and remove task-kind routing helpers from normal use.

**Step 4: Run test to verify it passes**

Run:

```powershell
python -m unittest python_backend.tests.test_model_router.ModelRouterTests -v
```

Expected:

- routing tests pass

### Task 2: Make normal chat always use the conversation profile

**Files:**
- Modify: `python_backend/main.py`
- Test: `python_backend/tests/test_model_router.py`

**Step 1: Write the failing test**

Add a test proving a short user message still locks to the primary profile and creates the conversation agent with the primary model.

**Step 2: Run test to verify it fails**

Run:

```powershell
python -m unittest python_backend.tests.test_model_router.ModelRouterTests.test_handle_user_message_routes_short_prompt_to_primary_conversation_profile -v
```

Expected:

- the test fails because short prompts currently use the secondary profile

**Step 3: Write minimal implementation**

Resolve the conversation profile directly in user-message handling and keep lock validation tied to that profile.

**Step 4: Run test to verify it passes**

Run:

```powershell
python -m unittest python_backend.tests.test_model_router.ModelRouterTests.test_handle_user_message_routes_short_prompt_to_primary_conversation_profile -v
```

Expected:

- the test passes

### Task 3: Route session title generation through the background profile

**Files:**
- Modify: `python_backend/main.py`
- Modify: `python_backend/runtime/session_titles.py`
- Test: `python_backend/tests/test_model_router.py`

**Step 1: Write the failing tests**

Add tests proving:

- title generation uses the secondary/background profile when configured
- title generation falls back to primary when secondary is absent
- title generation does not change the session's locked conversation model

**Step 2: Run test to verify it fails**

Run:

```powershell
python -m unittest python_backend.tests.test_model_router.ModelRouterTests.test_session_title_uses_background_profile python_backend.tests.test_model_router.ModelRouterTests.test_session_title_falls_back_to_primary_when_background_missing -v
```

Expected:

- tests fail because title generation currently reuses the conversation agent's LLM

**Step 3: Write minimal implementation**

Create the title-generation LLM from the background profile and pass it into the title task.

**Step 4: Run test to verify it passes**

Run:

```powershell
python -m unittest python_backend.tests.test_model_router.ModelRouterTests.test_session_title_uses_background_profile python_backend.tests.test_model_router.ModelRouterTests.test_session_title_falls_back_to_primary_when_background_missing -v
```

Expected:

- tests pass

### Task 4: Remove locked-model UI and update settings copy

**Files:**
- Modify: `src/pages/WorkspacePage.tsx`
- Modify: `src/pages/WorkspacePage.test.tsx`
- Modify: `src/pages/SettingsPage.tsx`
- Modify: `src/pages/SettingsPage.test.tsx`

**Step 1: Write the failing tests**

Add tests for:

- workspace page not rendering the `Locked:` badge even when session metadata includes `locked_model`
- settings page describing the secondary model as a background-task model for internal helper work

**Step 2: Run test to verify it fails**

Run:

```powershell
npm.cmd run test -- src/pages/WorkspacePage.test.tsx src/pages/SettingsPage.test.tsx
```

Expected:

- UI tests fail because the badge and old copy still exist

**Step 3: Write minimal implementation**

Remove the locked-model badge and update settings copy.

**Step 4: Run test to verify it passes**

Run:

```powershell
npm.cmd run test -- src/pages/WorkspacePage.test.tsx src/pages/SettingsPage.test.tsx
```

Expected:

- UI tests pass

### Task 5: Run focused verification

**Files:**
- Modify: `python_backend/runtime/router.py`
- Modify: `python_backend/main.py`
- Modify: `src/pages/WorkspacePage.tsx`
- Modify: `src/pages/SettingsPage.tsx`
- Test: `python_backend/tests/test_model_router.py`
- Test: `src/pages/WorkspacePage.test.tsx`
- Test: `src/pages/SettingsPage.test.tsx`

**Step 1: Run backend verification**

```powershell
python -m unittest python_backend.tests.test_model_router -v
```

Expected:

- backend routing and title tests all pass

**Step 2: Run frontend verification**

```powershell
npm.cmd run test -- src/pages/WorkspacePage.test.tsx src/pages/SettingsPage.test.tsx
```

Expected:

- frontend tests pass

**Step 3: Run build verification**

```powershell
npm.cmd run build
```

Expected:

- build succeeds
