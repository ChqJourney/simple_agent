import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ChecklistResultPanel } from "./ChecklistResultPanel";
import { useChecklistStore } from "../../stores/checklistStore";
import { resetFrontendTestState } from "../../test/frontendTestState";

describe("ChecklistResultPanel", () => {
  beforeEach(() => {
    resetFrontendTestState();
    useChecklistStore.setState({ sessions: {} });
  });

  it("supports manual evidence and judgement edits in the right panel", () => {
    render(
      <ChecklistResultPanel
        sessionId="session-a"
        result={{
          source: "assistant_json",
          isEvaluated: true,
          summary: {
            total: 1,
            pass: 1,
            fail: 0,
            unknown: 0,
            na: 0,
            missing: 0,
          },
          rows: [
            {
              id: "row-1",
              clause: "5.1",
              requirement: "Durable marking",
              evidence: "Original evidence",
              judgement: "pass",
              confidence: "high",
              missingInformation: [],
            },
          ],
        }}
      />
    );

    fireEvent.change(screen.getByLabelText("5.1 Evidence"), {
      target: { value: "Manual evidence" },
    });
    fireEvent.change(screen.getByLabelText("5.1 Judgement"), {
      target: { value: "fail" },
    });
    fireEvent.change(screen.getByLabelText("5.1 Missing information"), {
      target: { value: "Need photo evidence" },
    });

    expect((screen.getByLabelText("5.1 Evidence") as HTMLTextAreaElement).value).toBe("Manual evidence");
    expect((screen.getByLabelText("5.1 Judgement") as HTMLSelectElement).value).toBe("fail");
    expect(screen.getByText("Manual")).toBeTruthy();
    expect(screen.getByText("Reset manual edits")).toBeTruthy();
  });
});
