import { Message } from '../types';
import { readTextFile, exists } from '@tauri-apps/plugin-fs';

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

export async function loadSessionHistory(
  workspacePath: string,
  sessionId: string
): Promise<Message[]> {
  const sessionPath = `${workspacePath}/.agent/sessions/${sessionId}.jsonl`;
  
  try {
    const fileExists = await exists(sessionPath);
    if (!fileExists) {
      return [];
    }

    const content = await readTextFile(sessionPath);
    const messages: Message[] = [];
    
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      try {
        const data = JSON.parse(trimmed);
        const message: Message = {
          id: crypto.randomUUID(),
          role: data.role,
          content: data.content ?? null,
          reasoning_content: data.reasoning_content,
          tool_calls: data.tool_calls,
          tool_call_id: data.tool_call_id,
          name: data.name,
          status: 'completed',
        };
        messages.push(message);
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