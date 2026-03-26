# Tool System Redesign Design

## Background

This project already has a working tool loop in `python_backend`, a frontend tool-call display in `src`, and a skill-loading mechanism. The current system is functional, but it is still closer to a general-purpose coding agent than a document-centric agent for certification and compliance workflows.

The target user is a non-programmer engineering professional. The LLM, however, is code-capable and should retain access to powerful fallback tools such as `shell_execute`, `python_execute`, and `node_execute`.

This redesign therefore does not try to remove coding-oriented tools. Instead, it raises the quality of the specialized read/search/document tools so that the LLM naturally prefers them first, and only falls back to generic execution when necessary.

## Goals

- Keep the existing generic execution tools as powerful fallback capabilities.
- Add a minimal set of high-value foundational document tools:
  - `list_directory_tree`
  - `search_files`
  - `read_file_excerpt`
  - `get_document_outline`
- Keep domain-heavy workflows such as structured field extraction, clause localization, and rule evaluation in skills rather than in base tools.
- Improve the tool metadata so the LLM can choose tools more reliably.
- Improve frontend presentation so non-programmer users see business-oriented action summaries instead of raw JSON dumps.
- Keep the tool registry simple for now. Do not introduce task-scoped tool exposure yet.

## Non-Goals

- No task-specific tool filtering in the first iteration.
- No new domain-specific tools such as `extract_structured_fields` or `evaluate_rule` at the tool layer.
- No removal of `shell_execute`, `python_execute`, or `node_execute`.
- No attempt to redesign the full agent loop or provider architecture in this phase.

## Current Problems

### Backend

- The current tool descriptors are too thin. They expose `name`, `description`, `parameters`, `category`, `require_confirmation`, and `policy`, but they do not express tool preference, read/write safety, human-facing summaries, or guidance about when to use or avoid the tool.
- The agent validates only a small subset of JSON schema semantics. This is sufficient for simple tools, but not strong enough once search and document tools introduce richer arguments.
- The current tool set lacks core grounding tools for document work. The model can read a file or execute a shell command, but it cannot cleanly answer:
  - What files are here?
  - Which files contain this term?
  - Read only the relevant excerpt.
  - What is the structure of this document?
- `shell_execute`, `python_execute`, and `node_execute` are necessary, but currently there is no explicit architecture distinction between these fallback tools and preferred tools.

### Frontend

- Tool-call display is mostly raw tool name plus JSON arguments and JSON-like results.
- Confirmation UI is technically correct, but still developer-oriented.
- The system does not clearly distinguish:
  - read-only safe actions
  - high-flexibility fallback execution
  - file-modifying actions
- Non-programmer users need to understand purpose and impact, not function names and arguments.

## Design Principles

### 1. Foundation Tools First, Fallback Tools Last

The LLM should have access to all tools, but the system should strongly nudge it toward specialized tools first and generic execution only when specialized tools are insufficient.

This means:

- keep all tools registered
- improve descriptions and metadata
- mark `shell_execute`, `python_execute`, and `node_execute` as fallback-style tools
- present those tools in the UI as advanced/system execution rather than normal document operations

### 2. Tools Stay General, Skills Stay Domain-Specific

The tool layer should solve general information access and controlled execution problems.

The skill layer should solve domain workflows such as:

- certification report review
- clause comparison
- structured extraction by schema
- pass/fail/uncertain decisions with evidence

This keeps the tool surface area small and stable while letting skill logic evolve quickly.

### 3. Outputs Must Be Stable and Easy to Summarize

Each tool should return structured output that is:

- consistent for the LLM
- easy to summarize in the frontend
- easy to test
- compact enough for tool-message round-trips

### 4. Frontend Should Explain Intent and Impact

Users should see:

- what the assistant is doing
- why it is doing it
- whether it is safe
- what it found

Raw arguments and raw outputs should remain available, but as secondary details.

## Tool Taxonomy

### Preferred Foundational Tools

- `list_directory_tree`
- `search_files`
- `read_file_excerpt`
- `get_document_outline`
- `file_read`
- `skill_loader`

### Fallback Execution Tools

- `shell_execute`
- `python_execute`
- `node_execute`

### Interaction and UI-State Tools

- `ask_question`
- `todo_task`

