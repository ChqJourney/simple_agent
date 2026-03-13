import { fireEvent, render, screen } from "@testing-library/react";
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
          max_tool_rounds: 8,
          max_retries: 3,
        },
        context_providers: {
          skills: {
            local: {
              enabled: true,
            },
          },
          retrieval: {
            workspace: {
              enabled: true,
              max_hits: 3,
              extensions: [".md", ".txt", ".json"],
            },
          },
        },
      },
      setConfig: setConfigMock,
    });
    useUIStore.setState((state) => ({
      ...state,
      theme: "system",
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
    expect(screen.getByLabelText("Enable Workspace Retrieval")).toBeTruthy();
    expect(screen.getByLabelText("Retrieval Max Hits")).toBeTruthy();
  });

  it("offers DeepSeek in the provider selector", () => {
    render(<SettingsPage />);

    const providerSelects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    const providerOptions = Array.from(providerSelects[0].options).map((option) => option.textContent);

    expect(providerOptions).toContain("DeepSeek");
  });

  it("saves context provider settings through normalized config", () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getByLabelText("Enable Local Skills"));
    fireEvent.change(screen.getByLabelText("Retrieval Max Hits"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByLabelText("Max Output Tokens"), {
      target: { value: "2048" },
    });
    fireEvent.change(screen.getByLabelText("Max Tool Rounds"), {
      target: { value: "6" },
    });
    fireEvent.change(screen.getByLabelText("Max Retries"), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByLabelText("Retrieval File Types"), {
      target: { value: ".md, .py" },
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
          retrieval: {
            workspace: {
              enabled: true,
              max_hits: 5,
              extensions: [".md", ".py"],
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
});
