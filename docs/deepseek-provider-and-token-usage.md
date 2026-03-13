# DeepSeek Provider And Token Usage

## Summary

This workspace now supports `DeepSeek` as a first-class provider alongside `OpenAI`, `Qwen`, and `Ollama`.

The runtime also normalizes completion usage across providers and surfaces the latest request's token pressure in the workspace header.

## What Changed

- Added `deepseek` to frontend and backend provider config handling.
- Added dedicated backend provider implementation in `python_backend/llms/deepseek.py`.
- Added normalized completion usage payloads containing:
  - `prompt_tokens`
  - `completion_tokens`
  - `total_tokens`
  - optional `reasoning_tokens`
  - optional `context_length`
- Persisted assistant-message `usage` metadata so token information survives session reloads.
- Added a circular token-usage widget in the workspace header using the latest request's `prompt_tokens / context_length` ratio.

## DeepSeek Config Example

```json
{
  "provider": "deepseek",
  "model": "deepseek-chat",
  "api_key": "YOUR_KEY",
  "base_url": "https://api.deepseek.com",
  "enable_reasoning": false,
  "profiles": {
    "primary": {
      "profile_name": "primary",
      "provider": "deepseek",
      "model": "deepseek-chat",
      "api_key": "YOUR_KEY",
      "base_url": "https://api.deepseek.com",
      "enable_reasoning": false
    },
    "secondary": {
      "profile_name": "secondary",
      "provider": "deepseek",
      "model": "deepseek-reasoner",
      "api_key": "YOUR_KEY",
      "base_url": "https://api.deepseek.com",
      "enable_reasoning": true
    }
  },
  "runtime": {
    "context_length": 128000,
    "max_output_tokens": 4000
  }
}
```

## UI Behavior

- The header widget uses the latest completed request for the current session.
- The percentage is based on `prompt_tokens / context_length`.
- Hover text shows the concrete token counts.
- If a provider response does not include usage, the widget falls back to an empty state.