### Write Tool

- `file_write`

## Proposed Tool Descriptor Extensions

Extend `ToolDescriptor` with the following fields:

- `read_only: bool`
- `risk_level: "low" | "medium" | "high"`
- `preferred_order: int`
- `use_when: str`
- `avoid_when: str`
- `user_summary_template: str`
- `result_preview_fields: list[str]`
- `tags: list[str]`

### Semantics

- `read_only`
  - Whether the tool can change workspace state.
- `risk_level`
  - Controls frontend messaging and confirmation tone.
- `preferred_order`
  - Lower values indicate tools the LLM should conceptually prefer first.
- `use_when`
  - Short instruction describing the positive selection case.
- `avoid_when`
  - Short instruction describing common misuse cases.
- `user_summary_template`
  - Template for translating arguments into a human-facing summary.
- `result_preview_fields`
  - Which result keys are most useful for quick UI summaries.
- `tags`
  - Optional classification, such as `document`, `search`, `fallback`, `execution`, `safe-read`.

## Foundational Tool Specifications

## 1. `list_directory_tree`

### Purpose

Give the LLM a safe, structured overview of workspace contents before any detailed reads or search operations.

### Arguments

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Absolute path or path relative to current workspace",
      "default": "."
    },
    "max_depth": {
      "type": "integer",
      "default": 3
    },
    "include_hidden": {
      "type": "boolean",
      "default": false
    },
    "file_glob": {
      "type": "string",
      "description": "Optional glob filter such as '*.pdf' or '*.md'"
    },
    "max_entries": {
      "type": "integer",
      "default": 500
    }
  },
  "required": [],
  "additionalProperties": false
}
```

### Result Shape

```json
{
  "event": "directory_tree",
  "root": "/workspace/docs",
  "truncated": false,
  "entries": [
    {
      "path": "standards/GB-T-19001.pdf",
      "type": "file",
      "extension": ".pdf",
      "size_bytes": 1839201,
      "modified_at": "2026-03-26T10:00:00Z",
      "depth": 2
    }
  ],
  "summary": {
    "file_count": 42,
    "directory_count": 7,
    "top_extensions": [
      [".pdf", 21],
      [".xlsx", 8],
      [".docx", 4]
    ]
  }
}
```

## 2. `search_files`

### Purpose

Search across files in a controlled, structured way without relying on `shell_execute`.

### Arguments

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string"
    },
    "path": {
      "type": "string",
      "default": "."
    },
    "mode": {
      "type": "string",
      "enum": ["plain", "regex"],
      "default": "plain"
    },
    "file_glob": {
      "type": "string"
    },
    "case_sensitive": {
      "type": "boolean",
      "default": false
    },
    "max_results": {
      "type": "integer",
      "default": 50
    },
    "context_lines": {
      "type": "integer",
      "default": 2
    }
  },
  "required": ["query"],
  "additionalProperties": false
}
```

### Result Shape

```json
{
  "event": "search_results",
  "query": "GB/T 19001",
  "mode": "plain",
  "truncated": false,
  "results": [
    {
      "path": "standards/index.md",
      "line": 18,
      "column": 6,
      "match_text": "GB/T 19001",
      "context_before": "Applicable standards:",
      "context_after": "used for quality management."
    }
  ],
  "summary": {
    "hit_count": 6,
    "file_count": 2
  }
}
```

## 3. `read_file_excerpt`

### Purpose

Read only the necessary portion of a file instead of loading a whole document every time.

### Arguments

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string"
    },
    "unit": {
      "type": "string",
      "enum": ["line", "char", "page"],
      "default": "line"
    },
    "start": {
      "type": "integer"
    },
    "end": {
      "type": "integer"
    },
    "encoding": {
      "type": "string",
      "default": "utf-8"
    }
  },
  "required": ["path", "start", "end"],
  "additionalProperties": false
}
```

### Result Shape

```json
{
  "event": "file_excerpt",
  "path": "reports/report-a.md",
  "unit": "line",
  "start": 120,
  "end": 160,
  "truncated": false,
  "content": "....",
  "summary": {
    "line_count": 41
  }
}
```

## 4. `get_document_outline`

### Purpose

Extract the logical structure of a document so that skills can locate sections and clauses more reliably.

### Arguments

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string"
    },
    "max_nodes": {
      "type": "integer",
      "default": 200
    }
  },
  "required": ["path"],
  "additionalProperties": false
}
```

