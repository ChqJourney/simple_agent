import { create } from 'zustand';
import { AssistantStatus, Message, TokenUsage, ToolCall, ToolDecision, ToolDecisionScope } from '../types';

interface SessionState {
  messages: Message[];
  currentStreamingContent: string;
  currentReasoningContent: string;
  isStreaming: boolean;
  assistantStatus: AssistantStatus;
  currentToolName?: string;
  pendingToolConfirm?: ToolCall;
}

interface ChatState {
  sessions: Record<string, SessionState>;
  addToken: (sessionId: string, token: string) => void;
  addReasoningToken: (sessionId: string, token: string) => void;
  setReasoningComplete: (sessionId: string) => void;
  setToolCall: (sessionId: string, toolCall: ToolCall) => void;
  setPendingToolConfirm: (sessionId: string, toolCall: ToolCall) => void;
  clearPendingToolConfirm: (sessionId: string, toolCallId?: string) => void;
  addToolDecision: (
    sessionId: string,
    toolCallId: string,
    toolName: string,
    decision: ToolDecision,
    scope: ToolDecisionScope,
    reason?: string
  ) => void;
  setToolResult: (
    sessionId: string,
    toolCallId: string,
    success: boolean,
    output: unknown,
    error?: string,
    toolName?: string
  ) => void;
  setCompleted: (sessionId: string, usage?: TokenUsage) => void;
  setError: (sessionId: string, error: string, details?: string) => void;
  addUserMessage: (sessionId: string, content: string) => void;
  markUserMessageSent: (sessionId: string) => void;
  startStreaming: (sessionId: string) => void;
  clearSession: (sessionId: string) => void;
  loadSession: (sessionId: string, messages: Message[]) => void;
}

const createEmptySession = (): SessionState => ({
  messages: [],
  currentStreamingContent: '',
  currentReasoningContent: '',
  isStreaming: false,
  assistantStatus: 'idle',
  currentToolName: undefined,
  pendingToolConfirm: undefined,
});

