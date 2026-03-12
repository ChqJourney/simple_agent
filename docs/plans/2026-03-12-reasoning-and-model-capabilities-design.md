# Reasoning and Model Capabilities Design

> **Status:** Implemented on 2026-03-12

## Goal

Make reasoning support actually usable end-to-end in the current app while keeping the configuration shape ready for future model capabilities, limits, multi-model routing, and input type support.

## Scope

This design covers four areas:

1. Model settings
2. Model request layer
3. Backend reasoning event flow
4. Frontend realtime and history display

This design still does not implement multi-model routing. It only prepares the structure so later work can add:

- primary / fallback / simple-task models
- `context length limit`
- `max token`
- `max tools turn`
- `max retry times`
- `input type: text | image`

## Current State After Implementation

The current code now supports reasoning across the main flow:

- settings only show the reasoning toggle for reasoning-capable models
- supported models default reasoning to enabled
- frontend and backend both use whitelist-based capability helpers
- provider requests now inject reasoning parameters for supported models
- backend preserves and streams reasoning content
- frontend renders reasoning live during streaming and restores it from history
- config normalization now also carries a future-ready `input_type`

## Implemented Capability Model

Capability detection is whitelist-based and duplicated intentionally on frontend and backend so UI and runtime both make the same decision.

### Reasoning-capable model prefixes

- OpenAI: `o1`, `o3`, `o4`, `gpt-5`
- Qwen: `qwen3`, `qwq`
- Ollama: `qwen3`, `deepseek-r1`, `magistral`, `phi4-reasoning`

### Image-capable model prefixes

- OpenAI: `gpt-4o`, `gpt-4.1`, `gpt-5`
- Qwen: `qvq`
- Ollama: none yet

## Configuration Shape

The app still uses the current flat transport shape for runtime compatibility, but the implementation now reserves space for future configuration growth.

### Target shape

```ts
type InputType = 'text' | 'image';

interface ModelProfile {
  provider: 'openai' | 'qwen' | 'ollama';
  model: string;
  api_key: string;
  base_url: string;
  input_type?: InputType;
  reasoning?: {
    enabled: boolean;
  };
  limits?: {
    context_window_limit?: number;
    max_output_tokens?: number;
  };
}

interface RuntimePolicy {
  max_tool_turns?: number;
  max_retries?: number;
}

interface LLMSettings {
  profiles: {
    primary: ModelProfile;
    fallback?: ModelProfile;
    simple_task?: ModelProfile;
  };
  runtime?: RuntimePolicy;
}
```

### Near-term compatibility rule

This iteration keeps the flat config shape, but the code now normalizes these fields in a future-ready way:

- `provider`
- `model`
- `api_key`
- `base_url`
- `enable_reasoning`
- `input_type`

Message metadata also now allows optional placeholders for:

- `profile_name`
- `model_label`

## Model Settings Design

### Implemented behavior

- show reasoning toggle only when the selected model supports reasoning
- default the toggle to enabled for supported models
- hide the toggle for unsupported models
- coerce `enable_reasoning = false` in normalized config when unsupported
- keep `input_type` in the config model, defaulting to `text`

### Future-ready behavior

The current settings page still edits a single runtime model, but the type shape now leaves room for later profile-based settings such as `primary`, `fallback`, and `simple_task`.

## Model Request Layer Design

Provider requests now go through capability-aware parameter assembly.

### Decision rule

```text
reasoning_enabled_for_request =
  config.enable_reasoning
  AND supports_reasoning(provider, model)
```

### Implemented provider behavior

- OpenAI: injects `reasoning_effort` for supported models
- Qwen: injects `extra_body.enable_thinking`
- Ollama: injects `think` and converts native thinking chunks into `reasoning_content`

### Known limitation

OpenAI reasoning disable is best-effort. For `gpt-5*`, the code sends `reasoning_effort='none'`; for older reasoning models it falls back to `minimal`, because the upstream chat-completions API does not expose one uniform hard-off behavior across all reasoning families.

## Backend Event Layer Design

The event names remain unchanged:

- `reasoning_token`
- `reasoning_complete`

The stored assistant message can continue to hold:

- `content`
- `reasoning_content`

The backend message model now also tolerates future routing metadata:

- `profile_name`
- `model_label`

## Frontend Realtime Display Design

### Implemented behavior

When reasoning is streaming:

- a temporary reasoning block is rendered in the message list
- the assistant message can continue streaming separately

When reasoning is restored from history:

1. a `reasoning` message is reconstructed
2. the original `assistant` message is rendered after it

This keeps live and historical rendering behavior aligned.

## Testing Strategy

### Backend coverage implemented

- config normalization tests for reasoning-capable and non-capable models
- provider request builder tests for reasoning params
- reasoning chunk conversion tests
- session execution coverage retained for routing compatibility

### Frontend verification implemented

- TypeScript build verification
- manual app validation for settings visibility, default state, realtime reasoning, and history restore

## Risks

- model naming drift can make whitelist rules stale
- provider request formats for reasoning may differ over time
- OpenAI reasoning-off semantics remain partially provider-defined

## Follow-up Work

Not in scope for this iteration, but directly supported by the design:

- backend-delivered capability API
- profile selector for `primary`, `fallback`, and `simple_task`
- configurable `context length limit`
- configurable `max token`
- configurable `max tools turn`
- configurable `max retry times`
- `input type` UI and image-capable request construction