### Result Shape

```json
{
  "event": "document_outline",
  "path": "standards/GB-T-19001.md",
  "truncated": false,
  "nodes": [
    {
      "title": "4 Context of the organization",
      "level": 1,
      "anchor": "4-context-of-the-organization",
      "line_start": 82,
      "line_end": 133
    },
    {
      "title": "4.1 Understanding the organization and its context",
      "level": 2,
      "anchor": "4-1-understanding-the-organization-and-its-context",
      "line_start": 84,
      "line_end": 102
    }
  ],
  "summary": {
    "node_count": 37,
    "max_level": 3
  }
}
```

## Skill Boundary

The following capabilities should remain at the skill layer:

- `extract_structured_fields`
- `locate_clause`
- `evaluate_rule`
- document-to-document comparison
- compliance conclusion synthesis

Skills should compose the foundational tools instead of replacing them. A typical skill execution path should look like this:

1. `list_directory_tree`
2. `search_files`
3. `get_document_outline`
4. `read_file_excerpt`
5. skill-local reasoning and synthesis

## Tool Preference Strategy

Since this phase does not introduce task-scoped tool filtering, the system should prefer specialized tools through metadata and descriptions.

### Required Guidance for Fallback Execution Tools

Update descriptions for:

- `shell_execute`
- `python_execute`
- `node_execute`

So that they explicitly say:

- use only when specialized tools are insufficient
- prefer search/read/document tools for file and document work
- these are advanced fallback tools

## Frontend UX Design

## User Mental Model

The user should feel the assistant is doing document work, not function-calling.

The primary user-facing language should be:

- scanning directory
- searching files
- reading excerpt
- understanding structure
- asking for permission
- generating result

The primary user-facing language should not be:

- function call
- arguments
- stdout
- stderr
- JSON payload

## Tool Card Structure

Each tool call should have three levels:

### 1. Business Summary

Examples:

- Scanning the current document folder
- Searching for "GB/T 19001" in reports
- Reading lines 120-160 from `report-a.md`
- Extracting document structure from `standard.md`
- Using advanced shell execution as a fallback

### 2. User Impact

Examples:

- Read-only
- Will not modify files
- Advanced fallback execution
- May create or overwrite a file

### 3. Technical Details

Collapsed by default:

- raw arguments
- raw output
- stdout/stderr
- debugging hints

## Confirmation Modal Design

The modal should explain:

- what the assistant wants to do
- whether it is read-only
- whether it is a fallback execution tool
- whether files will be modified

Suggested confirmation copy examples:

- The assistant needs to search multiple files for relevant clauses. This is read-only.
- The assistant wants to use advanced shell execution because the specialized tools are insufficient for this step.
- The assistant wants to write an output file to the workspace.

## Result Presentation

Result cards should surface:

- brief summary
- important counts
- file references
- whether output was truncated

Only technical details should show the full raw payload.

## Compatibility Strategy

This redesign should preserve the current WebSocket event types:

- `tool_call`
- `tool_result`
- `tool_confirm_request`
- `tool_decision`

The preferred change is to enrich tool metadata and frontend formatting first, without forcing a protocol break.

Optional later enhancement:

- include descriptor-derived `display_meta` in `tool_call` and `tool_result` events
- let the frontend rely less on hardcoded per-tool name formatting

## Acceptance Criteria

- The system keeps `shell_execute`, `python_execute`, and `node_execute` available.
- The system adds `list_directory_tree`, `search_files`, `read_file_excerpt`, and `get_document_outline`.
- The new tools are read-only, structured, and test-covered.
- The frontend can distinguish normal read/search tools from fallback execution tools.
- The default UI for tool calls becomes business-oriented rather than JSON-oriented.
- Skill authors can compose the new tools to implement higher-level certification workflows.

## Expected Outcome

After this redesign:

- the LLM can ground itself in a workspace without immediately using shell commands
- document workflows become more reliable and cheaper in context usage
- users see understandable action summaries
- advanced execution remains available when needed
- domain-specific logic can continue to evolve in skills without exploding the base tool layer
