import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";
import { useConfigStore, useUIStore } from "../stores";

const navigateMock = vi.hoisted(() => vi.fn());
const sendConfigMock = vi.hoisted(() => vi.fn());
const setConfigMock = vi.hoisted(() => vi.fn());
const listSystemSkillsMock = vi.hoisted(() => vi.fn());
const listToolsMock = vi.hoisted(() => vi.fn());
const listProviderModelsMock = vi.hoisted(() => vi.fn());

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

vi.mock("../utils/systemSkills", () => ({
  listSystemSkills: listSystemSkillsMock,
}));

vi.mock("../utils/toolCatalog", () => ({
  listTools: listToolsMock,
}));

vi.mock("../utils/providerModels", () => ({
  listProviderModels: listProviderModelsMock,
}));

function openTab(name: "Runtime" | "Tools" | "Skill" | "Reference" | "UI") {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${name}`) }));
}

function listOpenOptions() {
  return screen.getAllByRole("option").map((option) => option.textContent || "");
}

function openSelect(label: string) {
  fireEvent.click(screen.getByLabelText(label));
}

function selectOption(label: string, optionText: string) {
  openSelect(label);
  const target = screen.getAllByRole("option").find((option) => option.textContent?.includes(optionText));
  expect(target).toBeTruthy();
  fireEvent.click(target!);
}

function openModelEditor(buttonName: string) {
  fireEvent.click(screen.getByRole("button", { name: buttonName }));
}

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    navigateMock.mockReset();
    sendConfigMock.mockReset();
    setConfigMock.mockReset();
    listSystemSkillsMock.mockReset();
    listToolsMock.mockReset();
    listProviderModelsMock.mockReset();
    globalThis.fetch = vi.fn();
    listProviderModelsMock.mockResolvedValue([]);
    listSystemSkillsMock.mockResolvedValue({
      rootPath: "/system-skills",
      rootPaths: ["/portable/skills", "/system-skills"],
      skills: [
        {
          name: "deploy-checks",
          description: "System skill",
          path: "/system-skills/deploy-checks/SKILL.md",
        },
      ],
    });
    listToolsMock.mockResolvedValue([
      {
        name: "file_read",
        description: "Read a file from the workspace.",
      },
      {
        name: "skill_loader",
        description: "Load local skill instructions.",
      },
    ]);
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
          background: {
            provider: "openai",
            model: "gpt-4o-mini",
            api_key: "test-key",
            base_url: "https://api.openai.com/v1",
            enable_reasoning: false,
            profile_name: "background",
          },
        },
        runtime: {
          shared: {
            context_length: 64000,
            max_output_tokens: 4000,
            max_tool_rounds: 20,
            max_retries: 3,
            timeout_seconds: 30,
          },
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
      locale: "en-US",
      baseFontSize: 16,
    }));
  });

  it("renders primary and background profile settings plus context provider controls", () => {
    render(<SettingsPage />);

    expect(screen.getByText("Primary Model")).toBeTruthy();
    expect(screen.getByText("Background Model")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change Primary Model" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change Background Model" })).toBeTruthy();
    expect(screen.getAllByText("Current provider").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Current model").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Thinking support").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Thinking enabled").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unsupported").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Disabled").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Enable reasoning")).toBeNull();

    openModelEditor("Change Primary Model");
    expect(screen.getByRole("dialog", { name: "Change Primary Model" })).toBeTruthy();
    expect(screen.getByLabelText("Primary Model Provider")).toBeTruthy();
    expect(screen.getByLabelText("Enable reasoning")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(screen.queryByRole("dialog", { name: "Change Primary Model" })).toBeNull();

    openModelEditor("Change Background Model");
    expect(screen.getByRole("dialog", { name: "Change Background Model" })).toBeTruthy();
    expect(screen.getByLabelText("Background Model Provider")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    openTab("Runtime");
    expect(screen.getByText("Shared Runtime")).toBeTruthy();
    expect(screen.getByText("Conversation Overrides")).toBeTruthy();
    expect(screen.getByText("Background Overrides")).toBeTruthy();
    expect(screen.getByText("Compaction Overrides")).toBeTruthy();
    expect(screen.getByText("Delegated Task Overrides")).toBeTruthy();
    expect(screen.getByLabelText("Shared Runtime Context Length")).toBeTruthy();
    expect(screen.getByLabelText("Conversation Overrides Max Output Tokens")).toBeTruthy();
    expect(screen.getByLabelText("Background Overrides Max Tool Rounds")).toBeTruthy();
    expect(screen.getByLabelText("Compaction Overrides Max Retries")).toBeTruthy();
    expect(screen.getByLabelText("Delegated Task Overrides Timeout Seconds")).toBeTruthy();

    openTab("Skill");
    expect(screen.getByLabelText("Enable Local Skills")).toBeTruthy();

    openTab("UI");
    expect(screen.getByLabelText("Base Font Size")).toBeTruthy();
  }, 10000);

  it("renders separate connection test actions for primary and background profiles", () => {
    render(<SettingsPage />);

    expect(screen.getByRole("button", { name: "Test Primary Connection" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Test Background Connection" })).toBeTruthy();
  });

  it("renders all configured system skill roots", async () => {
    render(<SettingsPage />);

    openTab("Skill");

    await waitFor(() => {
      expect(screen.getByText("/portable/skills")).toBeTruthy();
      expect(screen.getByText("/system-skills")).toBeTruthy();
    });
  });

  it("loads reference index status once per standard root instead of refetching on every render", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        ok: true,
        status: {
          root_id: "ref-root-1",
          root_path: "/reference/standards",
          catalog_path: "/reference/standards/.agent/reference_index/standard_catalog.json",
          exists: true,
          status: "ready",
          document_count: 12,
          indexed_document_count: 12,
          pending: {
            new: 0,
            updated: 0,
            removed: 0,
            unchanged: 12,
          },
          last_built_at: "2026-04-19T00:00:00Z",
        },
      }),
    } as unknown as Response);

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
        reference_library: {
          roots: [
            {
              id: "ref-root-1",
              label: "Standards",
              path: "/reference/standards",
              enabled: true,
              kinds: ["standard"],
            },
          ],
        },
      },
      setConfig: setConfigMock,
    });

    render(<SettingsPage />);
    openTab("Reference");

    await waitFor(() => {
      expect(screen.getByText("Catalog is up to date.")).toBeTruthy();
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("shows reference index build progress details while a catalog build is running", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          ok: true,
          status: {
            root_id: "ref-root-1",
            root_path: "/reference/standards",
            catalog_path: "/reference/standards/.agent/reference_index/standard_catalog.json",
            exists: false,
            status: "stale",
            document_count: 12,
            indexed_document_count: 0,
            pending: {
              new: 12,
              updated: 0,
              removed: 0,
              unchanged: 0,
            },
            last_built_at: null,
          },
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          ok: true,
          progress: {
            build_id: "build-1",
            root_id: "ref-root-1",
            root_path: "/reference/standards",
            mode: "incremental",
            status: "running",
            phase: "extracting",
            progress_percent: 25,
            detail: "Reading standard document metadata and scope: IEC-60335-1.pdf",
            total_documents: 12,
            processed_documents: 3,
            counts: { created: 1, updated: 0, removed: 0, unchanged: 2 },
            current_document: {
              relative_path: "IEC-60335-1.pdf",
              file_name: "IEC-60335-1.pdf",
            },
            started_at: "2026-04-19T00:00:00Z",
            updated_at: "2026-04-19T00:00:01Z",
            completed_at: null,
            error: null,
          },
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          ok: true,
          progress: {
            build_id: "build-1",
            root_id: "ref-root-1",
            root_path: "/reference/standards",
            mode: "incremental",
            status: "completed",
            phase: "completed",
            progress_percent: 100,
            detail: "Standard catalog build completed.",
            total_documents: 12,
            processed_documents: 12,
            counts: { created: 4, updated: 1, removed: 0, unchanged: 7 },
            current_document: {
              relative_path: "IEC-60335-1.pdf",
              file_name: "IEC-60335-1.pdf",
            },
            started_at: "2026-04-19T00:00:00Z",
            updated_at: "2026-04-19T00:00:10Z",
            completed_at: "2026-04-19T00:00:10Z",
            error: null,
            result: {
              root_id: "ref-root-1",
              root_path: "/reference/standards",
              catalog_path: "/reference/standards/.agent/reference_index/standard_catalog.json",
              generated_at: "2026-04-19T00:00:10Z",
              document_count: 12,
              indexed_document_count: 12,
              counts: { created: 4, updated: 1, removed: 0, unchanged: 7 },
              status: "ready",
            },
            index_status: {
              root_id: "ref-root-1",
              root_path: "/reference/standards",
              catalog_path: "/reference/standards/.agent/reference_index/standard_catalog.json",
              exists: true,
              status: "ready",
              document_count: 12,
              indexed_document_count: 12,
              pending: { new: 0, updated: 0, removed: 0, unchanged: 12 },
              last_built_at: "2026-04-19T00:00:10Z",
            },
          },
        }),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

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
        reference_library: {
          roots: [
            {
              id: "ref-root-1",
              label: "Standards",
              path: "/reference/standards",
              enabled: true,
              kinds: ["standard"],
            },
          ],
        },
      },
      setConfig: setConfigMock,
    });

    render(<SettingsPage />);
    openTab("Reference");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Create Index" })).toBeTruthy();
    });

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Create Index" }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Reading standard document metadata and scope: IEC-60335-1.pdf")).toBeTruthy();
    expect(screen.getByText("3/12 standard documents processed")).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(800);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Index updated: 4 created, 1 updated, 0 removed.")).toBeTruthy();
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

    openTab("Runtime");
    expect((screen.getByLabelText("Shared Runtime Context Length") as HTMLInputElement).value).toBe("64000");
    expect((screen.getByLabelText("Shared Runtime Max Output Tokens") as HTMLInputElement).value).toBe("4000");
    expect((screen.getByLabelText("Shared Runtime Max Tool Rounds") as HTMLInputElement).value).toBe("20");
    expect((screen.getByLabelText("Shared Runtime Max Retries") as HTMLInputElement).value).toBe("3");
    expect((screen.getByLabelText("Delegated Task Overrides Timeout Seconds") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Conversation Overrides Context Length") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Background Overrides Max Output Tokens") as HTMLInputElement).value).toBe("");
  });

  it("saves delegated task timeout overrides through normalized config", () => {
    render(<SettingsPage />);

    openTab("Runtime");
    fireEvent.change(screen.getByLabelText("Delegated Task Overrides Timeout Seconds"), {
      target: { value: "90" },
    });
    fireEvent.click(screen.getByText("Save"));

    expect(setConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: expect.objectContaining({
          delegated_task: expect.objectContaining({
            timeout_seconds: 90,
          }),
        }),
      })
    );
    expect(sendConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: expect.objectContaining({
          delegated_task: expect.objectContaining({
            timeout_seconds: 90,
          }),
        }),
      })
    );
  });

  it("shows runtime guardrail warnings when effective values exceed the selected role model window", () => {
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
          background: {
            provider: "deepseek",
            model: "deepseek-chat",
            api_key: "test-key",
            base_url: "https://api.deepseek.com",
            enable_reasoning: false,
            profile_name: "background",
          },
        },
        runtime: {
          shared: {
            context_length: 160000,
            max_output_tokens: 4000,
            max_tool_rounds: 20,
            max_retries: 3,
          },
          background: {
            max_output_tokens: 200000,
          },
        },
      },
      setConfig: setConfigMock,
    });

    render(<SettingsPage />);

    openTab("Runtime");

    expect(screen.getByText(/Context length \(160000\) is higher than the known openai\/gpt-4o window \(128000\)/)).toBeTruthy();
    expect(screen.getByText(/Max output tokens \(200000\) exceeds the effective context length \(160000\)/)).toBeTruthy();
    expect(screen.getAllByText(/Context length \(160000\) is higher than the known deepseek\/deepseek-chat window \(128000\)/).length).toBeGreaterThan(0);
  });

  it("saves a custom system prompt through normalized config", () => {
    render(<SettingsPage />);

    openTab("Runtime");
    fireEvent.change(screen.getByLabelText("Global Instructions"), {
      target: { value: "  Prefer concise answers.  " },
    });
    fireEvent.click(screen.getByText("Save"));

    expect(setConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        system_prompt: "Prefer concise answers.",
      })
    );
    expect(sendConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        system_prompt: "Prefer concise answers.",
      })
    );
  });

  it("offers hosted providers in the provider selector", () => {
    render(<SettingsPage />);

    openModelEditor("Change Primary Model");
    openSelect("Primary Model Provider");
    const providerOptions = listOpenOptions();

    expect(providerOptions.some((option) => option.includes("DeepSeek"))).toBe(true);
    expect(providerOptions.some((option) => option.includes("Kimi (Moonshot)"))).toBe(true);
    expect(providerOptions.some((option) => option.includes("GLM (Zhipu)"))).toBe(true);
    expect(providerOptions.some((option) => option.includes("MiniMax"))).toBe(true);
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

  it("times out a slow connection test and surfaces a helpful error", async () => {
    vi.useFakeTimers();
    vi.mocked(globalThis.fetch).mockImplementation((_input, init) => {
      const signal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });

    try {
      render(<SettingsPage />);

      fireEvent.click(screen.getByRole("button", { name: "Test Primary Connection" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000);
      });

      expect(screen.getByText(/connection test timed out after 15 seconds/i)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks configured providers in the selector and shows a saved hint", () => {
    render(<SettingsPage />);

    openModelEditor("Change Primary Model");
    openSelect("Primary Model Provider");
    const providerOptions = listOpenOptions();

    expect(providerOptions.some((option) => option.includes("OpenAI") && option.includes("Saved configuration available"))).toBe(true);
    expect(screen.getAllByText("Saved API configuration found for this provider.").length).toBeGreaterThan(0);
  });

  it("shows image support status in the primary model list", () => {
    render(<SettingsPage />);

    openModelEditor("Change Primary Model");
    openSelect("Primary Model Model");
    const modelOptions = listOpenOptions();

    expect(modelOptions.some((option) => option.includes("gpt-4o") && option.includes("Images"))).toBe(true);
    expect(modelOptions.some((option) => option.includes("gpt-4-turbo") && option.includes("Text only"))).toBe(true);
    expect(modelOptions.some((option) => option.includes("o1-preview") && option.includes("Text only"))).toBe(true);
    expect(screen.getAllByText("Image input is supported for this model.").length).toBeGreaterThan(0);
  });

  it("saves context provider settings through normalized config", () => {
    render(<SettingsPage />);

    openTab("Skill");
    fireEvent.click(screen.getByLabelText("Enable Local Skills"));

    openTab("Runtime");
    fireEvent.change(screen.getByLabelText("Shared Runtime Max Output Tokens"), {
      target: { value: "2048" },
    });
    fireEvent.change(screen.getByLabelText("Shared Runtime Max Tool Rounds"), {
      target: { value: "6" },
    });
    fireEvent.change(screen.getByLabelText("Shared Runtime Max Retries"), {
      target: { value: "4" },
    });
    fireEvent.click(screen.getByText("Save"));

    expect(setConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: expect.objectContaining({
          shared: expect.objectContaining({
            context_length: 64000,
            max_output_tokens: 2048,
            max_tool_rounds: 6,
            max_retries: 4,
          }),
        }),
        context_providers: expect.objectContaining({
          skills: expect.objectContaining({
            local: {
              enabled: false,
            },
            system: {
              disabled: [],
            },
          }),
          tools: {
            disabled: [],
          },
        }),
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

  it("saves role-specific runtime overrides alongside shared runtime defaults", () => {
    render(<SettingsPage />);

    openTab("Runtime");
    fireEvent.change(screen.getByLabelText("Conversation Overrides Max Output Tokens"), {
      target: { value: "1024" },
    });
    fireEvent.change(screen.getByLabelText("Background Overrides Max Tool Rounds"), {
      target: { value: "8" },
    });
    fireEvent.change(screen.getByLabelText("Compaction Overrides Context Length"), {
      target: { value: "32000" },
    });
    fireEvent.click(screen.getByText("Save"));

    expect(setConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: expect.objectContaining({
          shared: expect.objectContaining({
            context_length: 64000,
            max_output_tokens: 4000,
            max_tool_rounds: 20,
            max_retries: 3,
          }),
          conversation: {
            max_output_tokens: 1024,
          },
          background: {
            max_tool_rounds: 8,
          },
          compaction: {
            context_length: 32000,
          },
        }),
      })
    );
  });

  it("saves base font size into appearance config", () => {
    render(<SettingsPage />);

    openTab("UI");
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

    openModelEditor("Change Primary Model");
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

  it("saves a custom model id from the settings form", () => {
    render(<SettingsPage />);

    openModelEditor("Change Primary Model");
    fireEvent.change(screen.getAllByLabelText("Custom model ID")[0], {
      target: { value: "gpt-4.1-nano-preview" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Use model" })[0]);
    fireEvent.click(screen.getByText("Save"));

    expect(setConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        model: "gpt-4.1-nano-preview",
        profiles: expect.objectContaining({
          primary: expect.objectContaining({
            provider: "openai",
            model: "gpt-4.1-nano-preview",
          }),
        }),
      })
    );
    expect(sendConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4.1-nano-preview",
      })
    );
  });

  it("remembers api key and base url per provider when switching providers", () => {
    render(<SettingsPage />);

    openModelEditor("Change Primary Model");
    selectOption("Primary Model Provider", "Kimi (Moonshot)");
    selectOption("Primary Model Model", "kimi-k2.5");
    fireEvent.change(screen.getAllByPlaceholderText("Enter your API key")[0], {
      target: { value: "kimi-key" },
    });
    fireEvent.change(screen.getAllByPlaceholderText("Custom API endpoint")[0], {
      target: { value: "https://api.moonshot.cn/v1" },
    });

    selectOption("Primary Model Provider", "DeepSeek");

    expect((screen.getAllByPlaceholderText("Enter your API key")[0] as HTMLInputElement).value).toBe("");
    expect((screen.getAllByPlaceholderText("Custom API endpoint")[0] as HTMLInputElement).value).toBe("");

    selectOption("Primary Model Provider", "Kimi (Moonshot)");

    expect(screen.getByLabelText("Primary Model Model").textContent).toContain("kimi-k2.5");
    expect((screen.getAllByPlaceholderText("Enter your API key")[0] as HTMLInputElement).value).toBe("kimi-key");
    expect((screen.getAllByPlaceholderText("Custom API endpoint")[0] as HTMLInputElement).value).toBe("https://api.moonshot.cn/v1");
  });
});
