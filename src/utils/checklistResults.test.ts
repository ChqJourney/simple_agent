import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import {
  buildChecklistResultViewModel,
  parseChecklistResultFromAssistantMessage,
  parseChecklistResultFromToolMessages,
} from './checklistResults';

describe('checklistResults', () => {
  it('parses checklist rows from an assistant JSON block', () => {
    const result = parseChecklistResultFromAssistantMessage(`
Here is the evaluation summary.

\`\`\`json
{
  "title": "IEC TRF Review",
  "source_label": "TRF draft",
  "rows": [
    {
      "row_id": "r1",
      "clause": "5.1",
      "requirement": "Marking is durable",
      "evidence": "Label remained legible after rub test.",
      "judgement": "pass",
      "missing_information": ["Need production sample photo"]
    }
  ]
}
\`\`\`
`);

    expect(result).not.toBeNull();
    expect(result?.source).toBe('assistant_json');
    expect(result?.isEvaluated).toBe(true);
    expect(result?.checklistTitle).toBe('IEC TRF Review');
    expect(result?.summary.total).toBe(1);
    expect(result?.summary.pass).toBe(1);
    expect(result?.rows[0]?.missingInformation).toEqual(['Need production sample photo']);
  });

  it('parses checklist rows from an assistant markdown table', () => {
    const result = parseChecklistResultFromAssistantMessage(`
| Clause | Requirement | Evidence | Judgement | Missing information |
| --- | --- | --- | --- | --- |
| 8.1 | Guard present | Visual inspection | Pass | |
| 8.2 | Label durable | Rub test pending | Unknown | Final photo set |
`);

    expect(result).not.toBeNull();
    expect(result?.source).toBe('assistant_markdown_table');
    expect(result?.summary.total).toBe(2);
    expect(result?.summary.pass).toBe(1);
    expect(result?.summary.unknown).toBe(1);
    expect(result?.rows[1]?.missingInformation).toEqual(['Final photo set']);
  });

  it('parses checklist rows from clause sections with field tables', () => {
    const result = parseChecklistResultFromAssistantMessage(`
## 检查清单评估结果

### 条款 5.1
| 字段 | 内容 |
|------|------|
| **clause_id** | 5.1 |
| **requirement** | 产品标识应经久耐用，在正常操作后保持清晰可辨 |
| **evidence** | 1) 后部产品标签印有型号名称<br>2) 干布擦拭测试后文字保持清晰可辨 |
| **judgement** | **PASS** |
| **confidence** | High |
| **missing_info** | 无 |

### 条款 5.2
| 字段 | 内容 |
|------|------|
| **clause_id** | 5.2 |
| **requirement** | 警告标签应在安装时从用户面向的一侧可见 |
| **evidence** | 标签位于侧面板；靠墙安装后不可见 |
| **judgement** | **FAIL** |
| **confidence** | High |
| **missing_info** | 需要确认是否可由说明书补足 |
`);

    expect(result).not.toBeNull();
    expect(result?.source).toBe('assistant_clause_sections');
    expect(result?.summary.total).toBe(2);
    expect(result?.summary.pass).toBe(1);
    expect(result?.summary.fail).toBe(1);
    expect(result?.summary.missing).toBe(1);
    expect(result?.rows[0]?.missingInformation).toEqual([]);
    expect(result?.rows[1]?.missingInformation).toEqual(['需要确认是否可由说明书补足']);
  });

  it('ignores unrelated markdown content', () => {
    const result = parseChecklistResultFromAssistantMessage(`
# Notes

- This is a normal answer
- Without checklist structure
`);

    expect(result).toBeNull();
  });

  it('parses extract_checklist_rows tool output as a fallback source', () => {
    const messages: Message[] = [
      {
        id: 'tool-1',
        role: 'tool',
        content: 'Tool result',
        name: 'extract_checklist_rows',
        status: 'completed',
        toolMessage: {
          kind: 'result',
          toolName: 'extract_checklist_rows',
          success: true,
          details: 'Extracted checklist rows',
          output: {
            event: 'checklist_rows',
            path: '/workspace/checklist.csv',
            rows: [
              {
                row_id: 'row-1',
                clause_id: '9.1',
                requirement: 'Guard present',
                raw_evidence: 'Visual inspection',
                raw_judgement: 'Pass',
                locator: {
                  row_index: 4,
                },
              },
            ],
          },
        },
      },
    ];

    const result = parseChecklistResultFromToolMessages(messages);

    expect(result).not.toBeNull();
    expect(result?.source).toBe('tool_rows_only');
    expect(result?.isEvaluated).toBe(false);
    expect(result?.rows[0]?.clause).toBe('9.1');
    expect(result?.rows[0]?.locatorLabel).toBe('Row 4');
  });

  it('only builds checklist results for checklist_evaluation sessions', () => {
    const messages: Message[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: `
\`\`\`json
{"rows":[{"clause":"5.1","requirement":"Durable marking","judgement":"pass"}]}
\`\`\`
`,
        status: 'completed',
      },
    ];

    expect(buildChecklistResultViewModel({ scenarioId: 'standard_qa', messages })).toBeNull();
    expect(buildChecklistResultViewModel({ scenarioId: 'checklist_evaluation', messages })?.summary.total).toBe(1);
  });
});
