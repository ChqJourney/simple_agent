import type { TaskNode } from '../stores/taskStore';
import { ToolCall, ToolDecision, ToolDecisionScope } from '../types';

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

function isFileWriteOutput(value: unknown): value is {
  event: 'file_write';
  path: string;
  change: string;
} {
  return (
    isRecord(value) &&
    value.event === 'file_write' &&
    typeof value.path === 'string' &&
    typeof value.change === 'string'
  );
}

function isDirectoryTreeOutput(value: unknown): value is {
  event: 'directory_tree';
  summary?: {
    file_count?: number;
    directory_count?: number;
  };
} {
  return isRecord(value) && value.event === 'directory_tree';
}

function isSearchResultsOutput(value: unknown): value is {
  event: 'document_search_results';
  summary?: {
    hit_count?: number;
    file_count?: number;
  };
} {
  return isRecord(value) && value.event === 'document_search_results';
}

function isDocumentSegmentOutput(value: unknown): value is {
  event: 'document_segment';
  content?: string;
  document_type?: string;
  segment_type?: string;
  locator?: Record<string, unknown>;
  summary?: {
    char_count?: number;
    line_count?: number;
    page_count?: number;
    page_number?: number;
    document_type?: string;
    segment_type?: string;
  };
} {
  return isRecord(value) && value.event === 'document_segment';
}

function isDocumentStructureOutput(value: unknown): value is {
  event: 'document_structure';
  summary?: {
    node_count?: number;
    max_level?: number;
    document_type?: string;
    structure_type?: string;
  };
} {
  return isRecord(value) && value.event === 'document_structure';
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

const MAX_TECHNICAL_STRING_LENGTH = 4000;
const MAX_TECHNICAL_RENDER_LENGTH = 12000;

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const omittedLength = text.length - maxLength;
  return `${text.slice(0, maxLength)}\n...[truncated ${omittedLength} chars]`;
}

export function formatToolTechnicalValue(value: unknown): string {
  if (typeof value === 'string') {
    return truncateText(value, MAX_TECHNICAL_RENDER_LENGTH);
  }

  try {
    const serialized = JSON.stringify(
      value,
      (_key, candidate) => {
        if (typeof candidate === 'string' && candidate.length > MAX_TECHNICAL_STRING_LENGTH) {
          return `${candidate.slice(0, MAX_TECHNICAL_STRING_LENGTH)}\n...[truncated ${candidate.length - MAX_TECHNICAL_STRING_LENGTH} chars]`;
        }
        return candidate;
      },
      2,
    );

    return truncateText(serialized ?? '', MAX_TECHNICAL_RENDER_LENGTH);
  } catch {
    return truncateText(String(value), MAX_TECHNICAL_RENDER_LENGTH);
  }
}

export function getToolCategoryLabel(toolName: string): string {
  if (toolName === 'list_directory_tree') {
    return '目录浏览';
  }

  if (toolName === 'search_documents') {
    return '全文搜索';
  }

  if (toolName === 'read_document_segment' || toolName === 'file_read') {
    return '内容读取';
  }

  if (toolName === 'get_document_structure') {
    return '文档结构';
  }

  if (toolName === 'skill_loader') {
    return '技能';
  }

  if (toolName.endsWith('_execute')) {
    return '高级执行';
  }

  if (toolName === 'todo_task') {
    return '任务';
  }

  if (toolName === 'ask_question') {
    return '交互';
  }

  if (toolName.startsWith('file_')) {
    return '工作区';
  }

  return '通用';
}

export function getToolImpactLabel(toolName: string): string {
  if (toolName === 'file_write') {
    return '会修改文件';
  }

  if (toolName.endsWith('_execute')) {
    return '高级兜底工具';
  }

  if (toolName === 'ask_question') {
    return '需要用户输入';
  }

  if (toolName === 'todo_task') {
    return '更新界面状态';
  }

  return '只读';
}

