export type MessageRole = 'user' | 'assistant' | 'tool' | 'reasoning';

export type MessageStatus = 'streaming' | 'completed' | 'error';

export interface ToolCall {
  tool_call_id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  tool_call_id: string;
  tool_name: string;
  success: boolean;
  output: unknown;
  error: string | null;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string | null;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
  tool_results?: ToolResult[];
  tool_call_id?: string;
  name?: string;
  usage?: TokenUsage;
  status: MessageStatus;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens?: number;
  total_tokens: number;
}

export type ProviderType = 'openai' | 'qwen' | 'ollama';

export interface ProviderConfig {
  provider: ProviderType;
  model: string;
  api_key: string;
  base_url: string;
  enable_reasoning: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  created_at?: string;
  updated_at?: string;
}

export interface Session {
  session_id: string;
  workspace_path: string;
  messages: Message[];
  created_at?: string;
  updated_at?: string;
}

export interface ClientMessage {
  type: 'message';
  session_id: string;
  content: string;
}

export interface ClientConfig {
  type: 'config';
  provider: ProviderType;
  model: string;
  api_key: string;
  base_url: string;
  enable_reasoning: boolean;
}

export interface ClientToolConfirm {
  type: 'tool_confirm';
  tool_call_id: string;
  approved: boolean;
}

export interface ClientInterrupt {
  type: 'interrupt';
  session_id: string;
}

export type ClientWebSocketMessage = ClientMessage | ClientConfig | ClientToolConfirm | ClientInterrupt;

export interface ServerToken {
  type: 'token';
  session_id: string;
  content: string;
}

export interface ServerReasoningToken {
  type: 'reasoning_token';
  session_id: string;
  content: string;
}

export interface ServerReasoningComplete {
  type: 'reasoning_complete';
  session_id: string;
}

export interface ServerToolCall {
  type: 'tool_call';
  session_id: string;
  tool_call_id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ServerToolConfirmRequest {
  type: 'tool_confirm_request';
  session_id: string;
  tool_call_id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ServerToolResult {
  type: 'tool_result';
  session_id: string;
  tool_call_id: string;
  success: boolean;
  output: unknown;
}

export interface ServerRetry {
  type: 'retry';
  session_id: string;
  attempt: number;
  max_retries: number;
  error: string;
}

export interface ServerError {
  type: 'error';
  session_id: string;
  error: string;
  details?: string;
}

export interface ServerCompleted {
  type: 'completed';
  session_id: string;
  usage?: TokenUsage;
}

export interface ServerStarted {
  type: 'started';
  session_id: string;
}

export interface ServerInterrupted {
  type: 'interrupted';
  session_id: string;
}

export type ServerWebSocketMessage =
  | ServerToken
  | ServerReasoningToken
  | ServerReasoningComplete
  | ServerToolCall
  | ServerToolConfirmRequest
  | ServerToolResult
  | ServerRetry
  | ServerError
  | ServerCompleted
  | ServerStarted
  | ServerInterrupted;

export type WebSocketMessage = ClientWebSocketMessage | ServerWebSocketMessage;