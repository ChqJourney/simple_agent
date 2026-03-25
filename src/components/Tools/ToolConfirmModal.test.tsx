import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolConfirmModal } from "./ToolConfirmModal";

describe("ToolConfirmModal", () => {
  it("supports always approve scope selection for session and workspace", () => {
    const onDecision = vi.fn();

    render(
      <ToolConfirmModal
        toolCall={{
          tool_call_id: "tool-1",
          name: "shell_execute",
          arguments: { command: "echo hi" },
        }}
        onDecision={onDecision}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Always This Session" }));
    fireEvent.click(screen.getByRole("button", { name: "Always This Workspace" }));

    expect(onDecision).toHaveBeenNthCalledWith(1, "approve_always", "session");
    expect(onDecision).toHaveBeenNthCalledWith(2, "approve_always", "workspace");
  });

  it("renders as an accessible dialog and rejects on escape", () => {
    const onDecision = vi.fn();

    render(
      <ToolConfirmModal
        toolCall={{
          tool_call_id: "tool-1",
          name: "shell_execute",
          arguments: { command: "echo hi" },
        }}
        onDecision={onDecision}
      />
    );

    expect(screen.getByRole("dialog", { name: "Confirm Tool Execution" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onDecision).toHaveBeenCalledWith("reject");
  });
});
