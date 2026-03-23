import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./markdown";

describe("parseMarkdown", () => {
  it("decodes a JSON content field into markdown text", () => {
    const parsed = parseMarkdown(
      '"content": "标题\\n\\n| 列1 | 列2 |\\n| --- | --- |\\n| A | B |"'
    );

    expect(parsed).toContain("标题");
    expect(parsed).toContain("| 列1 | 列2 |");
    expect(parsed).toContain("\n\n| 列1 | 列2 |");
    expect(parsed).not.toContain('\\"');
    expect(parsed).not.toContain("\\n");
  });

  it("decodes escaped newlines in plain markdown strings", () => {
    const parsed = parseMarkdown("第一行\\n第二行\\n- 列表项");

    expect(parsed).toContain("第一行  \n第二行");
    expect(parsed).toContain("\n\n- 列表项");
  });
});
