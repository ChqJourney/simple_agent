# Tool System Redesign Implementation Plan

## Goal

Implement the first-phase redesign of the tool system so that the agent has stronger foundational document tools, keeps generic execution as fallback, and presents tool activity in a business-friendly way for non-programmer users.

## Scope

### In Scope

- extend backend tool descriptor metadata
- add `list_directory_tree`
- add `search_files`
- add `read_file_excerpt`
- add `get_document_outline`
- update tool registration
- improve frontend tool summaries and confirmation messaging
- keep `shell_execute`, `python_execute`, and `node_execute` as fallback tools
- add tests for the new tools and updated UI formatting

### Out of Scope

- task-specific tool filtering
- new domain-specific base tools
- large protocol redesign
- skill workflow implementation itself

## Delivery Strategy

Deliver in four batches:

1. Backend metadata and foundational read/search tools
2. Document outline support
3. Frontend tool display and confirmation UX
4. Skill authoring guidance and polish

## Batch 1: Backend Metadata and Foundational Tools

## 1. Extend Tool Descriptor Metadata

### Files

- `python_backend/tools/base.py`
- `python_backend/tools/__init__.py`
- `python_backend/tests/test_tool_registry.py`

### Changes

- Add new fields to `ToolDescriptor`:
  - `read_only`
  - `risk_level`
  - `preferred_order`
  - `use_when`
  - `avoid_when`
  - `user_summary_template`
  - `result_preview_fields`
  - `tags`
- Add matching class attributes and `descriptor()` wiring in `BaseTool`.
- Set sensible defaults so existing tools continue to work unchanged.

### Recommended Defaults

- `read_only = False`
- `risk_level = "medium"`
- `preferred_order = 100`
- `use_when = ""`
- `avoid_when = ""`
- `user_summary_template = ""`
- `result_preview_fields = []`
- `tags = []`

### Acceptance Criteria

- Existing tools still serialize through `get_schemas()`.
- Registry tests pass after descriptor expansion.

## 2. Implement `list_directory_tree`

### New Files

- `python_backend/tools/list_directory_tree.py`
- `python_backend/tests/test_list_directory_tree_tool.py`

### Existing Files To Update

- `python_backend/main.py`
- `python_backend/tools/__init__.py`

### Implementation Details

- Resolve `path` relative to workspace, using the same workspace safety model as `file_read`.
- Traverse directories with `Path.iterdir()`.
- Support:
  - `max_depth`
  - `include_hidden`
  - `file_glob`
  - `max_entries`
- Return compact structured entries only.
- Do not read file content.
- Mark tool metadata:
  - `read_only = True`
  - `risk_level = "low"`
  - `preferred_order = 10`
  - `tags = ["document", "filesystem", "safe-read"]`

### Tests

- lists files and directories under workspace
- respects max depth
- filters hidden files
- filters by glob
- truncates when max entries is exceeded
- blocks out-of-workspace paths

## 3. Implement `search_files`

### New Files

- `python_backend/tools/search_files.py`
- `python_backend/tests/test_search_files_tool.py`

### Existing Files To Update

- `python_backend/main.py`
- `python_backend/tools/__init__.py`

### Implementation Details

- Search only inside the workspace.
- Support `plain` and `regex` modes.
- Support:
  - `path`
  - `file_glob`
  - `case_sensitive`
  - `max_results`
  - `context_lines`
- Search text-like files only in the first implementation.
- For binary files:
  - either skip
  - or return a skipped-file count in summary
- Return:
  - file path
  - line
  - column
  - matched text
  - nearby context
  - summary counts

### First Implementation Recommendation

- Start with line-based UTF-8 reading and `errors="replace"`.
- Skip files above a configurable maximum size.
- Add `truncated = true` if result cap is reached.

### Tests

- plain search finds expected lines
- regex search works
- case sensitivity works
- file glob works
- result count limit works
- summary hit count is correct
- binary or oversized files are skipped safely

## 4. Implement `read_file_excerpt`

### New Files

- `python_backend/tools/read_file_excerpt.py`
- `python_backend/tests/test_read_file_excerpt_tool.py`

### Existing Files To Update

- `python_backend/main.py`
- `python_backend/tools/__init__.py`

### Implementation Details

- Reuse workspace path resolution logic.
- Support units:
  - `line`
  - `char`
