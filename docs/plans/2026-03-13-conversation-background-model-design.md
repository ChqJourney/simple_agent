# Conversation And Background Model Design

> **Status:** Approved on 2026-03-13

## Goal

Replace the current "route simple user prompts to the secondary profile" behavior with an explicit split between:

- a conversation model for normal user chat turns
- a background model for internal lightweight tasks such as session title generation

The workspace chat UI should no longer show a locked-model badge.

## Problem

The current implementation treats the secondary model as a runtime shortcut for simple user prompts. That creates two product problems:

1. It changes the execution model for ordinary chat messages based on prompt shape rather than user intent.
2. It exposes the resulting session lock in the workspace UI, which suggests that normal chat conversations may hop between profiles.

This conflicts with the intended design: the secondary model is reserved for internal helper work, not for routing user conversations by perceived difficulty.

## Design Principles

1. Ordinary chat should be predictable and always use the same conversation model.
2. Internal helper work may use a cheaper or faster background model without affecting the active chat session.
3. Session lock metadata should represent only the model used for the user conversation.
4. Model-selection code should use explicit names tied to responsibilities instead of "simple task" heuristics.

## Target Behavior

### Conversation model

- All normal user messages in the workspace chat use the primary profile.
- Session lock metadata continues to record the profile, provider, and model used for the conversation path.
- Changing the configured models later does not mutate an already locked session.

### Background model

- Session title generation uses the secondary profile when present.
- If the secondary profile is not configured, background tasks fall back to the primary profile.
- Background-task model selection does not overwrite session lock metadata.

### UI

- Remove the chat-page locked-model pill.
- Settings copy should describe the secondary model as a background-task model rather than a model for lightweight user prompts.

## Backend Design

### Router helpers

Remove the "simple/default task kind" path from the router. Replace it with explicit helpers:

- `resolve_conversation_profile(config)` returns the primary profile
- `resolve_background_profile(config)` returns the secondary profile when configured, otherwise the primary profile
- `resolve_profile_for_lock(config, locked_model)` remains for restoring an existing conversation lock

This keeps session restoration behavior while removing prompt-shape routing.

### Message execution

Normal user-message handling should:

- resolve the conversation profile directly
- lock the session to that profile when first used
- reject future requests if the stored lock no longer matches the configured conversation profile

No user-message path should inspect prompt length, line count, or attachments to change models.

### Title generation

Title generation should create or reuse an LLM configured from the background profile instead of reusing the conversation agent's model. This keeps helper work separate from session execution semantics.

## Frontend Design

### Workspace page

Remove the locked-model badge from the workspace page. Session metadata may still keep `locked_model` for backend correctness and persistence, but it is no longer surfaced in the main chat UI.

### Settings page

Retain the two-profile editor but update copy to reflect their responsibilities:

- primary model: user conversation
- secondary model: background helper tasks such as title generation

## Testing

Add or update tests for:

- conversation profile resolution always choosing primary
- background profile resolution preferring secondary and falling back to primary
- normal user messages locking to the conversation profile even when the prompt is short
- title generation using the background profile
- workspace page no longer rendering the locked-model badge
- settings page copy describing the secondary model as a background-task model