export function createToolCallSummary(toolCall: Pick<ToolCall, 'name' | 'arguments'>): string {
  const args = toolCall.arguments || {};

  if (toolCall.name === 'skill_loader') {
    const skillName = typeof args.skill_name === 'string' ? args.skill_name : 'unknown';
    return `正在加载技能 ${skillName}`;
  }

  if (toolCall.name === 'list_directory_tree') {
    const path = typeof args.path === 'string' ? args.path : '.';
    const depth = typeof args.max_depth === 'number' ? args.max_depth : 3;
    return `正在扫描目录 ${path}，深度 ${depth}`;
  }

  if (toolCall.name === 'search_documents') {
    const query = typeof args.query === 'string' ? args.query : '';
    return query ? `正在搜索 "${query}"` : '正在搜索文档内容';
  }

  if (toolCall.name === 'read_document_segment') {
    const path = typeof args.path === 'string' ? args.path : '文件';
    const locator = typeof args.locator === 'object' && args.locator !== null ? args.locator as Record<string, unknown> : null;
    const locatorType = typeof locator?.type === 'string' ? locator.type : 'segment';
    return `正在读取 ${path} 的 ${locatorType}`;
  }

  if (toolCall.name === 'get_document_structure') {
    const path = typeof args.path === 'string' ? args.path : '文件';
    return `正在提取 ${path} 的文档结构`;
  }

  if (toolCall.name === 'file_read') {
    const path = typeof args.path === 'string' ? args.path : '文件';
    return `正在读取完整文件 ${path}`;
  }

  if (toolCall.name === 'file_write') {
    const path = typeof args.path === 'string' ? args.path : '文件';
    return `准备写入文件 ${path}`;
  }

  if (toolCall.name === 'shell_execute') {
    return '正在使用高级 Shell 执行作为兜底方案';
  }

  if (toolCall.name === 'python_execute') {
    return '正在使用高级 Python 执行作为兜底方案';
  }

  if (toolCall.name === 'node_execute') {
    return '正在使用高级 Node.js 执行作为兜底方案';
  }

  if (toolCall.name === 'ask_question') {
    return '正在请求用户确认或补充信息';
  }

  if (toolCall.name === 'todo_task') {
    return '正在更新任务列表';
  }

  return `正在执行 ${toolCall.name}`;
}

export function createToolCallDetailTitle(toolName: string): string {
  if (toolName === 'skill_loader') {
    return '技能请求';
  }

  return '技术详情';
}

export function createToolConfirmationTitle(toolName: string): string {
  if (toolName.endsWith('_execute')) {
    return '确认执行高级工具';
  }
  if (toolName === 'file_write') {
    return '确认写入文件';
  }
  return '确认执行操作';
}

export function createToolConfirmationMessage(toolCall: Pick<ToolCall, 'name' | 'arguments'>): string {
  if (toolCall.name.endsWith('_execute')) {
    return '助手准备使用高级执行工具作为兜底方案。这类工具更灵活，但可解释性低于专用工具。';
  }

  if (toolCall.name === 'file_write') {
    return '助手准备写入工作区文件，请确认输出路径和内容来源。';
  }

  if (toolCall.name === 'ask_question') {
    return '助手需要你的回答后才能继续。';
  }

  return '助手需要读取或搜索工作区文件来继续分析，这不会修改原文件。';
}

export function createToolDecisionDetailLines(
  toolName: string,
  decision: ToolDecision,
  scope: ToolDecisionScope,
  reason?: string,
): string[] {
  const lines: string[] = [];

  if (decision === 'reject') {
    lines.push('该操作未获批准，因此没有继续执行。');
  } else if (decision === 'approve_once') {
    lines.push('该操作已获本次批准。');
  } else {
    lines.push(
      scope === 'workspace'
        ? '该操作已被设置为当前工作区内自动批准。'
        : '该操作已被设置为本会话内自动批准。',
    );
  }

  if (reason === 'policy') {
    lines.push('本次没有再次询问，因为之前已经授权过同类操作。');
  } else if (reason && reason !== 'user_action') {
    lines.push(`原因: ${reason}`);
  }

  if (toolName.endsWith('_execute')) {
    lines.push('这属于高级兜底工具。');
  } else if (toolName === 'file_write') {
    lines.push('这类操作会修改工作区文件。');
  } else {
    lines.push('这类操作通常不会修改原文件。');
  }

  return lines;
}