- Define `page` in schema now, but in the first implementation return a friendly error for unsupported file types unless page parsing is already available.
- Require `start` and `end`.
- Validate:
  - `start >= 1`
  - `end >= start`
- Return:
  - requested range
  - actual content
  - truncation indicator if needed
  - small summary object

### First Implementation Recommendation

- Fully support `line` and `char`.
- For `page`, support only if the target file type is already page-addressable in the current stack; otherwise fail clearly.

### Tests

- line range extraction works
- char range extraction works
- invalid ranges fail clearly
- path safety works
- missing files fail clearly

## Batch 2: Document Outline Support

## 5. Implement `get_document_outline`

### New Files

- `python_backend/tools/get_document_outline.py`
- `python_backend/tests/test_get_document_outline_tool.py`

### Existing Files To Update

- `python_backend/main.py`
- `python_backend/tools/__init__.py`

### Implementation Details

- First implementation targets text-like formats that already degrade well to plain text:
  - `.md`
  - `.txt`
  - possibly `.rst`
- Use heading heuristics:
  - markdown headings such as `#`, `##`
  - numbered headings such as `1`, `1.1`, `4.2.3`
  - optional all-caps section titles if helpful
- Return:
  - `nodes`
  - `node_count`
  - `max_level`
  - truncation flag

### Future Extension

- PDF outline extraction
- DOCX heading extraction
- clause-number-aware parsing

### Tests

- markdown headings become outline nodes
- numbered headings become outline nodes
- max node cap works
- unsupported file types fail with clear messages

## Batch 3: Frontend Tool UX

## 6. Add Tool Presentation Metadata Helpers

### Files

- `src/utils/toolMessages.ts`
- `src/utils/toolMessages.test.ts`

### Changes

- Add a helper that maps tool names plus arguments to business-friendly summaries.
- Add a helper that maps tool names to impact labels:
  - `只读`
  - `高级执行`
  - `会修改文件`
- Add a helper that maps tool names to UX group:
  - `目录浏览`
  - `全文搜索`
  - `局部读取`
  - `文档结构`
  - `高级执行`
  - `文件写入`

### Summary Rules

- `list_directory_tree`
  - example: `正在扫描目录 docs/，深度 3`
- `search_files`
  - example: `正在搜索 "GB/T 19001"，最多返回 50 条结果`
- `read_file_excerpt`
  - example: `正在读取 reports/a.md 的 line 120-160`
- `get_document_outline`
  - example: `正在提取 standards/iso.md 的文档结构`
- `shell_execute`
  - example: `正在使用高级 shell 执行作为兜底方案`
- `python_execute`
  - example: `正在使用高级 Python 执行作为兜底方案`
- `node_execute`
  - example: `正在使用高级 Node.js 执行作为兜底方案`

## 7. Redesign Tool Call Display

### Files

- `src/components/Tools/ToolCallDisplay.tsx`
- `src/components/Tools/ToolCard.tsx`
- `src/components/Tools/ToolCallDisplay.test.tsx`

### Changes

- Replace the current summary string with business summaries from `toolMessages.ts`.
- Add badges for:
  - tool group
  - safety or risk
- Show a short impact line under the summary.
- Move raw arguments into a collapsible "技术详情" block.
- If a result is provided, render:
  - summary line
  - small metrics
  - raw output in details

## 8. Redesign Tool Confirmation Modal

### Files

- `src/components/Tools/ToolConfirmModal.tsx`
- `src/components/Tools/ToolConfirmModal.test.tsx`

### Changes

- Replace raw technical title with business-friendly copy.
- Show:
  - requested action summary
  - risk badge
  - read-only or write indicator
  - fallback indicator for `shell/python/node`
- Keep the four decision actions:
  - reject
  - approve once
  - always this session
  - always this workspace
- Put raw arguments under a collapsible technical details area.

### Suggested Copy

- Read-only tools:
  - `助手需要读取或搜索工作区文件，这不会修改原文件。`
- Fallback execution tools:
  - `助手准备使用高级执行工具作为兜底方案。这类工具更灵活，但可解释性低于专用工具。`
- File writing:
  - `助手准备写入工作区文件，请确认输出路径和内容来源。`

## 9. Improve Tool Result Rendering

### Files

- `src/utils/toolMessages.ts`
- `src/components/Chat/MessageItem.tsx`
- `src/components/Chat/AssistantTurn.tsx`
- related tests

### Changes

