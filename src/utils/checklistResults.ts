import type { Message, ScenarioId } from '../types';
import { parseMarkdown } from './markdown';

export type ChecklistResultSource =
  | 'assistant_json'
  | 'assistant_markdown_table'
  | 'assistant_clause_sections'
  | 'tool_rows_only';
export type ChecklistJudgement = 'pass' | 'fail' | 'unknown' | 'na';

export interface ChecklistResultRowViewModel {
  id: string;
  clause: string;
  requirement: string;
  evidence: string;
  judgement: ChecklistJudgement;
  confidence?: string;
  missingInformation: string[];
  locatorLabel?: string;
}

export interface ChecklistRowOverride {
  evidence?: string;
  judgement?: ChecklistJudgement;
  confidence?: string;
  missingInformation?: string[];
}

export interface ChecklistResultSummaryViewModel {
  total: number;
  pass: number;
  fail: number;
  unknown: number;
  na: number;
  missing: number;
}

export interface ChecklistResultViewModel {
  source: ChecklistResultSource;
  rows: ChecklistResultRowViewModel[];
  summary: ChecklistResultSummaryViewModel;
  isEvaluated: boolean;
  sourceLabel?: string;
  checklistTitle?: string;
}

interface ChecklistResultCandidate {
  rows: ChecklistResultRowViewModel[];
  sourceLabel?: string;
  checklistTitle?: string;
}

const JSON_BLOCK_PATTERN = /```(?:json)?\s*([\s\S]*?)```/gi;

function normalizeText(value: unknown): string {
  const stringValue = typeof value === 'string'
    ? value
    : value == null
      ? ''
      : String(value);

  return stringValue
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/<\/?[^>]+>/g, '')
    .trim();
}

function normalizeArrayOfText(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeText(item))
      .filter((item) => item && !isNoneLikeText(item));
  }

  const text = normalizeText(value);
  if (!text) {
    return [];
  }

  if (isNoneLikeText(text)) {
    return [];
  }

  return text
    .split(/\n|;\s*/g)
    .map((item) => item.trim())
    .filter((item) => item && !isNoneLikeText(item));
}

function isNoneLikeText(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/[。.!！?？]+$/g, '');
  return ['none', 'no', 'n/a', 'na', 'nil', 'not provided', '无', '暂无', '没有', '不适用'].includes(normalized);
}

function findFirstText(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const normalized = normalizeText(record[key]);
    if (normalized) {
      return normalized;
    }
  }

  return '';
}

function normalizeJudgement(value: unknown): ChecklistJudgement {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return 'unknown';
  }

  if (['pass', 'p', 'ok', 'yes', 'true', 'complies', 'compliant'].includes(normalized)) {
    return 'pass';
  }
  if (['fail', 'f', 'ng', 'no', 'false', 'non-compliant', 'not compliant'].includes(normalized)) {
    return 'fail';
  }
  if (['na', 'n/a', 'not applicable', 'n a'].includes(normalized)) {
    return 'na';
  }

  return 'unknown';
}

function createSummary(rows: ChecklistResultRowViewModel[]): ChecklistResultSummaryViewModel {
  return rows.reduce<ChecklistResultSummaryViewModel>(
    (summary, row) => {
      summary.total += 1;
      summary[row.judgement] += 1;
      if (row.missingInformation.length > 0) {
        summary.missing += 1;
      }
      return summary;
    },
    {
      total: 0,
      pass: 0,
      fail: 0,
      unknown: 0,
      na: 0,
      missing: 0,
    }
  );
}

export function getChecklistRowKey(row: Pick<ChecklistResultRowViewModel, 'id' | 'clause' | 'requirement'>): string {
  const clause = normalizeText(row.clause);
  const requirement = normalizeText(row.requirement);
  if (clause || requirement) {
    return `${clause}::${requirement}`;
  }
  return row.id;
}

