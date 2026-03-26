import type { TaskNode } from '../stores/taskStore';
import { ToolDecision, ToolDecisionScope } from '../types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isExecutionOutput(value: unknown): value is { exit_code: number; stdout?: string; stderr?: string } {
  return isRecord(value) && typeof value.exit_code === 'number';
}

function isPendingQuestionOutput(value: unknown): value is {
  event: 'pending_question';
  question: string;
  details?: string;
  options?: string[];
} {
  return isRecord(value) && value.event === 'pending_question' && typeof value.question === 'string';
}

function isQuestionResponseOutput(value: unknown): value is {
  event: 'question_response';
  question: string;
  answer?: string;
  action: 'submit' | 'dismiss';
  details?: string;
  options?: string[];
} {
  return (
    isRecord(value) &&
    value.event === 'question_response' &&
    typeof value.question === 'string' &&
    (value.action === 'submit' || value.action === 'dismiss')
  );
}

function isTodoTaskOutput(value: unknown): value is {
  event: 'todo_task';
  action: string;
  task?: TaskNode;
} {
  return isRecord(value) && value.event === 'todo_task' && typeof value.action === 'string';
}

function isSkillLoaderOutput(value: unknown): value is {
  event: 'skill_loader';
  skill: {
    name: string;
    description?: string;
    source?: string;
    source_path?: string;
    frontmatter?: string;
    content?: string;
  };
} {
  return (
    isRecord(value)
    && value.event === 'skill_loader'
    && isRecord(value.skill)
    && typeof value.skill.name === 'string'
  );
}

function truncateLines(text: string, maxLines: number): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) {
    return text;
  }

  return `${lines.slice(0, maxLines).join('\n')}\n...`;
}

export function getToolCategoryLabel(toolName: string): string {
  if (toolName === 'skill_loader') {
    return 'skill';
  }

  if (toolName.endsWith('_execute')) {
    return 'execution';
  }

  if (toolName === 'todo_task') {
    return 'task';
  }

  if (toolName === 'ask_question') {
    return 'interaction';
  }

  if (toolName.startsWith('file_')) {
    return 'workspace';
  }

  return 'general';
}

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
    if (isQuestionResponseOutput(output)) {
      const lines = [`Question: ${output.question}`];
      if (output.details) {
        lines.push(`Details: ${output.details}`);
      }
      lines.push(
        output.action === 'submit'
          ? `Answer: ${output.answer || '(empty)'}`
          : 'Answer dismissed by user'
      );
      if (output.options && output.options.length > 0) {
        lines.push(`Options: ${output.options.join(', ')}`);
      }
      return lines.join('\n');
    }

    if (isPendingQuestionOutput(output)) {
      const lines = [`Question: ${output.question}`];
      if (output.details) {
        lines.push(`Details: ${output.details}`);
      }
      if (output.options && output.options.length > 0) {
        lines.push(`Options: ${output.options.join(', ')}`);
      }
      return lines.join('\n');
    }

    if (isTodoTaskOutput(output)) {
      const lines = [`Task action: ${output.action}`];
      if (output.task) {
        lines.push(`Task: ${output.task.content} (${output.task.status})`);
        if (output.task.subTasks && output.task.subTasks.length > 0) {
          lines.push(`Subtasks: ${output.task.subTasks.map((task) => task.content).join(', ')}`);
        }
      }
      return lines.join('\n');
    }

    if (isSkillLoaderOutput(output)) {
      const lines = [`Skill: ${output.skill.name}`];
      if (output.skill.description) {
        lines.push(`Description: ${output.skill.description}`);
      }
      if (output.skill.source) {
        lines.push(`Source: ${output.skill.source}`);
      }
      if (output.skill.source_path) {
        lines.push(`Path: ${output.skill.source_path}`);
      }
      if (output.skill.frontmatter) {
        lines.push(`Frontmatter:\n${output.skill.frontmatter}`);
      }
      if (output.skill.content) {
        lines.push(`Instructions preview:\n${truncateLines(output.skill.content, 6)}`);
      }
      return lines.join('\n\n');
    }

    if (isExecutionOutput(output)) {
      const lines = [`exit_code: ${output.exit_code}`];
      lines.push(`stdout:\n${output.stdout || '(empty)'}`);
      if (output.stderr) {
        lines.push(`stderr:\n${output.stderr}`);
      }
      return lines.join('\n\n');
    }

    if (typeof output === 'string') {
      return output;
    }

    return JSON.stringify(output, null, 2);
  }

  // Failure path — still extract execution output details when available.
  if (isExecutionOutput(output)) {
    const lines = [`Error: ${error || 'Tool execution failed'}`, `exit_code: ${output.exit_code}`];
    lines.push(`stdout:\n${output.stdout || '(empty)'}`);
    if (output.stderr) {
      lines.push(`stderr:\n${output.stderr}`);
    }
    return lines.join('\n\n');
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
