import { Attachment, Message, ToolCall } from '../types';
import { LockedModelRef } from '../types';
import {
  createToolDecisionSummary,
  createToolResultSummary,
  inferPersistedToolResult,
  parseToolDecisionContent,
} from './toolMessages';

let cachedIsTauri: boolean | null = null;

async function checkIsTauri(): Promise<boolean> {
  if (cachedIsTauri !== null) {
    return cachedIsTauri;
  }
  try {
    await import('@tauri-apps/plugin-fs');
    cachedIsTauri = true;
    return true;
  } catch {
    cachedIsTauri = false;
    return false;
  }
}

async function tauriExists(path: string): Promise<boolean> {
  if (!(await checkIsTauri())) {
    return false;
  }
  const { exists } = await import('@tauri-apps/plugin-fs');
  return exists(path);
}

async function tauriReadDir(path: string) {
  if (!(await checkIsTauri())) {
    return [];
  }
  const { readDir } = await import('@tauri-apps/plugin-fs');
  return readDir(path);
}

async function tauriReadTextFile(path: string) {
  if (!(await checkIsTauri())) {
    return '';
  }
  const { readTextFile } = await import('@tauri-apps/plugin-fs');
  return readTextFile(path);
}

async function tauriRemove(path: string): Promise<void> {
  if (!(await checkIsTauri())) {
    return;
  }
  const { remove } = await import('@tauri-apps/plugin-fs');
  await remove(path);
}

export function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString();
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export function generateSessionName(firstMessage: string): string {
  const maxLen = 30;
  const cleaned = firstMessage.replace(/\n/g, ' ').trim();
  return truncateText(cleaned, maxLen);
}

function normalizePersistedToolCall(
  rawToolCall: unknown,
  toolNamesById: Map<string, string>
): ToolCall | null {
  if (!rawToolCall || typeof rawToolCall !== 'object') {
    return null;
  }

  const candidate = rawToolCall as {
    id?: unknown;
    tool_call_id?: unknown;
    name?: unknown;
    arguments?: unknown;
    function?: {
      name?: unknown;
      arguments?: unknown;
    };
  };

  const toolCallId =
    typeof candidate.tool_call_id === 'string'
      ? candidate.tool_call_id
      : typeof candidate.id === 'string'
        ? candidate.id
        : null;
  const toolName =
    typeof candidate.name === 'string'
      ? candidate.name
      : typeof candidate.function?.name === 'string'
        ? candidate.function.name
        : null;
  const rawArguments =
    candidate.arguments !== undefined
      ? candidate.arguments
      : candidate.function?.arguments;

  if (!toolCallId || !toolName) {
    return null;
  }

  let parsedArguments: Record<string, unknown> = {};
  if (typeof rawArguments === 'string') {
    try {
      const parsed = JSON.parse(rawArguments);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        parsedArguments = parsed as Record<string, unknown>;
      }
    } catch {
      parsedArguments = {};
    }
  } else if (rawArguments && typeof rawArguments === 'object' && !Array.isArray(rawArguments)) {
    parsedArguments = rawArguments as Record<string, unknown>;
  }

  toolNamesById.set(toolCallId, toolName);

  return {
    tool_call_id: toolCallId,
    name: toolName,
    arguments: parsedArguments,
  };
}

function normalizePersistedAttachment(rawAttachment: unknown): Attachment | null {
  if (!rawAttachment || typeof rawAttachment !== 'object') {
    return null;
  }

  const candidate = rawAttachment as {
    kind?: unknown;
    path?: unknown;
    name?: unknown;
    mime_type?: unknown;
    data_url?: unknown;
  };

  if (candidate.kind !== 'image' || typeof candidate.path !== 'string' || typeof candidate.name !== 'string') {
    return null;
  }

  return {
    kind: 'image',
    path: candidate.path,
    name: candidate.name,
    mime_type: typeof candidate.mime_type === 'string' ? candidate.mime_type : undefined,
    data_url: typeof candidate.data_url === 'string' ? candidate.data_url : undefined,
  };
}

