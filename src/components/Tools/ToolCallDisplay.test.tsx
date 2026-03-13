import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToolCallDisplay } from "./ToolCallDisplay";

describe("ToolCallDisplay", () => {
  it("shows the inferred tool category for execution tools", () => {
    render(
      <ToolCallDisplay
        toolCall={{
          tool_call_id: "shell-1",
          name: "shell_execute",
          arguments: {
            command: "echo hello",
          },
        }}
      />
    );

    expect(screen.getByText("execution")).toBeTruthy();
  });
});