export function createToolDecisionSummary(toolName: string, decision: ToolDecision): string {
  const resolvedToolName = toolName || 'tool';

  if (decision === 'approve_always') {
    return `已允许 ${resolvedToolName} 后续自动执行`;
  }

  if (decision === 'approve_once') {
    return `已允许 ${resolvedToolName} 本次执行`;
  }

  return `已拒绝 ${resolvedToolName} 执行`;
}

export function renderToolResultDetails(success: boolean, output: unknown, error?: string): string {
  if (success) {
    if (isDirectoryTreeOutput(output)) {
      return [
        `目录扫描完成`,
        `文件数: ${output.summary?.file_count ?? 0}`,
        `目录数: ${output.summary?.directory_count ?? 0}`,
      ].join('\n');
    }

    if (isSearchResultsOutput(output)) {
      return [
        `搜索完成`,
        `命中数: ${output.summary?.hit_count ?? 0}`,
        `涉及文件: ${output.summary?.file_count ?? 0}`,
      ].join('\n');
    }

    if (isDocumentSegmentOutput(output)) {
      const count = output.summary?.page_count
        ? `${output.summary.page_count} pages`
        : output.summary?.line_count
          ? `${output.summary.line_count} lines`
          : `${output.summary?.char_count ?? 0} chars`;
      return [
        `文档片段读取完成`,
        `文档类型: ${output.summary?.document_type ?? output.document_type ?? 'unknown'}`,
        `片段类型: ${output.summary?.segment_type ?? output.segment_type ?? 'unknown'}`,
        `范围大小: ${count}`,
        '',
        typeof output.content === 'string' ? output.content : '',
      ].join('\n');
    }

    if (isDocumentStructureOutput(output)) {
      return [
        `文档结构提取完成`,
        `结构节点: ${output.summary?.node_count ?? 0}`,
        `最大层级: ${output.summary?.max_level ?? 0}`,
        output.summary?.document_type ? `文档类型: ${output.summary.document_type}` : '',
        output.summary?.structure_type ? `结构类型: ${output.summary.structure_type}` : '',
      ].join('\n');
    }

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

    if (isFileWriteOutput(output)) {
      return [`File: ${output.path}`, `Change: ${output.change}`].join('\n');
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
  const successMessages: Record<string, string> = {
    list_directory_tree: '目录扫描完成',
    search_documents: '文档搜索完成',
    read_document_segment: '文档片段读取完成',
    get_document_structure: '文档结构提取完成',
    file_read: '文件读取完成',
    file_write: '文件写入完成',
  };
  const failureMessages: Record<string, string> = {
    list_directory_tree: '目录扫描失败',
    search_documents: '文档搜索失败',
    read_document_segment: '文档片段读取失败',
    get_document_structure: '文档结构提取失败',
    file_read: '文件读取失败',
    file_write: '文件写入失败',
  };

  if (success) {
    return successMessages[resolvedToolName] || `${resolvedToolName} 执行成功`;
  }

  return failureMessages[resolvedToolName] || `${resolvedToolName} 执行失败`;
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

export function inferPersistedToolResult(
  content: string | null,
  persistedSuccess?: boolean
): {
  success: boolean;
  details: string;
} {
  const details = content ?? '';
  const success = typeof persistedSuccess === 'boolean'
    ? persistedSuccess
    : !details.startsWith('Error:');
  return {
    success,
    details,
  };
}
