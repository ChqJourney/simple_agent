# Interrupt Preserve Partial Output Design

## Goal

Keep already streamed assistant content visible after the user clicks `Stop generating`.

## Scope

This fix is intentionally narrow:

- preserve partially streamed assistant text on interrupt
- do not preserve in-progress reasoning content
- do not change interrupt button placement or keyboard behavior

## Root Cause

The frontend currently treats `interrupted` as a terminal cleanup that clears `currentStreamingContent`. The message list only renders that assistant content from the temporary streaming buffer, so once the buffer is cleared the visible partial reply disappears.

## Design

On interrupt, the chat store should finalize any currently streamed assistant text into the message list before ending the streaming state.

Behavior:

- if `currentStreamingContent` is non-empty, create or update the assistant message as completed content
- clear streaming flags after that content is preserved
- clear `currentReasoningContent` without persisting it
- reset transient tool UI state

This mirrors the completion path closely, but without token usage and without preserving reasoning.
