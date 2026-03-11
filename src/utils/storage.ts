import { Message } from '../types';

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
    const fileExists = await tauriExists(sessionPath);
    if (!fileExists) {
      return [];
    }

    const content = await tauriReadTextFile(sessionPath);
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

interface SessionMeta {
  session_id: string;
  workspace_path: string;
  created_at: string;
  updated_at: string;
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
      
      try {
        const content = await tauriReadTextFile(sessionPath);
        const lines = content.split('\n').filter(l => l.trim());
        
        if (lines.length === 0) continue;
        
        let createdAt = new Date().toISOString();
        let updatedAt = new Date().toISOString();
        
        const firstLine = JSON.parse(lines[0]);
        const lastLine = JSON.parse(lines[lines.length - 1]);
        
        if (firstLine.timestamp) {
          createdAt = firstLine.timestamp;
        }
        if (lastLine.timestamp) {
          updatedAt = lastLine.timestamp;
        }
        
        sessions.push({
          session_id: sessionId,
          workspace_path: workspacePath,
          created_at: createdAt,
          updated_at: updatedAt,
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