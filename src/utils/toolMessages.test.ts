import { describe, expect, it } from "vitest";
import {
  createToolCallSummary,
  formatToolTechnicalValue,
  inferPersistedToolResult,
  renderToolResultDetails,
} from "./toolMessages";

describe("toolMessages", () => {
  it("formats structured execution outputs for display", () => {
    const details = renderToolResultDetails(true, {
      exit_code: 0,
      stdout: "hello",
      stderr: "",
    });

    expect(details).toContain("exit_code: 0");
    expect(details).toContain("stdout:");
    expect(details).toContain("hello");
  });

  it("creates business-friendly summaries for foundational tools", () => {
    const searchSummary = createToolCallSummary({
      name: "search_documents",
      arguments: { query: "GB/T 19001" },
    } as never);
    expect(searchSummary).toContain("GB/T 19001");
    expect(searchSummary).toContain("搜索");

    const readSummary = createToolCallSummary({
      name: "read_document_segment",
      arguments: {
        path: "report.md",
        locator: { type: "text_line_range", line_start: 12, line_end: 20 },
      },
    } as never);
    expect(readSummary).toContain("report.md");
    expect(readSummary).toContain("text_line_range");
  });

  it("formats directory tree results in a readable way", () => {
    const details = renderToolResultDetails(true, {
      event: "directory_tree",
      summary: {
        file_count: 42,
        directory_count: 7,
      },
    });

    expect(details).toContain("目录扫描完成");
    expect(details).toContain("文件数: 42");
    expect(details).toContain("目录数: 7");
  });

  it("formats document structure results in a readable way", () => {
    expect(createToolCallSummary({
      name: "get_document_structure",
      arguments: { path: "manual.pdf" },
    } as never)).toBe("正在提取 manual.pdf 的文档结构");

    const details = renderToolResultDetails(true, {
      event: "document_structure",
      summary: {
        node_count: 12,
        max_level: 3,
        document_type: "pdf",
        structure_type: "pdf_outline",
      },
    });

    expect(details).toContain("文档结构提取完成");
    expect(details).toContain("结构节点: 12");
    expect(details).toContain("最大层级: 3");
    expect(details).toContain("文档类型: pdf");
    expect(details).toContain("结构类型: pdf_outline");
  });

  it("creates OCR-friendly call summaries and result details", () => {
    const summary = createToolCallSummary({
      name: "ocr_extract",
      arguments: { path: "scan.pdf", input_type: "pdf" },
    } as never);
    expect(summary).toContain("PDF");
    expect(summary).toContain("scan.pdf");

    const details = renderToolResultDetails(true, {
      event: "ocr_extract",
      input_type: "pdf",
      content: "[Page 1]\nDetected text",
      summary: {
        char_count: 13,
        line_count: 1,
        page_count: 1,
        lang: "ch",
      },
      metadata: {
        cache_hit: true,
      },
    });

    expect(details).toContain("PDF OCR 完成");
    expect(details).toContain("字符数: 13");
    expect(details).toContain("页数: 1");
    expect(details).toContain("缓存: 命中");
    expect(details).toContain("Detected text");
  });

  it("formats document search results in a readable way", () => {
    const details = renderToolResultDetails(true, {
      event: "document_search_results",
      summary: {
        hit_count: 5,
        file_count: 2,
      },
    });

    expect(details).toContain("搜索完成");
    expect(details).toContain("命中数: 5");
    expect(details).toContain("涉及文件: 2");
  });

  it("formats document segment results in a readable way", () => {
    const details = renderToolResultDetails(true, {
      event: "document_segment",
      summary: {
        char_count: 18,
        line_count: 2,
        document_type: "pdf",
        segment_type: "pdf_line_range",
      },
      content: "[L10] target line",
    });

    expect(details).toContain("文档片段读取完成");
    expect(details).toContain("文档类型: pdf");
    expect(details).toContain("片段类型: pdf_line_range");
    expect(details).toContain("范围大小: 2 lines");
    expect(details).toContain("[L10] target line");
  });

  it("formats pending questions in a readable way", () => {
    const details = renderToolResultDetails(true, {
      event: "pending_question",
      question: "Continue deployment?",
      details: "Production traffic is low right now.",
      options: ["continue", "wait"],
    });

    expect(details).toContain("Question: Continue deployment?");
    expect(details).toContain("Production traffic is low right now.");
    expect(details).toContain("continue, wait");
  });

  it("formats skill loader outputs in a readable way", () => {
    const details = renderToolResultDetails(true, {
      event: "skill_loader",
      skill: {
        name: "deploy-checks",
        description: "Deployment checklist",
        source: "workspace",
        source_path: "/tmp/workspace/.agent/skills/deploy-checks/SKILL.md",
        frontmatter: "name: deploy-checks\ndescription: Deployment checklist",
        content: [
          "Always verify traffic before deploy.",
          "Check error budget before deploy.",
          "Review rollback steps.",
          "Validate metrics dashboards.",
          "Confirm on-call ownership.",
          "Post deployment note.",
          "Archive screenshots.",
        ].join("\n"),
      },
    });

    expect(details).toContain("Skill: deploy-checks");
    expect(details).toContain("Source: workspace");
    expect(details).toContain("Frontmatter:");
    expect(details).toContain("Instructions preview:");
    expect(details).toContain("Post deployment note.");
    expect(details).not.toContain("Archive screenshots.");
    expect(details).toContain("...");
  });

  it("shows stderr in failed execution outputs", () => {
    const details = renderToolResultDetails(false, {
      exit_code: 1,
      stdout: "",
      stderr: "ModuleNotFoundError: No module named 'pdfplumber'",
    }, "Python exited with code 1");

    expect(details).toContain("Error: Python exited with code 1");
    expect(details).toContain("exit_code: 1");
    expect(details).toContain("stderr:");
    expect(details).toContain("ModuleNotFoundError: No module named 'pdfplumber'");
  });

  it("shows simple error message when output has no execution details", () => {
    const details = renderToolResultDetails(false, "something broke", "Tool crashed");

    expect(details).toContain("Tool crashed");
    expect(details).toContain("Error");
  });

  it("truncates oversized technical payload values", () => {
    const formatted = formatToolTechnicalValue({
      content: "x".repeat(5000),
    });

    expect(formatted).toContain("truncated");
    expect(formatted.length).toBeLessThan(5000);
  });

  it("uses explicit persisted success when available", () => {
    expect(inferPersistedToolResult("Error: README.md", true)).toEqual({
      success: true,
      details: "Error: README.md",
    });
  });
});