function normalizePersistedUsage(rawUsage: unknown): Message['usage'] {
  if (!rawUsage || typeof rawUsage !== 'object') {
    return undefined;
  }

  const candidate = rawUsage as Partial<NonNullable<Message['usage']>>;

  if (
    typeof candidate.prompt_tokens !== 'number'
    || typeof candidate.completion_tokens !== 'number'
    || typeof candidate.total_tokens !== 'number'
  ) {
    return undefined;
  }

  return {
    prompt_tokens: candidate.prompt_tokens,
    completion_tokens: candidate.completion_tokens,
    total_tokens: candidate.total_tokens,
    reasoning_tokens: typeof candidate.reasoning_tokens === 'number' ? candidate.reasoning_tokens : undefined,
    context_length: typeof candidate.context_length === 'number' ? candidate.context_length : undefined,
  };
}

export function deserializeSessionHistoryEntry(
  data: Record<string, unknown>,
  toolNamesById: Map<string, string> = new Map()
): Message[] {
  const messages: Message[] = [];

  if (data.role === 'assistant' && typeof data.reasoning_content === 'string' && data.reasoning_content) {
    messages.push({
      id: crypto.randomUUID(),
      role: 'reasoning',
      content: data.reasoning_content,
      status: 'completed',
    });
  }

  const normalizedToolCalls = Array.isArray(data.tool_calls)
    ? data.tool_calls
      .map((toolCall) => normalizePersistedToolCall(toolCall, toolNamesById))
      .filter((toolCall): toolCall is ToolCall => toolCall !== null)
    : undefined;

  const toolCallId = typeof data.tool_call_id === 'string' ? data.tool_call_id : undefined;
  const rawName = typeof data.name === 'string' ? data.name : undefined;
  const resolvedToolName = (toolCallId && toolNamesById.get(toolCallId)) || rawName || 'tool';
  const content = typeof data.content === 'string' ? data.content : data.content == null ? null : String(data.content);

  const message: Message = {
    id: crypto.randomUUID(),
    role: (data.role as Message['role']) || 'assistant',
    content,
    attachments: Array.isArray(data.attachments)
      ? data.attachments
          .map((attachment) => normalizePersistedAttachment(attachment))
          .filter((attachment): attachment is Attachment => attachment !== null)
      : undefined,
    tool_calls: normalizedToolCalls,
    tool_call_id: toolCallId,
    name: rawName,
    usage: normalizePersistedUsage(data.usage),
    profile_name: typeof data.profile_name === 'string' ? data.profile_name : undefined,
    model_label: typeof data.model_label === 'string' ? data.model_label : undefined,
    status: 'completed',
  };

  if (message.role === 'tool' && rawName === 'tool_decision' && content) {
    const parsedDecision = parseToolDecisionContent(content);
    if (parsedDecision) {
      message.name = resolvedToolName;
      message.content = createToolDecisionSummary(resolvedToolName, parsedDecision.decision);
      message.toolMessage = {
        kind: 'decision',
        toolName: resolvedToolName,
        decision: parsedDecision.decision,
        scope: parsedDecision.scope,
        reason: parsedDecision.reason,
      };
      message.status = parsedDecision.decision === 'reject' ? 'error' : 'completed';
    }
  } else if (message.role === 'tool' && toolCallId) {
    const inferredResult = inferPersistedToolResult(content);
    message.name = resolvedToolName;
    message.content = createToolResultSummary(resolvedToolName, inferredResult.success);
    message.toolMessage = {
      kind: 'result',
      toolName: resolvedToolName,
      success: inferredResult.success,
      details: inferredResult.details,
    };
    message.status = inferredResult.success ? 'completed' : 'error';
  }

  messages.push(message);
  return messages;
}

export async function loadSessionHistory(
  workspacePath: string,
  sessionId: string
): Promise<Message[]> {
  const sessionPath = `${workspacePath}/.agent/sessions/${sessionId}.jsonl`;

  try {
    const fileExists = await tauriExists(sessionPath);
    if (!fileExists) {
      return [];
    }

    const content = await tauriReadTextFile(sessionPath);
    const messages: Message[] = [];
    const toolNamesById = new Map<string, string>();

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const data = JSON.parse(trimmed);
        messages.push(...deserializeSessionHistoryEntry(data, toolNamesById));
      } catch {
        continue;
      }
    }

    return messages;
  } catch (error) {
    console.error('Failed to load session history:', error);
    return [];
  }
}