- Add specialized result summarizers for the four new tools.
- Prefer short result summaries such as:
  - `已发现 42 个文件，7 个目录`
  - `搜索到 6 条命中，涉及 2 个文件`
  - `已读取 41 行内容`
  - `已识别 37 个结构节点`
- Keep raw payload available in details.

## Batch 4: Skill Guidance and Final Polish

## 10. Skill Authoring Guidance

### Files

- `docs/tool-system-redesign-design.md`
- optionally a new `docs/skills-document-workflow-guidelines.md`

### Guidance To Capture

- Prefer foundational tools before fallback execution.
- Use `list_directory_tree` before broad reads.
- Use `search_files` before `read_file_excerpt` whenever possible.
- Use `get_document_outline` before locating clauses or sections.
- Use `shell/python/node` only if foundational tools are insufficient.

## 11. Improve Fallback Tool Descriptions

### Files

- `python_backend/tools/shell_execute.py`
- `python_backend/tools/python_execute.py`
- `python_backend/tools/node_execute.py`
- tests for updated descriptions if needed

### Changes

- Update descriptions to explicitly position these tools as fallback tools.
- Add metadata:
  - `preferred_order = 90`
  - `risk_level = "high"`
  - `tags = ["execution", "fallback"]`
- Keep them fully available to the LLM.

## Suggested File Change List

### Backend

- `python_backend/tools/base.py`
- `python_backend/tools/__init__.py`
- `python_backend/main.py`
- `python_backend/tools/shell_execute.py`
- `python_backend/tools/python_execute.py`
- `python_backend/tools/node_execute.py`
- `python_backend/tools/list_directory_tree.py`
- `python_backend/tools/search_files.py`
- `python_backend/tools/read_file_excerpt.py`
- `python_backend/tools/get_document_outline.py`

### Backend Tests

- `python_backend/tests/test_tool_registry.py`
- `python_backend/tests/test_list_directory_tree_tool.py`
- `python_backend/tests/test_search_files_tool.py`
- `python_backend/tests/test_read_file_excerpt_tool.py`
- `python_backend/tests/test_get_document_outline_tool.py`

### Frontend

- `src/utils/toolMessages.ts`
- `src/components/Tools/ToolCallDisplay.tsx`
- `src/components/Tools/ToolCard.tsx`
- `src/components/Tools/ToolConfirmModal.tsx`
- `src/components/Chat/MessageItem.tsx`
- `src/components/Chat/AssistantTurn.tsx`

### Frontend Tests

- `src/utils/toolMessages.test.ts`
- `src/components/Tools/ToolCallDisplay.test.tsx`
- `src/components/Tools/ToolConfirmModal.test.tsx`
- update any affected chat rendering tests

## Testing Strategy

## Backend

- unit-test each new tool in isolation
- unit-test descriptor metadata serialization
- test path safety and truncation behavior
- test unsupported file types and invalid arguments

## Frontend

- tool call cards render business summaries
- confirmation modal shows correct risk wording
- fallback execution tools are visually distinct
- raw technical details remain accessible

## Manual Verification Checklist

- start a session and ask the agent to inspect a folder
- verify the LLM prefers `list_directory_tree` or `search_files` before `shell_execute`
- verify read-only tools feel safe in the UI
- verify `shell/python/node` show as advanced fallback tools
- verify output summaries are understandable without reading JSON

## Rollout Order

### PR 1

- descriptor metadata
- `list_directory_tree`
- tests

### PR 2

- `search_files`
- `read_file_excerpt`
- tests

### PR 3

- `get_document_outline`
- tests

### PR 4

- frontend tool summary redesign
- confirmation modal redesign
- tests

### PR 5

- fallback tool metadata polish
- skill guidance documentation
- final UX polish

## Risks

- Search and excerpt tools can accidentally become too close to `shell_execute` if argument design is sloppy.
- Outline extraction quality will vary by file type; the first version should be explicit about supported formats.
- Frontend business summaries can drift if not driven by consistent per-tool result shapes.
- If fallback tools are not clearly marked, the UX benefit of the new foundation tools will be diluted.

## Definition of Done

- All four foundational tools exist and are registered.
- Specialized tools are clearly marked as preferred and read-only.
- Generic execution tools remain available and clearly marked as fallback.
- Tool cards and confirmation dialogs read naturally for non-programmer users.
- Tests cover the new tools and the updated frontend summaries.
- Skills can rely on the new tool set without adding new base tools for domain logic.