function hasOwnValue<T extends object>(record: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function applyChecklistRowOverrides(
  result: ChecklistResultViewModel,
  overrides: Record<string, ChecklistRowOverride>
): ChecklistResultViewModel {
  const rows = result.rows.map((row) => {
    const override = overrides[getChecklistRowKey(row)];
    if (!override) {
      return row;
    }

    return {
      ...row,
      evidence: hasOwnValue(override, 'evidence') ? (override.evidence ?? '') : row.evidence,
      judgement: hasOwnValue(override, 'judgement') ? (override.judgement ?? row.judgement) : row.judgement,
      confidence: hasOwnValue(override, 'confidence') ? override.confidence : row.confidence,
      missingInformation: hasOwnValue(override, 'missingInformation')
        ? (override.missingInformation ?? [])
        : row.missingInformation,
    };
  });

  const isEvaluated = result.isEvaluated || rows.some(
    (row) => row.judgement !== 'unknown' || row.evidence.trim().length > 0 || row.missingInformation.length > 0
  );

  return {
    ...result,
    rows,
    summary: createSummary(rows),
    isEvaluated,
  };
}

export function createChecklistResultSignature(result: ChecklistResultViewModel): string {
  return JSON.stringify({
    source: result.source,
    checklistTitle: result.checklistTitle || '',
    sourceLabel: result.sourceLabel || '',
    rows: result.rows.map((row) => ({
      key: getChecklistRowKey(row),
      evidence: row.evidence,
      judgement: row.judgement,
      confidence: row.confidence || '',
      missingInformation: row.missingInformation,
    })),
  });
}

function normalizeLocatorLabel(locator: unknown): string | undefined {
  if (!locator || typeof locator !== 'object') {
    return undefined;
  }

  const data = locator as Record<string, unknown>;
  const rowIndex = typeof data.row_index === 'number' ? data.row_index : undefined;
  const tableIndex = typeof data.table_index === 'number' ? data.table_index : undefined;
  const sheetName = normalizeText(data.sheet_name);

  if (sheetName && rowIndex) {
    return `${sheetName} · row ${rowIndex}`;
  }
  if (tableIndex && rowIndex) {
    return `Table ${tableIndex} · row ${rowIndex}`;
  }
  if (rowIndex) {
    return `Row ${rowIndex}`;
  }

  return normalizeText(data.type) || undefined;
}

function normalizeAssistantRow(record: Record<string, unknown>, index: number): ChecklistResultRowViewModel | null {
  const clause = findFirstText(record, ['clause', 'clause_id', 'clauseId', 'item', 'id']);
  const requirement = findFirstText(record, [
    'requirement',
    'clause_text',
    'clauseText',
    'description',
    'content',
    'criterion',
    'criteria',
  ]);
  const evidence = findFirstText(record, ['evidence', 'raw_evidence', 'rawEvidence', 'observation', 'observations', 'notes']);
  const confidence = findFirstText(record, ['confidence']);
  const missingInformation = normalizeArrayOfText(
    record.missing_information
    ?? record.missingInfo
    ?? record.needed_information
    ?? record.open_questions
    ?? record.missing
  );

  if (!requirement || (!clause && !evidence && missingInformation.length === 0)) {
    return null;
  }

  return {
    id: findFirstText(record, ['row_id', 'rowId', 'id']) || `assistant-row-${index + 1}`,
    clause,
    requirement,
    evidence,
    judgement: normalizeJudgement(
      record.judgement ?? record.judgment ?? record.verdict ?? record.result ?? record.status
    ),
    confidence: confidence || undefined,
    missingInformation,
    locatorLabel: normalizeLocatorLabel(record.locator),
  };
}

function normalizeToolRow(record: Record<string, unknown>, index: number): ChecklistResultRowViewModel | null {
  const clause = findFirstText(record, ['clause_id', 'clauseId', 'clause']);
  const requirement = findFirstText(record, ['requirement']);
  const evidence = findFirstText(record, ['raw_evidence', 'rawEvidence', 'evidence']);

  if (!clause && !requirement) {
    return null;
  }

  return {
    id: findFirstText(record, ['row_id', 'rowId']) || `tool-row-${index + 1}`,
    clause,
    requirement,
    evidence,
    judgement: normalizeJudgement(record.raw_judgement ?? record.judgement ?? record.result),
    missingInformation: [],
    locatorLabel: normalizeLocatorLabel(record.locator),
  };
}

function normalizeAssistantRows(rows: unknown): ChecklistResultRowViewModel[] {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .map((row, index) => (
      row && typeof row === 'object'
        ? normalizeAssistantRow(row as Record<string, unknown>, index)
        : null
    ))
    .filter((row): row is ChecklistResultRowViewModel => row !== null);
}

function buildResultViewModel(
  source: ChecklistResultSource,
  candidate: ChecklistResultCandidate,
  isEvaluated: boolean
): ChecklistResultViewModel | null {
  if (candidate.rows.length === 0) {
    return null;
  }

  return {
    source,
    rows: candidate.rows,
    summary: createSummary(candidate.rows),
    isEvaluated,
    sourceLabel: candidate.sourceLabel,
    checklistTitle: candidate.checklistTitle,
  };
}

function parseChecklistRowsFromJsonValue(value: unknown): ChecklistResultCandidate | null {
  if (Array.isArray(value)) {
    const rows = normalizeAssistantRows(value);
    return rows.length > 0 ? { rows } : null;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const rows = normalizeAssistantRows(record.rows ?? record.items ?? record.checklist_rows);
  if (rows.length === 0) {
    return null;
  }

  const sourceLabel = findFirstText(record, ['source_label', 'sourceLabel', 'source']);
  const checklistTitle = findFirstText(record, ['title', 'checklist_title', 'checklistTitle', 'name']);

  return {
    rows,
    sourceLabel: sourceLabel || undefined,
    checklistTitle: checklistTitle || undefined,
  };
}

function parseChecklistRowsFromJsonBlocks(content: string): ChecklistResultCandidate | null {
  const decoded = parseMarkdown(content);
  const blocks = Array.from(decoded.matchAll(JSON_BLOCK_PATTERN));

  for (const block of blocks) {
    const rawJson = block[1]?.trim();
    if (!rawJson) {
      continue;
    }

    try {
      const parsed = JSON.parse(rawJson) as unknown;
      const candidate = parseChecklistRowsFromJsonValue(parsed);
      if (candidate) {
        return candidate;
      }
    } catch {
      // Ignore non-JSON code blocks.
    }
  }

  return null;
}

function splitMarkdownTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isMarkdownSeparatorRow(line: string): boolean {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function normalizeHeaderRole(
  header: string
): 'clause' | 'requirement' | 'evidence' | 'judgement' | 'confidence' | 'missing' | null {
  const normalized = header.toLowerCase();
  if (normalized.includes('clause') || normalized.includes('item')) {
    return 'clause';
  }
  if (
    normalized.includes('requirement')
    || normalized.includes('criterion')
    || normalized.includes('criteria')
    || normalized.includes('content')
    || normalized.includes('description')
  ) {
    return 'requirement';
  }
  if (normalized.includes('evidence') || normalized.includes('observation') || normalized.includes('notes')) {
    return 'evidence';
  }
  if (
    normalized.includes('judgement')
    || normalized.includes('judgment')
    || normalized.includes('result')
    || normalized.includes('verdict')
    || normalized.includes('status')
  ) {
    return 'judgement';
  }
  if (normalized.includes('confidence')) {
    return 'confidence';
  }
  if (
    normalized.includes('missing')
    || normalized.includes('needed')
    || normalized.includes('follow-up')
    || normalized.includes('follow up')
    || normalized.includes('uncertaint')
  ) {
    return 'missing';
  }

  return null;
}

function normalizeFieldRole(
  label: string
): 'clause' | 'requirement' | 'evidence' | 'judgement' | 'confidence' | 'missing' | null {
  const normalized = normalizeText(label).toLowerCase();
  if (
    normalized.includes('clause')
    || normalized.includes('clause_id')
    || normalized.includes('clause id')
    || normalized.includes('条款')
  ) {
    return 'clause';
  }
  if (normalized.includes('requirement') || normalized.includes('要求')) {
    return 'requirement';
  }
  if (normalized.includes('evidence') || normalized.includes('证据')) {
    return 'evidence';
  }
  if (
    normalized.includes('judgement')
    || normalized.includes('judgment')
    || normalized.includes('判断')
    || normalized.includes('结论')
  ) {
    return 'judgement';
  }
  if (normalized.includes('confidence') || normalized.includes('置信')) {
    return 'confidence';
  }
  if (
    normalized.includes('missing')
    || normalized.includes('missing_info')
    || normalized.includes('missing info')
    || normalized.includes('缺失')
    || normalized.includes('待补充')
    || normalized.includes('需补充')
  ) {
    return 'missing';
  }

  return null;
}

function parseChecklistRowsFromMarkdownTable(content: string): ChecklistResultCandidate | null {
  const decoded = parseMarkdown(content);
  const lines = decoded.split('\n');

  for (let index = 0; index < lines.length - 2; index += 1) {
    if (!lines[index].trim().startsWith('|') || !isMarkdownSeparatorRow(lines[index + 1])) {
      continue;
    }

    const headerCells = splitMarkdownTableRow(lines[index]);
    const roles = headerCells.map(normalizeHeaderRole);
    const hasRequirement = roles.includes('requirement');
    const hasSupportingRole = roles.some(
      (role) => role === 'clause' || role === 'evidence' || role === 'judgement' || role === 'missing'
    );
    if (!hasRequirement || !hasSupportingRole) {
      continue;
    }

    const rows: ChecklistResultRowViewModel[] = [];
    let rowIndex = index + 2;
    while (rowIndex < lines.length && lines[rowIndex].trim().startsWith('|')) {
      const cells = splitMarkdownTableRow(lines[rowIndex]);
      const record: Record<string, unknown> = {};
      roles.forEach((role, roleIndex) => {
        if (!role) {
          return;
        }
        record[role] = cells[roleIndex] ?? '';
      });

      const normalizedRow = normalizeAssistantRow(record, rows.length);
      if (normalizedRow) {
        rows.push(normalizedRow);
      }
      rowIndex += 1;
    }

    if (rows.length > 0) {
      return { rows };
    }
  }

  return null;
}

function extractClauseFromHeading(heading: string): string {
  const match = heading.match(/(?:条款|clause)\s*([A-Za-z0-9_.-]+)/i);
  return match?.[1]?.trim() || '';
}

function parseChecklistRowsFromClauseSections(content: string): ChecklistResultCandidate | null {
  const decoded = parseMarkdown(content);
  const lines = decoded.split('\n');
  const sections: Array<{ heading: string; lines: string[] }> = [];
  let currentSection: { heading: string; lines: string[] } | null = null;

  for (const line of lines) {
    const headingMatch = line.match(/^###\s+(.+?)\s*$/);
    if (headingMatch) {
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = {
        heading: headingMatch[1],
        lines: [],
      };
      continue;
    }

    if (currentSection) {
      currentSection.lines.push(line);
    }
  }

  if (currentSection) {
    sections.push(currentSection);
  }

  const rows: ChecklistResultRowViewModel[] = [];

  for (const section of sections) {
    const headingClause = extractClauseFromHeading(section.heading);
    const sectionLines = section.lines;
    for (let index = 0; index < sectionLines.length - 2; index += 1) {
      const headerLine = sectionLines[index].trim();
      const separatorLine = sectionLines[index + 1].trim();
      if (!headerLine.startsWith('|') || !separatorLine.startsWith('|') || !isMarkdownSeparatorRow(separatorLine)) {
        continue;
      }

      const headerCells = splitMarkdownTableRow(headerLine).map((cell) => normalizeText(cell).toLowerCase());
      const isFieldTable = headerCells.length === 2 && (
        (headerCells[0] === '字段' && headerCells[1] === '内容')
        || (headerCells[0] === 'field' && headerCells[1] === 'content')
      );
      if (!isFieldTable) {
        continue;
      }

      const record: Record<string, unknown> = {
        clause: headingClause,
      };
      let rowIndex = index + 2;
      while (rowIndex < sectionLines.length && sectionLines[rowIndex].trim().startsWith('|')) {
        const cells = splitMarkdownTableRow(sectionLines[rowIndex]);
        const role = normalizeFieldRole(cells[0] ?? '');
        if (role) {
          record[role] = normalizeText(cells.slice(1).join(' | '));
        }
        rowIndex += 1;
      }

      const normalizedRow = normalizeAssistantRow(record, rows.length);
      if (normalizedRow) {
        rows.push(normalizedRow);
      }
      break;
    }
  }

  return rows.length > 0 ? { rows } : null;
}

function parseToolOutputCandidate(output: unknown): ChecklistResultCandidate | null {
  if (!output || typeof output !== 'object') {
    return null;
  }

  const record = output as Record<string, unknown>;
  if (normalizeText(record.event) !== 'checklist_rows') {
    return null;
  }

  const rows = Array.isArray(record.rows)
    ? record.rows
        .map((row, index) => (
          row && typeof row === 'object'
            ? normalizeToolRow(row as Record<string, unknown>, index)
            : null
        ))
        .filter((row): row is ChecklistResultRowViewModel => row !== null)
    : [];

  if (rows.length === 0) {
    return null;
  }

  return {
    rows,
    sourceLabel: findFirstText(record, ['reference_root_label', 'path']) || undefined,
    checklistTitle: findFirstText(record, ['relative_path', 'path']) || undefined,
  };
}

export function parseChecklistResultFromAssistantMessage(content: string): ChecklistResultViewModel | null {
  const jsonCandidate = parseChecklistRowsFromJsonBlocks(content);
  if (jsonCandidate) {
    return buildResultViewModel('assistant_json', jsonCandidate, true);
  }

  const markdownCandidate = parseChecklistRowsFromMarkdownTable(content);
  if (markdownCandidate) {
    return buildResultViewModel('assistant_markdown_table', markdownCandidate, true);
  }

  const clauseSectionCandidate = parseChecklistRowsFromClauseSections(content);
  if (clauseSectionCandidate) {
    return buildResultViewModel('assistant_clause_sections', clauseSectionCandidate, true);
  }

  return null;
}

export function parseChecklistResultFromToolMessages(messages: Message[]): ChecklistResultViewModel | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'tool' || message.toolMessage?.kind !== 'result' || !message.toolMessage.success) {
      continue;
    }

    const toolName = message.toolMessage.toolName || message.name;
    if (toolName !== 'extract_checklist_rows') {
      continue;
    }

    const candidate = parseToolOutputCandidate(message.toolMessage.output);
    if (candidate) {
      return buildResultViewModel('tool_rows_only', candidate, false);
    }
  }

  return null;
}

export function buildChecklistResultViewModel({
  scenarioId,
  messages,
}: {
  scenarioId?: ScenarioId;
  messages: Message[];
}): ChecklistResultViewModel | null {
  if (scenarioId !== 'checklist_evaluation') {
    return null;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant' || message.status !== 'completed' || !message.content) {
      continue;
    }

    const parsed = parseChecklistResultFromAssistantMessage(message.content);
    if (parsed) {
      return parsed;
    }
  }

  return parseChecklistResultFromToolMessages(messages);
}