interface SessionMeta {
  session_id: string;
  workspace_path: string;
  created_at: string;
  updated_at: string;
  title?: string;
  locked_model?: LockedModelRef;
}

export async function scanSessions(workspacePath: string): Promise<SessionMeta[]> {
  const sessionsDir = `${workspacePath}/.agent/sessions`;

  try {
    const dirExists = await tauriExists(sessionsDir);
    if (!dirExists) {
      return [];
    }

    const entries = await tauriReadDir(sessionsDir);
    const sessions: SessionMeta[] = [];

    for (const entry of entries) {
      if (!entry.isFile || !entry.name?.endsWith('.jsonl')) continue;

      const sessionId = entry.name.replace('.jsonl', '');
      const sessionPath = `${sessionsDir}/${entry.name}`;
      const metadataPath = `${sessionsDir}/${sessionId}.meta.json`;

      try {
        let createdAt = new Date().toISOString();
        let updatedAt = new Date().toISOString();
        let title: string | undefined;
        let lockedModel: LockedModelRef | undefined;
        let hasCompleteMetadataTimestamps = false;

        if (await tauriExists(metadataPath)) {
          try {
            const metadata = JSON.parse(await tauriReadTextFile(metadataPath)) as {
              created_at?: unknown;
              updated_at?: unknown;
              title?: unknown;
              locked_model?: unknown;
            };
            if (typeof metadata.created_at === 'string') {
              createdAt = metadata.created_at;
            }
            if (typeof metadata.updated_at === 'string') {
              updatedAt = metadata.updated_at;
            }
            if (typeof metadata.title === 'string') {
              title = metadata.title;
            }
            if (metadata.locked_model && typeof metadata.locked_model === 'object') {
              const candidate = metadata.locked_model as Partial<LockedModelRef>;
              if (
                typeof candidate.profile_name === 'string'
                && typeof candidate.provider === 'string'
                && typeof candidate.model === 'string'
              ) {
                lockedModel = {
                  profile_name: candidate.profile_name,
                  provider: candidate.provider,
                  model: candidate.model,
                };
              }
            }

            hasCompleteMetadataTimestamps = typeof metadata.created_at === 'string'
              && typeof metadata.updated_at === 'string';
          } catch {
            // Ignore malformed metadata and fall back to the session transcript.
          }
        }

        if (!hasCompleteMetadataTimestamps) {
          const content = await tauriReadTextFile(sessionPath);
          const lines = content.split('\n').filter(l => l.trim());

          if (lines.length === 0) {
            continue;
          }

          const firstLine = JSON.parse(lines[0]);
          const lastLine = JSON.parse(lines[lines.length - 1]);

          if (typeof firstLine.timestamp === 'string') {
            createdAt = firstLine.timestamp;
          }
          if (typeof lastLine.timestamp === 'string') {
            updatedAt = lastLine.timestamp;
          }
        }

        sessions.push({
          session_id: sessionId,
          workspace_path: workspacePath,
          created_at: createdAt,
          updated_at: updatedAt,
          title,
          locked_model: lockedModel,
        });
      } catch {
        continue;
      }
    }

    return sessions.sort((a, b) => {
      const aTime = new Date(a.updated_at).getTime();
      const bTime = new Date(b.updated_at).getTime();
      return bTime - aTime;
    });
  } catch (error) {
    console.error('Failed to scan sessions:', error);
    return [];
  }
}

export async function deleteSessionHistory(workspacePath: string, sessionId: string): Promise<void> {
  const sessionPath = `${workspacePath}/.agent/sessions/${sessionId}.jsonl`;
  const metadataPath = `${workspacePath}/.agent/sessions/${sessionId}.meta.json`;

  try {
    const fileExists = await tauriExists(sessionPath);
    if (!fileExists) {
      if (await tauriExists(metadataPath)) {
        await tauriRemove(metadataPath);
      }
      return;
    }

    await tauriRemove(sessionPath);
    if (await tauriExists(metadataPath)) {
      await tauriRemove(metadataPath);
    }
  } catch (error) {
    console.error('Failed to delete session history:', error);
    throw error;
  }
}
