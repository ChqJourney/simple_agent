import { create } from 'zustand';
import { AssistantStatus, Attachment, Message, PendingQuestion, TokenUsage, ToolCall, ToolDecision, ToolDecisionScope } from '../types';
import {
  createToolDecisionSummary,
  createToolResultSummary,
  renderToolResultDetails,
} from '../utils/toolMessages';

interface SessionState {
  messages: Message[];
  latestUsage?: TokenUsage;
  latestUsageUpdatedAt?: string;
  latestContextEstimate?: TokenUsage;
  latestContextEstimateUpdatedAt?: string;
  currentStreamingContent: string;
  currentReasoningContent: string;
  isStreaming: boolean;
  assistantStatus: AssistantStatus;
  currentToolName?: string;
  currentToolArgumentCharacters?: number;
  pendingToolConfirm?: ToolCall;
  queuedToolConfirms?: ToolCall[];
  pendingQuestion?: PendingQuestion;
  queuedQuestions?: PendingQuestion[];
}

interface ChatState {
  sessions: Record<string, SessionState>;
  addToken: (sessionId: string, token: string) => void;
  addReasoningToken: (sessionId: string, token: string) => void;
  markStreamWaiting: (sessionId: string) => void;
  setReasoningComplete: (sessionId: string) => void;
  setToolCallProgress: (sessionId: string, toolName: string, argumentCharacters: number) => void;
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
  setContextEstimate: (sessionId: string, usage: TokenUsage, updatedAt?: string) => void;
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
  latestUsage: undefined,
  latestUsageUpdatedAt: undefined,
  latestContextEstimate: undefined,
  latestContextEstimateUpdatedAt: undefined,
  currentStreamingContent: '',
  currentReasoningContent: '',
  isStreaming: false,
  assistantStatus: 'idle',
  currentToolName: undefined,
  currentToolArgumentCharacters: undefined,
  pendingToolConfirm: undefined,
  queuedToolConfirms: [],
  pendingQuestion: undefined,
  queuedQuestions: [],
});

function nowIso(): string {
  return new Date().toISOString();
}

function getQueuedToolConfirms(session: SessionState): ToolCall[] {
  return session.queuedToolConfirms ? [...session.queuedToolConfirms] : [];
}

function queuePendingToolConfirm(session: SessionState, toolCall: ToolCall): Pick<SessionState, 'pendingToolConfirm' | 'queuedToolConfirms'> {
  const queuedToolConfirms = getQueuedToolConfirms(session);
  if (session.pendingToolConfirm?.tool_call_id === toolCall.tool_call_id) {
    return {
      pendingToolConfirm: session.pendingToolConfirm,
      queuedToolConfirms,
    };
  }

  if (queuedToolConfirms.some((pending) => pending.tool_call_id === toolCall.tool_call_id)) {
    return {
      pendingToolConfirm: session.pendingToolConfirm,
      queuedToolConfirms,
    };
  }

  if (!session.pendingToolConfirm) {
    return {
      pendingToolConfirm: toolCall,
      queuedToolConfirms,
    };
  }

  return {
    pendingToolConfirm: session.pendingToolConfirm,
    queuedToolConfirms: [...queuedToolConfirms, toolCall],
  };
}

function removePendingToolConfirm(session: SessionState, toolCallId?: string): Pick<SessionState, 'pendingToolConfirm' | 'queuedToolConfirms'> {
  const queuedToolConfirms = getQueuedToolConfirms(session);
  if (!toolCallId) {
    return {
      pendingToolConfirm: undefined,
      queuedToolConfirms: [],
    };
  }

  if (session.pendingToolConfirm?.tool_call_id === toolCallId) {
    const [nextPendingToolConfirm, ...remainingToolConfirms] = queuedToolConfirms;
    return {
      pendingToolConfirm: nextPendingToolConfirm,
      queuedToolConfirms: remainingToolConfirms,
    };
  }

  return {
    pendingToolConfirm: session.pendingToolConfirm,
    queuedToolConfirms: queuedToolConfirms.filter((pending) => pending.tool_call_id !== toolCallId),
  };
}

