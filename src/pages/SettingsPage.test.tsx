import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";
import { useConfigStore, useUIStore } from "../stores";

const navigateMock = vi.hoisted(() => vi.fn());
const sendConfigMock = vi.hoisted(() => vi.fn());
const setConfigMock = vi.hoisted(() => vi.fn());

vi.mock("../contexts/WebSocketContext", () => ({
  useWebSocket: () => ({
    sendConfig: sendConfigMock,
  }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

describe("SettingsPage", () => {
  beforeEach(() => {
    localStorage.clear();
    navigateMock.mockReset();
    sendConfigMock.mockReset();
    setConfigMock.mockReset();
    globalThis.fetch = vi.fn();
    useConfigStore.setState({
      config: {
        provider: "openai",
        model: "gpt-4o",
        api_key: "test-key",
        base_url: "https://api.openai.com/v1",
        enable_reasoning: false,
        profiles: {
          primary: {
            provider: "openai",
            model: "gpt-4o",
            api_key: "test-key",
            base_url: "https://api.openai.com/v1",
            enable_reasoning: false,
            profile_name: "primary",
          },
          secondary: {
            provider: "openai",
            model: "gpt-4o-mini",
            api_key: "test-key",
            base_url: "https://api.openai.com/v1",
            enable_reasoning: false,
            profile_name: "secondary",
          },
        },
        runtime: {
          context_length: 64000,
          max_output_tokens: 4000,
          max_tool_rounds: 20,
          max_retries: 3,
        },
        context_providers: {
          skills: {
            local: {
              enabled: true,
            },
          },
        },
      },
      setConfig: setConfigMock,
    });
    useUIStore.setState((state) => ({
      ...state,
      theme: "system",
      baseFontSize: 16,
    }));
  });

  it("renders primary and secondary profile settings plus context provider controls", () => {
    render(<SettingsPage />);

    expect(screen.getByText("Primary Model")).toBeTruthy();
    expect(screen.getByText("Secondary Model")).toBeTruthy();
    expect(
      screen.getByText("Used for background helper tasks such as title generation. Falls back to the primary model when unset.")
    ).toBeTruthy();
    expect(screen.getByLabelText("Context Length")).toBeTruthy();
    expect(screen.getByLabelText("Max Output Tokens")).toBeTruthy();
    expect(screen.getByLabelText("Max Tool Rounds")).toBeTruthy();
    expect(screen.getByLabelText("Max Retries")).toBeTruthy();
    expect(screen.getByLabelText("Enable Local Skills")).toBeTruthy();
    expect(screen.getByLabelText("Base Font Size")).toBeTruthy();
  });

  it("renders separate connection test actions for primary and secondary profiles", () => {
    render(<SettingsPage />);

    expect(screen.getByRole("button", { name: "Test Primary Connection" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Test Secondary Connection" })).toBeTruthy();
  });

  it("shows default runtime values when runtime config is missing", () => {
    useConfigStore.setState({
      config: {
        provider: "openai",
        model: "gpt-4o",
        api_key: "test-key",
        base_url: "https://api.openai.com/v1",
        enable_reasoning: false,
        profiles: {
          primary: {
            provider: "openai",
            model: "gpt-4o",
            api_key: "test-key",
            base_url: "https://api.openai.com/v1",
            enable_reasoning: false,
            profile_name: "primary",
          },
        },
      },
      setConfig: setConfigMock,
    });

    render(<SettingsPage />);

    expect((screen.getByLabelText("Context Length") as HTMLInputElement).value).toBe("64000");
    expect((screen.getByLabelText("Max Output Tokens") as HTMLInputElement).value).toBe("4000");
    expect((screen.getByLabelText("Max Tool Rounds") as HTMLInputElement).value).toBe("20");
    expect((screen.getByLabelText("Max Retries") as HTMLInputElement).value).toBe("3");
  });

  it("offers hosted providers in the provider selector", () => {
    render(<SettingsPage />);

    const providerSelects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    const providerOptions = Array.from(providerSelects[0].options).map((option) => option.textContent);

    expect(providerOptions).toContain("DeepSeek");
    expect(providerOptions).toContain("Kimi (Moonshot)");
    expect(providerOptions).toContain("GLM (Zhipu)");
    expect(providerOptions).toContain("MiniMax");
  });

  it("includes backend auth header when testing provider connectivity", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ ok: true }),
    } as unknown as Response);

    render(<SettingsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Test Primary Connection" }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "X-Tauri-Agent-Auth": "test-auth-token",
          }),
        })
      );
    });
  });

  it("marks configured providers in the selector and shows a saved hint", () => {
    render(<SettingsPage />);

    const providerSelects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    const providerOptions = Array.from(providerSelects[0].options).map((option) => option.textContent);

    expect(providerOptions).toContain("OpenAI · Saved");
    expect(screen.getAllByText("Saved API configuration found for this provider.").length).toBeGreaterThan(0);
  });

  it("shows image support status in the primary model list", () => {
    render(<SettingsPage />);

    const modelSelect = screen.getByLabelText("Primary Model Model") as HTMLSelectElement;
    const modelOptions = Array.from(modelSelect.options).map((option) => option.textContent);

    expect(modelOptions).toContain("gpt-4o · Images");
    expect(modelOptions).toContain("gpt-4-turbo · Unknown");
    expect(modelOptions).toContain("o1-preview · Text only");
    expect(screen.getAllByText("Image input is supported for this model.").length).toBeGreaterThan(0);
  });

  it("saves context provider settings through normalized config", () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getByLabelText("Enable Local Skills"));
    fireEvent.change(screen.getByLabelText("Max Output Tokens"), {
      target: { value: "2048" },
    });
    fireEvent.change(screen.getByLabelText("Max Tool Rounds"), {
      target: { value: "6" },
    });
    fireEvent.change(screen.getByLabelText("Max Retries"), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByText("Save"));

    expect(setConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: {
          context_length: 64000,
          max_output_tokens: 2048,
          max_tool_rounds: 6,
          max_retries: 4,
        },
        context_providers: {
          skills: {
            local: {
              enabled: false,
            },
          },
        },
      })
    );
    expect(sendConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context_providers: expect.objectContaining({
          skills: expect.objectContaining({
            local: {
              enabled: false,
            },
          }),
        }),
      })
    );
  });

  it("saves base font size into appearance config", () => {
    render(<SettingsPage />);

    fireEvent.change(screen.getByLabelText("Base Font Size"), {
      target: { value: "18" },
    });
    fireEvent.click(screen.getByText("Save"));

    expect(setConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        appearance: {
          base_font_size: 18,
        },
      })
    );
  });

  it("allows saving a configured model before an API key is added", () => {
    render(<SettingsPage />);

    fireEvent.change(screen.getAllByPlaceholderText("Enter your API key")[0], {
      target: { value: "" },
    });
    fireEvent.click(screen.getByText("Save"));

    expect(setConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        model: "gpt-4o",
        api_key: "",
        profiles: expect.objectContaining({
          primary: expect.objectContaining({
            provider: "openai",
            model: "gpt-4o",
            api_key: "",
          }),
        }),
      })
    );
    expect(sendConfigMock).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith(-1);
  });

  it("remembers api key and base url per provider when switching providers", () => {
    render(<SettingsPage />);

    const providerSelect = screen.getByLabelText("Primary Model Provider");
    const modelSelect = screen.getByLabelText("Primary Model Model");

    fireEvent.change(providerSelect, { target: { value: "kimi" } });
    fireEvent.change(modelSelect, { target: { value: "kimi-k2.5" } });
    fireEvent.change(screen.getAllByPlaceholderText("Enter your API key")[0], {
      target: { value: "kimi-key" },
    });
    fireEvent.change(screen.getAllByPlaceholderText("Custom API endpoint")[0], {
      target: { value: "https://api.moonshot.cn/v1" },
    });

    fireEvent.change(screen.getByLabelText("Primary Model Provider"), {
      target: { value: "deepseek" },
    });

    expect((screen.getAllByPlaceholderText("Enter your API key")[0] as HTMLInputElement).value).toBe("");
    expect((screen.getAllByPlaceholderText("Custom API endpoint")[0] as HTMLInputElement).value).toBe("");

    fireEvent.change(screen.getByLabelText("Primary Model Provider"), {
      target: { value: "kimi" },
    });

    expect((screen.getByLabelText("Primary Model Model") as HTMLSelectElement).value).toBe("kimi-k2.5");
    expect((screen.getAllByPlaceholderText("Enter your API key")[0] as HTMLInputElement).value).toBe("kimi-key");
    expect((screen.getAllByPlaceholderText("Custom API endpoint")[0] as HTMLInputElement).value).toBe("https://api.moonshot.cn/v1");
  });
});
