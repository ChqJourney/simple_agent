# DeepSeek Provider And Token Usage Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add DeepSeek as a first-class provider, normalize token usage across all providers, and show the latest request's prompt/context pressure in the workspace header.

**Architecture:** Keep provider handling explicit in runtime config and the LLM factory, add a dedicated `DeepSeekLLM`, standardize usage extraction at the provider/runtime boundary, and project the latest usage snapshot into a compact top-bar widget.

**Tech Stack:** Python backend, FastAPI, React, TypeScript, Zustand, unittest, Vitest

---

### Task 1: Extend shared provider and config contracts

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/utils/config.ts`
- Modify: `python_backend/runtime/config.py`
- Test: `src/utils/config.test.ts`
- Test: `python_backend/tests/test_runtime_contracts.py`
- Test: `python_backend/tests/test_config_normalization.py`

**Step 1: Write the failing tests**

Add tests proving:

- `deepseek` is accepted as a provider type in normalized frontend config
- DeepSeek gets the correct default base URL
- backend config normalization preserves `deepseek` profiles

**Step 2: Run test to verify it fails**

Run:

```powershell
python -m unittest python_backend.tests.test_config_normalization python_backend.tests.test_runtime_contracts -v
npm test -- src/utils/config.test.ts
```

Expected:

- tests fail because `deepseek` is not yet recognized

**Step 3: Write minimal implementation**

Update provider enums/unions, default base URLs, and runtime normalization for `deepseek`.

**Step 4: Run test to verify it passes**

Run the same commands again and confirm all new tests pass.

### Task 2: Add the DeepSeek backend provider

**Files:**
- Create: `python_backend/llms/deepseek.py`
- Modify: `python_backend/llms/__init__.py`
- Modify: `python_backend/main.py`
- Test: `python_backend/tests/test_config_normalization.py`
- Test: `python_backend/tests/test_llm_runtime_limits.py`

**Step 1: Write the failing tests**

Add tests proving:

- the backend LLM factory can create a DeepSeek provider
- DeepSeek uses the expected default base URL
- DeepSeek request kwargs include output-token limits when configured

**Step 2: Run test to verify it fails**

Run:

```powershell
python -m unittest python_backend.tests.test_config_normalization python_backend.tests.test_llm_runtime_limits -v
```

Expected:

- tests fail because the provider class and factory branch do not exist

**Step 3: Write minimal implementation**

Create `DeepSeekLLM` with the same streaming and completion interface as other providers and wire it into `create_llm_for_profile()`.

**Step 4: Run test to verify it passes**

Run the same command again and confirm the DeepSeek provider tests pass.

### Task 3: Expose DeepSeek in settings and connection testing

**Files:**
- Modify: `src/components/Settings/ProviderConfig.tsx`
- Modify: `src/pages/SettingsPage.tsx`
- Modify: `src/components/common/ModelDisplay.tsx`
- Modify: `python_backend/main.py`
- Test: `src/pages/SettingsPage.test.tsx`

**Step 1: Write the failing tests**

Add tests proving:

- the settings provider selector shows `DeepSeek`
- model/provider display labels render `DeepSeek`
- backend `/test-config` accepts `deepseek`

**Step 2: Run test to verify it fails**

Run:

```powershell
python -m unittest python_backend.tests.test_config_normalization -v
npm test -- src/pages/SettingsPage.test.tsx
```

Expected:

- tests fail because the UI and backend probe path do not recognize `deepseek`

**Step 3: Write minimal implementation**

Add DeepSeek to the provider lists, labels, model suggestions, and remote provider connection-testing path.

**Step 4: Run test to verify it passes**

Run the same command again and confirm the new tests pass.

### Task 4: Normalize provider usage for all LLMs

**Files:**
- Modify: `python_backend/llms/base.py`
- Modify: `python_backend/llms/openai.py`
- Modify: `python_backend/llms/qwen.py`
- Modify: `python_backend/llms/ollama.py`
- Modify: `python_backend/llms/deepseek.py`
- Test: `python_backend/tests/test_provider_reasoning_requests.py`
- Test: `python_backend/tests/test_llm_runtime_limits.py`
- Create or Modify: `python_backend/tests/test_provider_usage.py`

**Step 1: Write the failing tests**

Add tests proving:

- OpenAI, Qwen, DeepSeek, and Ollama each produce normalized usage data
- reasoning token data is preserved when present
- missing upstream usage does not break the request path

**Step 2: Run test to verify it fails**

Run:

```powershell
python -m unittest python_backend.tests.test_provider_usage -v
```

Expected:

- tests fail because there is no unified usage-normalization contract yet

**Step 3: Write minimal implementation**

Add a shared normalized-usage shape and provider-specific extraction helpers. Keep provider-specific parsing inside the provider modules.

**Step 4: Run test to verify it passes**

Run the same command again and confirm the usage normalization tests pass.

### Task 5: Enrich completion events with latest-request usage and context length

**Files:**
- Modify: `python_backend/core/agent.py`
- Modify: `src/types/index.ts`
- Modify: `src/contexts/WebSocketContext.tsx`
- Test: `python_backend/tests/test_reasoning_streaming.py`
- Test: `src/contexts/WebSocketContext.test.tsx`

**Step 1: Write the failing tests**

Add tests proving:

- backend `completed` events include normalized usage and resolved `context_length`
- frontend websocket handling stores the latest usage snapshot for the session

**Step 2: Run test to verify it fails**

Run:

```powershell
python -m unittest python_backend.tests.test_reasoning_streaming -v
npm test -- src/contexts/WebSocketContext.test.tsx
```

Expected:

- tests fail because completion payloads do not include the enriched latest-usage snapshot

**Step 3: Write minimal implementation**

Update the agent completion path to send the latest-request usage plus resolved context length, and update frontend websocket handling to store that snapshot.

**Step 4: Run test to verify it passes**

Run the same commands again and confirm the enriched event path passes.

### Task 6: Persist and restore usage through session history

**Files:**
- Modify: `python_backend/core/user.py`
- Modify: `src/utils/storage.ts`
- Modify: `src/stores/chatStore.ts`
- Create or Modify: `src/utils/storage.test.ts`
- Create or Modify: `src/stores/chatStore.test.ts`

**Step 1: Write the failing tests**

Add tests proving:

- assistant messages persist usage metadata
- history deserialization preserves usage metadata
- the frontend can recover the latest session usage snapshot from persisted messages

**Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- src/utils/storage.test.ts src/stores/chatStore.test.ts
```