export const useChatStore = create<ChatState>((set) => ({
  sessions: {},

  addToken: (sessionId, token) => set((state) => {
    const session = state.sessions[sessionId] || createEmptySession();
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          isStreaming: true,
          assistantStatus: 'streaming',
          currentStreamingContent: session.currentStreamingContent + token,
        },
      },
    };
  }),

  addReasoningToken: (sessionId, token) => set((state) => {
    const session = state.sessions[sessionId] || createEmptySession();
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          isStreaming: true,
          assistantStatus: 'thinking',
          currentReasoningContent: session.currentReasoningContent + token,
        },
      },
    };
  }),

  setReasoningComplete: (sessionId) => set((state) => {
    const session = state.sessions[sessionId];
    if (!session) return state;

    const newMessages = [...session.messages];
    if (session.currentReasoningContent) {
      newMessages.push({
        id: crypto.randomUUID(),
        role: 'reasoning',
        content: session.currentReasoningContent,
        status: 'completed',
      });
    }

    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          messages: newMessages,
          currentReasoningContent: '',
        },
      },
    };
  }),

  setToolCall: (sessionId, toolCall) => set((state) => {
    const session = state.sessions[sessionId];
    if (!session) return state;

    const lastMessage = session.messages[session.messages.length - 1];
    let newMessages: Message[];

    if (lastMessage?.role === 'assistant' && lastMessage.status === 'streaming') {
      const updatedMessage: Message = {
        ...lastMessage,
        tool_calls: [...(lastMessage.tool_calls || []), toolCall],
      };
      newMessages = [...session.messages.slice(0, -1), updatedMessage];
    } else {
      newMessages = [
        ...session.messages,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: session.currentStreamingContent || null,
          tool_calls: [toolCall],
          status: 'streaming',
        },
      ];
    }

    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          messages: newMessages,
          currentStreamingContent: '',
          assistantStatus: 'tool_calling',
          currentToolName: toolCall.name,
        },
      },
    };
  }),

  setPendingToolConfirm: (sessionId, toolCall) => set((state) => {
    const session = state.sessions[sessionId] || createEmptySession();
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          pendingToolConfirm: toolCall,
        },
      },
    };
  }),

  clearPendingToolConfirm: (sessionId, toolCallId) => set((state) => {
    const session = state.sessions[sessionId];
    if (!session?.pendingToolConfirm) return state;

    if (toolCallId && session.pendingToolConfirm.tool_call_id !== toolCallId) {
      return state;
    }

    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          pendingToolConfirm: undefined,
        },
      },
    };
  }),

  addToolDecision: (sessionId, toolCallId, toolName, decision, scope, reason) => set((state) => {
    const session = state.sessions[sessionId] || createEmptySession();
    const decisionText =
      decision === 'approve_always'
        ? `Tool ${toolName} approved always (${scope})`
        : decision === 'approve_once'
          ? `Tool ${toolName} approved once`
          : `Tool ${toolName} rejected`;

    const details = reason && reason !== 'user_action' ? ` [${reason}]` : '';

    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          messages: [
            ...session.messages,
            {
              id: crypto.randomUUID(),
              role: 'tool',
              tool_call_id: toolCallId,
              name: 'tool_decision',
              content: `${decisionText}${details}`,
              status: 'completed',
            },
          ],
        },
      },
    };
  }),

  setToolResult: (sessionId, toolCallId, success, output, error, toolName) => set((state) => {
    const session = state.sessions[sessionId];
    if (!session) return state;

    const renderedOutput = (() => {
      if (success) {
        if (typeof output === 'string') return output;
        return JSON.stringify(output, null, 2);
      }
      if (error) return `Error: ${error}`;
      if (typeof output === 'string' && output) return `Error: ${output}`;
      return 'Error: Tool execution failed';
    })();

    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          pendingToolConfirm:
            session.pendingToolConfirm?.tool_call_id === toolCallId
              ? undefined
              : session.pendingToolConfirm,
          messages: [
            ...session.messages,
            {
              id: crypto.randomUUID(),
              role: 'tool',
              content: renderedOutput,
              tool_call_id: toolCallId,
              name: toolName,
              status: success ? 'completed' : 'error',
            },
          ],
        },
      },
    };
  }),

  setCompleted: (sessionId, usage) => set((state) => {
    const session = state.sessions[sessionId];
    if (!session) return state;

    const newMessages: Message[] = session.messages.map((message): Message => {
      if (
        message.role === 'assistant' &&
        message.status === 'streaming' &&
        message.tool_calls &&
        message.tool_calls.length > 0
      ) {
        return {
          ...message,
          status: 'completed',
        };
      }
      return message;
    });

    if (session.currentStreamingContent) {
      const reversedIndex = [...newMessages].reverse().findIndex(
        (m) =>
          m.role === 'assistant' &&
          m.status === 'streaming' &&
          (!m.tool_calls || m.tool_calls.length === 0)
      );
      const existingAssistantIndex = reversedIndex >= 0
        ? newMessages.length - 1 - reversedIndex
        : -1;

      if (existingAssistantIndex >= 0) {
        newMessages[existingAssistantIndex] = {
          ...newMessages[existingAssistantIndex],
          content: session.currentStreamingContent,
          status: 'completed',
          usage,
        };
      } else {
        newMessages.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: session.currentStreamingContent,
          status: 'completed',
          usage,
        });
      }
    } else {
      const lastAssistant = [...newMessages].reverse().find((m: Message) => m.role === 'assistant');
      if (lastAssistant) {
        const index = newMessages.indexOf(lastAssistant);
        newMessages[index] = {
          ...lastAssistant,
          status: 'completed',
          usage,
        };
      }
    }

    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          messages: newMessages,
          currentStreamingContent: '',
          currentReasoningContent: '',
          isStreaming: false,
          assistantStatus: 'completed',
          currentToolName: undefined,
          pendingToolConfirm: undefined,
        },
      },
    };
  }),

  setError: (sessionId, error, details) => set((state) => {
    const session = state.sessions[sessionId] || createEmptySession();

    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          messages: [
            ...session.messages,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: `Error: ${error}${details ? `\n${details}` : ''}`,
              status: 'error',
            },
          ],
          currentStreamingContent: '',
          currentReasoningContent: '',
          isStreaming: false,
          assistantStatus: 'idle',
          currentToolName: undefined,
          pendingToolConfirm: undefined,
        },
      },
    };
  }),

  addUserMessage: (sessionId, content) => set((state) => {
    const session = state.sessions[sessionId] || createEmptySession();
    const newMessages = [...session.messages];
    newMessages.push({
      id: crypto.randomUUID(),
      role: 'user',
      content,
      status: 'completed',
      userStatus: 'sending',
    });

    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          messages: newMessages,
        },
      },
    };
  }),

  markUserMessageSent: (sessionId) => set((state) => {
    const session = state.sessions[sessionId];
    if (!session) return state;

    const reversedIndex = [...session.messages]
      .reverse()
      .findIndex((message) => message.role === 'user' && message.userStatus === 'sending');

    if (reversedIndex === -1) {
      return state;
    }

    const messageIndex = session.messages.length - 1 - reversedIndex;
    const newMessages = [...session.messages];
    const targetMessage = newMessages[messageIndex];

    newMessages[messageIndex] = {
      ...targetMessage,
      userStatus: 'sent',
    };

    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          messages: newMessages,
        },
      },
    };
  }),

  startStreaming: (sessionId) => set((state) => {
    const session = state.sessions[sessionId] || createEmptySession();
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          isStreaming: true,
          currentStreamingContent: '',
          currentReasoningContent: '',
          assistantStatus: 'waiting',
          currentToolName: undefined,
        },
      },
    };
  }),

  clearSession: (sessionId) => set((state) => {
    const { [sessionId]: _, ...rest } = state.sessions;
    return { sessions: rest };
  }),

  loadSession: (sessionId, messages) => set((state) => ({
    sessions: {
      ...state.sessions,
      [sessionId]: {
        messages,
        currentStreamingContent: '',
        currentReasoningContent: '',
        isStreaming: false,
        assistantStatus: 'idle',
        currentToolName: undefined,
        pendingToolConfirm: undefined,
      },
    },
  })),
}));


