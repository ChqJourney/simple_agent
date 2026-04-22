import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StandardQaReportPanel } from "./StandardQaReportPanel";
import { createSessionMetaFixture, resetFrontendTestState } from "../../test/frontendTestState";
import type { Message } from "../../types";
import {
  fetchStandardQaReportPdfProgress,
  fetchStandardQaReportSummary,
  startStandardQaReportPdfGeneration,
} from "../../utils/standardQaReport";

const saveMock = vi.hoisted(() => vi.fn());
const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: saveMock,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("../../utils/standardQaReport", () => ({
  fetchStandardQaReportSummary: vi.fn(),
  startStandardQaReportPdfGeneration: vi.fn(),
  fetchStandardQaReportPdfProgress: vi.fn(),
}));

const completedMessages: Message[] = [
  {
    id: "user-1",
    role: "user",
    content: "请确认 5.1 条款要求",
    status: "completed",
  },
  {
    id: "assistant-1",
    role: "assistant",
    content: "结论：5.1 条款要求铭牌耐久。",
    status: "completed",
  },
];

describe("StandardQaReportPanel", () => {
  beforeEach(() => {
    resetFrontendTestState();
    vi.mocked(fetchStandardQaReportSummary).mockReset();
    vi.mocked(startStandardQaReportPdfGeneration).mockReset();
    vi.mocked(fetchStandardQaReportPdfProgress).mockReset();
    saveMock.mockReset();
    invokeMock.mockReset();
  });

  it("disables PDF generation until the session has completed Q&A content", () => {
    render(
      <StandardQaReportPanel
        session={createSessionMetaFixture({ scenario_id: "standard_qa" })}
        messages={[]}
      />
    );

    expect((screen.getByRole("button", { name: "Generate PDF Report" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/no complete Q&A/i)).toBeTruthy();
  });

  it("loads backup-model summary and saves a primary-model PDF report", async () => {
    vi.mocked(fetchStandardQaReportSummary).mockResolvedValue({
      summary: {
        title: "5.1 Marking Review",
        overview: "Reviewed marking durability evidence.",
        key_points: ["Clause 5.1 applies"],
        evidence_highlights: ["IEC file page 12"],
        open_questions: [],
      },
      digest: "digest-a",
      generated_at: "2026-04-22T10:00:00Z",
      cached: false,
    });
    vi.mocked(startStandardQaReportPdfGeneration).mockResolvedValue({
      report_id: "report-a",
      session_id: "session-a",
      workspace_path: "/workspace",
      status: "running",
      phase: "llm_stream",
      progress_percent: 25,
      detail: "The primary model is drafting",
      generated_characters: 120,
      generated_tokens: 40,
      started_at: "2026-04-22T10:00:30Z",
      updated_at: "2026-04-22T10:00:30Z",
      completed_at: null,
      cached: false,
    });
    vi.mocked(fetchStandardQaReportPdfProgress).mockResolvedValue({
      report_id: "report-a",
      session_id: "session-a",
      workspace_path: "/workspace",
      status: "completed",
      phase: "completed",
      progress_percent: 100,
      detail: "Report generation completed.",
      generated_characters: 240,
      generated_tokens: 80,
      started_at: "2026-04-22T10:00:30Z",
      updated_at: "2026-04-22T10:01:00Z",
      completed_at: "2026-04-22T10:01:00Z",
      filename: "report.pdf",
      pdf_base64: "JVBERi0x",
      digest: "digest-a",
      generated_at: "2026-04-22T10:01:00Z",
      cached: false,
    });
    saveMock.mockResolvedValue("/tmp/standard-report.pdf");
    invokeMock.mockResolvedValue(undefined);

    render(
      <StandardQaReportPanel
        session={createSessionMetaFixture({ scenario_id: "standard_qa" })}
        messages={completedMessages}
      />
    );

    expect(await screen.findByText("5.1 Marking Review")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Generate PDF Report" }));

    await waitFor(() => {
      expect(startStandardQaReportPdfGeneration).toHaveBeenCalledWith("/workspace", "session-a");
      expect(fetchStandardQaReportPdfProgress).toHaveBeenCalledWith("report-a");
      expect(invokeMock).toHaveBeenCalledWith("write_report_pdf", {
        selectedPath: "/tmp/standard-report.pdf",
        pdfBase64: "JVBERi0x",
      });
      expect(screen.getByText("Report saved: /tmp/standard-report.pdf")).toBeTruthy();
    });
  });
});
