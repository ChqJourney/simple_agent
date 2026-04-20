import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderConfigForm } from "./ProviderConfig";

const listProviderModelsMock = vi.hoisted(() => vi.fn());

vi.mock("../../utils/providerModels", () => ({
  listProviderModels: listProviderModelsMock,
}));

describe("ProviderConfigForm", () => {
  beforeEach(() => {
    listProviderModelsMock.mockReset();
  });

  it("shows live catalog status when dynamic models load successfully", async () => {
    listProviderModelsMock.mockResolvedValue([
      { id: "gpt-4.1-mini", context_length: 128000, supports_image_in: true },
      { id: "gpt-4.1", context_length: 128000, supports_image_in: true },
    ]);

    render(
      <ProviderConfigForm
        config={{
          provider: "openai",
          model: "gpt-4.1-mini",
          api_key: "test-key",
          base_url: "https://api.openai.com/v1",
          enable_reasoning: false,
        }}
        onChange={vi.fn()}
        enableDynamicModelCatalog={true}
      />,
    );

    await waitFor(() => {
      expect(listProviderModelsMock).toHaveBeenCalledWith(
        "openai",
        "https://api.openai.com/v1",
        "test-key",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Showing the live model catalog from the provider.")).toBeTruthy();
    });

    expect(screen.getByText("Context window: 128K tokens.")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Model Model"));
    const modelOptions = screen.getAllByRole("option").map((option) => option.textContent || "");
    expect(modelOptions.some((option) => option.includes("gpt-4.1-mini") && option.includes("Images") && option.includes("128K context"))).toBe(true);

    expect(listProviderModelsMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the built-in model list when live loading fails", async () => {
    listProviderModelsMock.mockRejectedValue(new Error("boom"));

    render(
      <ProviderConfigForm
        config={{
          provider: "openai",
          model: "gpt-4o",
          api_key: "test-key",
          base_url: "https://api.openai.com/v1",
          enable_reasoning: false,
        }}
        onChange={vi.fn()}
        enableDynamicModelCatalog={true}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Could not refresh the live catalog, so the built-in model list is shown.")).toBeTruthy();
    });

    expect(listProviderModelsMock).toHaveBeenCalledTimes(1);
  });

  it("lets the user apply a custom model id that is not in the catalog", async () => {
    const onChange = vi.fn();

    render(
      <ProviderConfigForm
        config={{
          provider: "openai",
          model: "gpt-4o",
          api_key: "test-key",
          base_url: "https://api.openai.com/v1",
          enable_reasoning: false,
        }}
        onChange={onChange}
        enableDynamicModelCatalog={false}
      />,
    );

    fireEvent.change(screen.getByLabelText("Custom model ID"), {
      target: { value: "gpt-4.1-nano-preview" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use model" }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        model: "gpt-4.1-nano-preview",
      }),
    );
  });
});
