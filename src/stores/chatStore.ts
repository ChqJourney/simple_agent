import { create } from 'zustand';
import { AssistantStatus, Message, TokenUsage, ToolCall } from '../types';

interface SessionState {
  messages: Message[];
  currentStreamingContent: string;
  currentReasoningContent: string;
  isStreaming: boolean;
  assistantStatus: AssistantStatus;
  currentToolName?: string;
}

interface ChatState {
  sessions: Record<string, SessionState>;
  addToken: (sessionId: string, token: string) => void;
  addReasoningToken: (sessionId: string, token: string) => void;
  setReasoningComplete: (sessionId: string) => void;
  setToolCall: (sessionId: string, toolCall: ToolCall) => void;
  setToolResult: (sessionId: string, toolCallId: string, success: boolean, output: unknown) => void;
  setCompleted: (sessionId: string, usage?: TokenUsage) => void;
  setError: (sessionId: string, error: string, details?: string) => void;
  addUserMessage: (sessionId: string, content: string) => void;
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

  setToolResult: (sessionId, toolCallId, _success, output) => set((state) => {
    const session = state.sessions[sessionId];
    if (!session) return state;

    const newMessages = [...session.messages];
    newMessages.push({
      id: crypto.randomUUID(),
      role: 'tool',
      content: typeof output === 'string' ? output : JSON.stringify(output),
      tool_call_id: toolCallId,
      status: 'completed',
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

  setCompleted: (sessionId, usage) => set((state) => {
    const session = state.sessions[sessionId];
    if (!session) return state;

    const newMessages = [...session.messages];
    
    if (session.currentStreamingContent) {
      const existingAssistantIndex = newMessages.findIndex(
        m => m.role === 'assistant' && m.status === 'streaming'
      );
      
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
        },
      },
    };
  }),

  setError: (sessionId, error, details) => set((state) => {
    const session = state.sessions[sessionId];
    if (!session) return state;

    const newMessages = [...session.messages];
    newMessages.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: `Error: ${error}${details ? `\n${details}` : ''}`,
      status: 'error',
    });

    return {
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...session,
          messages: newMessages,
          currentStreamingContent: '',
          currentReasoningContent: '',
          isStreaming: false,
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
      },
    },
  })),
}));