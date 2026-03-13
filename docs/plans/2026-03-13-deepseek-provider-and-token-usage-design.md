# DeepSeek Provider And Token Usage Design

> **Status:** Approved on 2026-03-13

## Goal

Add DeepSeek as a first-class LLM provider across backend runtime and frontend settings, and surface per-request token usage in the workspace header so the user can quickly see how close the latest prompt is to the active model's context limit.

## Scope

This change includes:

- a new `deepseek` provider in backend routing, config normalization, settings UI, and connection testing
- token usage normalization for all supported providers, not only DeepSeek
- a session-level "latest request usage" view model for the workspace UI
- a circular usage widget in the top-right workspace header area

This change does not include:

- historical usage analytics
- accumulated session token totals
- server-side billing or quota tracking

## Problem

The app currently supports `openai`, `qwen`, and `ollama`, but provider handling is explicit in both frontend and backend. Adding DeepSeek therefore requires touching multiple enum, config, and factory boundaries rather than only swapping a base URL.

The app also already forwards `usage` on completion in some paths, but usage handling is incomplete:

- it is not normalized as a cross-provider runtime capability
- it is only attached to the latest assistant message in frontend chat state
- there is no header-level indicator showing how close the latest prompt is to the model context window

For the intended user workflow, the important signal is not total session usage. It is whether the latest request's prompt is approaching the active model's context length limit.

## Design Principles

1. Treat DeepSeek as a real provider, not as an OpenAI alias hidden in UI defaults.
2. Normalize usage at the LLM/runtime boundary so the frontend does not guess provider-specific fields.
3. Display latest-request prompt pressure, not cumulative session totals.
4. Reuse persisted assistant message data for refresh recovery instead of introducing a second usage store.
5. Keep provider-specific model capability logic explicit and testable.

## Target Behavior

### DeepSeek provider

- Settings page offers `DeepSeek` alongside `OpenAI`, `Qwen`, and `Ollama`.
- Default DeepSeek base URL is `https://api.deepseek.com`.
- Backend `/test-config` accepts `deepseek` as a supported provider.
- Runtime config normalization preserves `deepseek` in primary and secondary profiles.
- Backend LLM factory can create `DeepSeekLLM` instances for any profile.

### Usage capture

- Every provider returns a normalized usage object when the upstream API exposes usage data.
- The normalized shape remains:
  - `prompt_tokens`
  - `completion_tokens`
  - `total_tokens`
  - optional `reasoning_tokens`
- Completion events also include the context length used for the active request.

### Header widget

- The workspace top-right header shows a circular percentage widget for the current session.
- The percentage is calculated as `latest_prompt_tokens / context_length`.
- The ring is capped visually at `100%`, while hover text still shows the true numbers.
- Hover text shows at least:
  - `prompt: xxxxx / context: yyyyyyy`
  - `completion: zzzzz`
  - `total: nnnnn`
- If reasoning token data exists, hover also shows it.
- If there is no recent usage for the current session, the widget renders an empty/placeholder state.

## Backend Design

### Provider implementation

Add `python_backend/llms/deepseek.py` as a dedicated provider class. Its external contract should match the existing LLM classes:

- `stream(messages, tools)`
- `complete(messages, tools)`

Internally it may use the OpenAI-compatible client shape, but the provider identity remains `deepseek` throughout runtime config and UI.

### Runtime config

Update runtime config normalization so `deepseek` has:

- its own default base URL
- standard profile normalization
- reasoning coercion rules
- input type coercion

DeepSeek model capability rules should be explicit rather than inferred from the OpenAI branch.

### Usage normalization

The LLM/runtime boundary should own normalized usage extraction.

Recommended implementation shape:

- add a lightweight helper on each provider to extract usage from the final response or final stream chunk
- keep the normalized frontend/backend contract stable
- pass `context_length` alongside usage in the final completion event

This keeps provider-specific parsing in provider modules and keeps `Agent` responsible only for transport and message lifecycle.

### Context length resolution

The context length sent to the frontend should resolve in this order:

1. explicit runtime config `context_length`
2. known provider/model default from capability metadata
3. `None` if unknown

For the initial implementation, a pragmatic model-limit table is sufficient. It can start with the common built-in defaults used in settings and known reasoning models, including DeepSeek's `deepseek-chat` and `deepseek-reasoner`.

### Completion event contract

The websocket `completed` message should carry a single payload for the last request's usage snapshot, for example:

- normalized token usage
- resolved `context_length`
- optional model/provider metadata if already convenient

The frontend should not compute token estimates on its own.

## Frontend Design

### Settings and config

Update provider types, base URL defaults, config normalization, and provider/model pickers to include `deepseek`.

The UI should treat DeepSeek exactly like other remote providers:

- API key required
- base URL editable
- model selectable
- reasoning toggle shown only for reasoning-capable models

### Session usage view model

The frontend should keep a session-level "latest usage snapshot" rather than recomputing from all messages on every render. This snapshot should be updated when:

- a `completed` websocket event arrives with usage
- a session history load finds the last assistant message with usage metadata

This state should be separate from `runStore` because it is presentation data tied to chat/session recovery, not run-event timelines.

### Header widget

Add a small circular progress widget to the right-side header cluster near model/status indicators.

It should:

- work with the current compact header height
- show a numeric percentage in the center when data is available
- expose detailed token counts on hover
- degrade gracefully when `context_length` or usage is missing

The widget should read from the current session, not global config alone, because the latest request usage is session-specific.

## Persistence And Recovery

Persist usage on assistant messages so refresh and session reload can recover the latest snapshot without a new backend call.

When loading session history:

- deserialize `usage` on assistant messages
- find the latest assistant message carrying usage metadata
- restore the header widget state from that message

This avoids introducing a new sidecar metadata file for usage.

## Error Handling

- If a provider does not return usage, the completion still succeeds and the widget remains empty.
- If context length is unknown, show the usage numbers but no percentage ring fill.
- If a model is not recognized in the built-in context-length table and no runtime override is set, do not fabricate a limit.
- If a saved session contains malformed usage data, ignore it and continue loading the rest of the transcript.

## Testing

Add or update tests for:

- provider/config normalization accepting `deepseek`
- backend provider factory creating `DeepSeekLLM`
- `/test-config` accepting DeepSeek and applying the correct auth/base URL behavior
- provider usage normalization for `openai`, `qwen`, `ollama`, and `deepseek`
- completion events carrying usage and context length
- history deserialization preserving usage
- session-level latest-usage recovery from persisted messages
- top bar widget percentage and hover text rendering

## Recommended Implementation Order

1. Extend shared provider/config types and default base URLs.
2. Add DeepSeek backend provider and provider-factory wiring.
3. Add standardized usage extraction and completion payload enrichment.
4. Persist and restore usage through session history.
5. Add the header widget and wire it to current-session state.
6. Verify backend and frontend tests plus targeted manual UI behavior.
