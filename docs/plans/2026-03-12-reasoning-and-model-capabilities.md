# Reasoning and Model Capabilities Implementation Record

> **Status:** Completed on 2026-03-12

## Goal

Make reasoning support fully work from model settings through provider requests, backend streaming, and frontend realtime/history display while preserving room for future model capability expansion.

## What Was Implemented

### 1. Model settings

Implemented:

- frontend capability helper for whitelist-based reasoning and input type support
- reasoning toggle shown only for reasoning-capable models
- supported models default reasoning to enabled
- unsupported models automatically normalize to `enable_reasoning = false`
- `input_type` placeholder normalized with default `text`

Main files:

- `src/utils/modelCapabilities.ts`
- `src/utils/config.ts`
- `src/components/Settings/ProviderConfig.tsx`
- `src/pages/SettingsPage.tsx`
- `src/types/index.ts`

### 2. Model request layer

Implemented:

- backend capability helper shared across provider runtime logic
- OpenAI request builder with `reasoning_effort`
- Qwen request builder with `extra_body.enable_thinking`
- Ollama request builder with `think`
- backend normalization that enforces capability-based reasoning settings before provider creation

Main files:

- `python_backend/llms/capabilities.py`
- `python_backend/main.py`
- `python_backend/llms/openai.py`
- `python_backend/llms/qwen.py`
- `python_backend/llms/ollama.py`

### 3. Backend event layer

Implemented:

- preserved reasoning storage on assistant messages
- stopped passing `reasoning_content` back into upstream LLM message payloads
- added optional future metadata placeholders on stored messages
- Ollama native thinking content now maps into `reasoning_content`

Main files:

- `python_backend/core/user.py`
- `python_backend/llms/ollama.py`

### 4. Frontend realtime and history display

Implemented:

- live reasoning block rendered while reasoning is still streaming
- completed reasoning block kept as its own renderable message shape
- history loader reconstructs persisted reasoning into a standalone `reasoning` message before the assistant reply
- reasoning UI glyph cleaned up to ASCII-safe characters

Main files:

- `src/components/Chat/MessageList.tsx`
- `src/components/Reasoning/ReasoningBlock.tsx`
- `src/utils/storage.ts`

## Future-Ready Placeholders Added

The implementation leaves room for later work without changing the current runtime shape again:

- `input_type: 'text' | 'image'`
- optional message metadata: `profile_name`, `model_label`
- design target documented for `primary`, `fallback`, and `simple_task` profiles
- design target documented for `context length limit`, `max token`, `max tools turn`, and `max retry times`

## Capability Rules Implemented

### Reasoning-capable model prefixes

- OpenAI: `o1`, `o3`, `o4`, `gpt-5`
- Qwen: `qwen3`, `qwq`
- Ollama: `qwen3`, `deepseek-r1`, `magistral`, `phi4-reasoning`

### Image-capable model prefixes

- OpenAI: `gpt-4o`, `gpt-4.1`, `gpt-5`
- Qwen: `qvq`
- Ollama: none yet

## Verification Run

The following verification was run after implementation:

### Backend tests

Command:

```powershell
& 'C:\Users\patri\AppData\Local\Programs\Python\Python313\python.exe' -m unittest python_backend.tests.test_config_normalization python_backend.tests.test_connection_routing python_backend.tests.test_session_execution python_backend.tests.test_model_capabilities python_backend.tests.test_provider_reasoning_requests python_backend.tests.test_reasoning_streaming -v
```

Result:

- 18 tests ran
- all passed

### Frontend build

Command:

```powershell
npm.cmd run build
```

Result:

- `tsc && vite build` passed

### Diff hygiene

Command:

```powershell
git diff --check
```

Result:

- exit code 0
- only LF/CRLF warnings from Git working-tree normalization

### Manual validation

Manual validation was completed in the app and accepted for:

- reasoning toggle visibility by model capability
- supported-model default reasoning enabled
- live reasoning display
- history reasoning restore

## Known Limitation

OpenAI reasoning disable remains best-effort rather than a guaranteed hard-off mode for every reasoning family. The implementation uses:

- `reasoning_effort='none'` for `gpt-5*`
- `reasoning_effort='minimal'` for older reasoning models when the toggle is off

## Files Added

- `docs/plans/2026-03-12-reasoning-and-model-capabilities-design.md`
- `docs/plans/2026-03-12-reasoning-and-model-capabilities.md`
- `python_backend/llms/capabilities.py`
- `python_backend/tests/test_model_capabilities.py`
- `python_backend/tests/test_provider_reasoning_requests.py`
- `python_backend/tests/test_reasoning_streaming.py`
- `src/utils/modelCapabilities.ts`

## Files Updated

- `python_backend/core/user.py`
- `python_backend/llms/ollama.py`
- `python_backend/llms/openai.py`
- `python_backend/llms/qwen.py`
- `python_backend/main.py`
- `python_backend/tests/test_config_normalization.py`
- `src/components/Chat/MessageList.tsx`
- `src/components/Reasoning/ReasoningBlock.tsx`
- `src/components/Settings/ProviderConfig.tsx`
- `src/pages/SettingsPage.tsx`
- `src/types/index.ts`
- `src/utils/config.ts`
- `src/utils/index.ts`
- `src/utils/storage.ts`