Expected:

- tests fail because usage is not persisted and restored end-to-end

**Step 3: Write minimal implementation**

Persist usage on assistant messages, deserialize it from session history, and expose a helper in chat state to recover the latest usage snapshot.

**Step 4: Run test to verify it passes**

Run the same command again and confirm the persistence tests pass.

### Task 7: Add the top-bar token usage widget

**Files:**
- Create: `src/components/common/TokenUsageWidget.tsx`
- Modify: `src/components/Workspace/TopBar.tsx`
- Modify: `src/components/common/index.ts`
- Modify: `src/pages/WorkspacePage.test.tsx`
- Create or Modify: `src/components/common/TokenUsageWidget.test.tsx`

**Step 1: Write the failing tests**

Add tests proving:

- the widget renders the latest prompt/context percentage
- hover text shows prompt/context and token details
- the widget shows an empty state when no usage exists

**Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- src/components/common/TokenUsageWidget.test.tsx src/pages/WorkspacePage.test.tsx
```

Expected:

- tests fail because the widget does not exist and the top bar does not render it

**Step 3: Write minimal implementation**

Build a compact circular progress component and mount it in the top-right header cluster beside websocket/model status.

**Step 4: Run test to verify it passes**

Run the same command again and confirm the widget tests pass.

### Task 8: Run full verification

**Files:**
- No code changes

**Step 1: Run backend verification**

Run:

```powershell
python -m unittest discover python_backend/tests -v
```

Expected:

- backend test suite passes

**Step 2: Run frontend verification**

Run:

```powershell
npm test -- --runInBand
```

Expected:

- frontend tests pass

**Step 3: Run targeted manual smoke checks**

Verify:

- DeepSeek can be selected and saved in settings
- connection testing works for DeepSeek
- a completed response from each provider shows usage in the latest assistant message
- the header widget updates after a run and survives session reload
