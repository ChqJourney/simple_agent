import { create } from 'zustand';
import { AssistantStatus, Attachment, Message, PendingQuestion, RunEventRecord, TokenUsage, ToolCall, ToolDecision, ToolDecisionScope } from '../types';
import {
  createToolDecisionSummary,
  createToolResultSummary,
  renderToolResultDetails,
} from '../utils/toolMessages';

interface SessionState {
  messages: Message[];
  runEvents: RunEventRecord[];
  currentStreamingContent: string;
  currentReasoningContent: string;
  isStreaming: boolean;
  assistantStatus: AssistantStatus;
  currentToolName?: string;
  pendingToolConfirm?: ToolCall;
  pendingQuestion?: PendingQuestion;
}

interface ChatState {
  sessions: Record<string, SessionState>;
  addRunEvent: (sessionId: string, event: RunEventRecord) => void;
  addToken: (sessionId: string, token: string) => void;
  addReasoningToken: (sessionId: string, token: string) => void;
  setReasoningComplete: (sessionId: string) => void;
  setToolCall: (sessionId: string, toolCall: ToolCall) => void;
  setPendingToolConfirm: (sessionId: string, toolCall: ToolCall) => void;
  clearPendingToolConfirm: (sessionId: string, toolCallId?: string) => void;
  setPendingQuestion: (sessionId: string, question: PendingQuestion) => void;
  markPendingQuestionSubmitting: (sessionId: string, toolCallId?: string) => void;
  markPendingQuestionIdle: (sessionId: string, toolCallId?: string) => void;
  clearPendingQuestion: (sessionId: string, toolCallId?: string) => void;
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
  setInterrupted: (sessionId: string) => void;
  setError: (sessionId: string, error: string, details?: string) => void;
  addUserMessage: (sessionId: string, content: string, attachments?: Attachment[]) => void;
  markUserMessageSent: (sessionId: string) => void;
  startStreaming: (sessionId: string) => void;
  clearSession: (sessionId: string) => void;
  loadSession: (sessionId: string, messages: Message[]) => void;
}

const createEmptySession = (): SessionState => ({
  messages: [],
  runEvents: [],
  currentStreamingContent: '',
  currentReasoningContent: '',
  isStreaming: false,
  assistantStatus: 'idle',
  currentToolName: undefined,
  pendingToolConfirm: undefined,
  pendingQuestion: undefined,
});

export const useChatStore = create<ChatState>((set) => ({
  sessions: {},

  addRunEvent: (sessionId, event) => set((state) => {
    const session = state.sessions[sessionId] || createEmptySession();
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          runEvents: [...session.runEvents, event],
        },
      },
    };
  }),

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

  setPendingQuestion: (sessionId, question) => set((state) => {
    const session = state.sessions[sessionId] || createEmptySession();
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          pendingQuestion: {
            ...question,
            status: question.status || 'idle',
          },
        },
      },
    };
  }),

  markPendingQuestionSubmitting: (sessionId, toolCallId) => set((state) => {
    const session = state.sessions[sessionId];
    if (!session?.pendingQuestion) return state;

    if (toolCallId && session.pendingQuestion.tool_call_id !== toolCallId) {
      return state;
    }

    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          pendingQuestion: {
            ...session.pendingQuestion,
            status: 'submitting',
          },
        },
      },
    };
  }),

  markPendingQuestionIdle: (sessionId, toolCallId) => set((state) => {
    const session = state.sessions[sessionId];
    if (!session?.pendingQuestion) return state;

    if (toolCallId && session.pendingQuestion.tool_call_id !== toolCallId) {
      return state;
    }

    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          pendingQuestion: {
            ...session.pendingQuestion,
            status: 'idle',
          },
        },
      },
    };
  }),

  clearPendingQuestion: (sessionId, toolCallId) => set((state) => {
    const session = state.sessions[sessionId];
    if (!session?.pendingQuestion) return state;

    if (toolCallId && session.pendingQuestion.tool_call_id !== toolCallId) {
      return state;
    }

    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          pendingQuestion: undefined,
        },
      },
    };
  }),

  addToolDecision: (sessionId, toolCallId, toolName, decision, scope, reason) => set((state) => {
    const session = state.sessions[sessionId] || createEmptySession();
    const decisionText = createToolDecisionSummary(toolName, decision);

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
              name: toolName,
              content: decisionText,
              toolMessage: {
                kind: 'decision',
                toolName,
                decision,
                scope,
                reason,
              },
              status: decision === 'reject' ? 'error' : 'completed',
            },
          ],
        },
      },
    };
  }),

  setToolResult: (sessionId, toolCallId, success, output, error, toolName) => set((state) => {
    const session = state.sessions[sessionId];
    if (!session) return state;

    const resolvedToolName = toolName || 'tool';
    const renderedOutput = renderToolResultDetails(success, output, error);

    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          pendingToolConfirm:
            session.pendingToolConfirm?.tool_call_id === toolCallId
              ? undefined
              : session.pendingToolConfirm,
          pendingQuestion:
            session.pendingQuestion?.tool_call_id === toolCallId
              ? undefined
              : session.pendingQuestion,
          messages: [
            ...session.messages,
            {
              id: crypto.randomUUID(),
              role: 'tool',
              content: createToolResultSummary(resolvedToolName, success),
              tool_call_id: toolCallId,
              name: resolvedToolName,
              toolMessage: {
                kind: 'result',
                toolName: resolvedToolName,
                success,
                details: renderedOutput,
              },
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
          pendingQuestion: undefined,
        },
      },
    };
  }),

  setInterrupted: (sessionId) => set((state) => {
    const session = state.sessions[sessionId];
    if (!session) return state;

    const newMessages = [...session.messages];

    if (session.currentStreamingContent) {
      const reversedIndex = [...newMessages].reverse().findIndex(
        (message) =>
          message.role === 'assistant' &&
          message.status === 'streaming' &&
          (!message.tool_calls || message.tool_calls.length === 0)
      );
      const existingAssistantIndex = reversedIndex >= 0
        ? newMessages.length - 1 - reversedIndex
        : -1;

      if (existingAssistantIndex >= 0) {
        newMessages[existingAssistantIndex] = {
          ...newMessages[existingAssistantIndex],
          content: session.currentStreamingContent,
          status: 'completed',
        };
      } else {
        newMessages.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: session.currentStreamingContent,
          status: 'completed',
        });
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
          assistantStatus: 'idle',
          currentToolName: undefined,
          pendingToolConfirm: undefined,
          pendingQuestion: undefined,
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
          pendingQuestion: undefined,
        },
      },
    };
  }),

  addUserMessage: (sessionId, content, attachments) => set((state) => {
    const session = state.sessions[sessionId] || createEmptySession();
    const newMessages = [...session.messages];
    newMessages.push({
      id: crypto.randomUUID(),
      role: 'user',
      content,
      attachments,
      status: 'completed',
      userStatus: 'sending',
    });

    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          messages: newMessages,
          pendingQuestion: undefined,
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
          pendingQuestion: undefined,
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
        ...(state.sessions[sessionId] || createEmptySession()),
        messages,
        runEvents: state.sessions[sessionId]?.runEvents || [],
        currentStreamingContent: '',
        currentReasoningContent: '',
        isStreaming: false,
        assistantStatus: 'idle',
        currentToolName: undefined,
        pendingToolConfirm: undefined,
        pendingQuestion: undefined,
      },
    },
  })),
}));