function getQueuedQuestions(session: SessionState): PendingQuestion[] {
  return session.queuedQuestions ? [...session.queuedQuestions] : [];
}

function queuePendingQuestion(
  session: SessionState,
  question: PendingQuestion,
): Pick<SessionState, 'pendingQuestion' | 'queuedQuestions'> {
  const normalizedQuestion: PendingQuestion = {
    ...question,
    status: question.status || 'idle',
  };
  const queuedQuestions = getQueuedQuestions(session);
  if (session.pendingQuestion?.tool_call_id === normalizedQuestion.tool_call_id) {
    return {
      pendingQuestion: session.pendingQuestion,
      queuedQuestions,
    };
  }

  if (queuedQuestions.some((pending) => pending.tool_call_id === normalizedQuestion.tool_call_id)) {
    return {
      pendingQuestion: session.pendingQuestion,
      queuedQuestions,
    };
  }

  if (!session.pendingQuestion) {
    return {
      pendingQuestion: normalizedQuestion,
      queuedQuestions,
    };
  }

  return {
    pendingQuestion: session.pendingQuestion,
    queuedQuestions: [...queuedQuestions, normalizedQuestion],
  };
}

function removePendingQuestion(
  session: SessionState,
  toolCallId?: string,
): Pick<SessionState, 'pendingQuestion' | 'queuedQuestions'> {
  const queuedQuestions = getQueuedQuestions(session);
  if (!toolCallId) {
    return {
      pendingQuestion: undefined,
      queuedQuestions: [],
    };
  }

  if (session.pendingQuestion?.tool_call_id === toolCallId) {
    const [nextPendingQuestion, ...remainingQuestions] = queuedQuestions;
    return {
      pendingQuestion: nextPendingQuestion,
      queuedQuestions: remainingQuestions,
    };
  }

  return {
    pendingQuestion: session.pendingQuestion,
    queuedQuestions: queuedQuestions.filter((pending) => pending.tool_call_id !== toolCallId),
  };
}

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
          currentToolName: undefined,
          currentToolArgumentCharacters: undefined,
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
          currentToolName: undefined,
          currentToolArgumentCharacters: undefined,
        },
      },
    };
  }),

  markStreamWaiting: (sessionId) => set((state) => {
    const session = state.sessions[sessionId] || createEmptySession();
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          isStreaming: true,
          assistantStatus: 'waiting',
          currentToolName: undefined,
          currentToolArgumentCharacters: undefined,
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
        timestamp: nowIso(),
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

  setToolCallProgress: (sessionId, toolName, argumentCharacters) => set((state) => {
    const session = state.sessions[sessionId] || createEmptySession();
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          isStreaming: true,
          assistantStatus: 'preparing_tool',
          currentToolName: toolName,
          currentToolArgumentCharacters: argumentCharacters,
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
          timestamp: nowIso(),
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
          currentToolArgumentCharacters: undefined,
        },
      },
    };
  }),

  setPendingToolConfirm: (sessionId, toolCall) => set((state) => {
    const session = state.sessions[sessionId] || createEmptySession();
    const pendingToolConfirmState = queuePendingToolConfirm(session, toolCall);
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          ...pendingToolConfirmState,
        },
      },
    };
  }),

  clearPendingToolConfirm: (sessionId, toolCallId) => set((state) => {
    const session = state.sessions[sessionId];
    if (!session?.pendingToolConfirm && !session?.queuedToolConfirms?.length) {
      return state;
    }

    const pendingToolConfirmState = removePendingToolConfirm(session, toolCallId);

    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          ...pendingToolConfirmState,
        },
      },
    };
  }),

  setPendingQuestion: (sessionId, question) => set((state) => {
    const session = state.sessions[sessionId] || createEmptySession();
    const pendingQuestionState = queuePendingQuestion(session, question);
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          ...pendingQuestionState,
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
    if (!session?.pendingQuestion && !session?.queuedQuestions?.length) {
      return state;
    }

    const pendingQuestionState = removePendingQuestion(session, toolCallId);

    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          ...pendingQuestionState,
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
              timestamp: nowIso(),
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
    const pendingQuestionState = removePendingQuestion(session, toolCallId);

    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          ...removePendingToolConfirm(session, toolCallId),
          ...pendingQuestionState,
          messages: [
            ...session.messages,
            {
              id: crypto.randomUUID(),
              role: 'tool',
              content: createToolResultSummary(resolvedToolName, success),
              tool_call_id: toolCallId,
              name: resolvedToolName,
              timestamp: nowIso(),
              toolMessage: {
                kind: 'result',
                toolName: resolvedToolName,
                success,
                details: renderedOutput,
                output,
                error: error ?? null,
              },
              status: success ? 'completed' : 'error',
            },
          ],
        },
      },
    };
  }),

  setContextEstimate: (sessionId, usage, updatedAt) => set((state) => {
    const session = state.sessions[sessionId] || createEmptySession();

    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          latestContextEstimate: usage,
          latestContextEstimateUpdatedAt: updatedAt || new Date().toISOString(),
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
          timestamp: nowIso(),
          status: 'completed',
          usage,
        };
      } else {
        newMessages.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: session.currentStreamingContent,
          timestamp: nowIso(),
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
          timestamp: lastAssistant.timestamp || nowIso(),
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
          latestUsage: usage ?? session.latestUsage,
          latestUsageUpdatedAt: usage ? new Date().toISOString() : session.latestUsageUpdatedAt,
          currentStreamingContent: '',
          currentReasoningContent: '',
          isStreaming: false,
          assistantStatus: 'completed',
          currentToolName: undefined,
          currentToolArgumentCharacters: undefined,
          pendingToolConfirm: undefined,
          queuedToolConfirms: [],
          pendingQuestion: undefined,
          queuedQuestions: [],
        },
      },
    };
  }),

  setInterrupted: (sessionId) => set((state) => {
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

    if (session.currentReasoningContent) {
      newMessages.push({
        id: crypto.randomUUID(),
        role: 'reasoning',
        content: session.currentReasoningContent,
        timestamp: nowIso(),
        status: 'completed',
      });
    }

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
          timestamp: nowIso(),
          status: 'completed',
        };
      } else {
        newMessages.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: session.currentStreamingContent,
          timestamp: nowIso(),
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
          currentToolArgumentCharacters: undefined,
          pendingToolConfirm: undefined,
          queuedToolConfirms: [],
          pendingQuestion: undefined,
          queuedQuestions: [],
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
              timestamp: nowIso(),
              status: 'error',
            },
          ],
          currentStreamingContent: '',
          currentReasoningContent: '',
          isStreaming: false,
          assistantStatus: 'idle',
          currentToolName: undefined,
          currentToolArgumentCharacters: undefined,
          pendingToolConfirm: undefined,
          queuedToolConfirms: [],
          pendingQuestion: undefined,
          queuedQuestions: [],
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
      timestamp: nowIso(),
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
          queuedQuestions: [],
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
          currentToolArgumentCharacters: undefined,
          pendingQuestion: undefined,
          queuedQuestions: [],
          queuedToolConfirms: [],
        },
      },
    };
  }),

  clearSession: (sessionId) => set((state) => {
    const { [sessionId]: _, ...rest } = state.sessions;
    return { sessions: rest };
  }),

  loadSession: (sessionId, messages) => set((state) => {
    const latestUsage = [...messages].reverse().find((message) => message.role === 'assistant' && message.usage)?.usage;

    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...(state.sessions[sessionId] || createEmptySession()),
          messages,
          latestUsage,
          latestUsageUpdatedAt: latestUsage ? new Date().toISOString() : undefined,
          currentStreamingContent: '',
          currentReasoningContent: '',
          isStreaming: false,
          assistantStatus: 'idle',
          currentToolName: undefined,
          currentToolArgumentCharacters: undefined,
          pendingToolConfirm: undefined,
          queuedToolConfirms: [],
          pendingQuestion: undefined,
          queuedQuestions: [],
        },
      },
    };
  }),
}));
