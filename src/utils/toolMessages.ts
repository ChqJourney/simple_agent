import { ToolDecision, ToolDecisionScope } from '../types';

export function createToolDecisionSummary(toolName: string, decision: ToolDecision): string {
  const resolvedToolName = toolName || 'tool';

  if (decision === 'approve_always') {
    return `\u8bf7\u6c42\u6267\u884c ${resolvedToolName} accept always`;
  }

  if (decision === 'approve_once') {
    return `\u8bf7\u6c42\u6267\u884c ${resolvedToolName} accept once`;
  }

  return `\u8bf7\u6c42\u6267\u884c ${resolvedToolName} reject`;
}

export function renderToolResultDetails(success: boolean, output: unknown, error?: string): string {
  if (success) {
    if (typeof output === 'string') {
      return output;
    }

    return JSON.stringify(output, null, 2);
  }

  if (error) {
    return `Error: ${error}`;
  }

  if (typeof output === 'string' && output) {
    return `Error: ${output}`;
  }

  return 'Error: Tool execution failed';
}

export function createToolResultSummary(toolName: string, success: boolean): string {
  const resolvedToolName = toolName || 'tool';
  const suffix = success ? '\u6267\u884c\u6210\u529f' : '\u6267\u884c\u5931\u8d25';
  return `${resolvedToolName} ${suffix}`;
}

export function parseToolDecisionContent(
  content: string
): { decision: ToolDecision; scope: ToolDecisionScope; reason?: string } | null {
  const segments = content
    .split(';')
    .map((segment) => segment.trim())
    .filter(Boolean);

  const values = new Map<string, string>();
  for (const segment of segments) {
    const [rawKey, ...rest] = segment.split('=');
    if (!rawKey || rest.length === 0) {
      continue;
    }
    values.set(rawKey.trim(), rest.join('=').trim());
  }

  const decision = values.get('decision');
  const scope = values.get('scope');
  const reason = values.get('reason');

  if (
    decision !== 'approve_once' &&
    decision !== 'approve_always' &&
    decision !== 'reject'
  ) {
    return null;
  }

  if (scope !== 'session' && scope !== 'workspace') {
    return null;
  }

  return {
    decision,
    scope,
    reason,
  };
}

export function inferPersistedToolResult(content: string | null): {
  success: boolean;
  details: string;
} {
  const details = content ?? '';
  const success = !details.startsWith('Error:');
  return {
    success,
    details,
  };
}
