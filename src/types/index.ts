export type MessageRole = 'user' | 'assistant' | 'tool' | 'reasoning';

export type MessageStatus = 'streaming' | 'completed' | 'error';

export type UserMessageStatus = 'sending' | 'sent';

export type AssistantStatus = 'idle' | 'waiting' | 'thinking' | 'streaming' | 'tool_calling' | 'completed';

export type ToolDecision = 'approve_once' | 'approve_always' | 'reject';
export type ToolDecisionScope = 'session' | 'workspace';

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

export interface ToolDecisionMessageMeta {
  kind: 'decision';
  toolName: string;
  decision: ToolDecision;
  scope: ToolDecisionScope;
  reason?: string;
}

export interface ToolResultMessageMeta {
  kind: 'result';
  toolName: string;
  success: boolean;
  details: string;
}

export type ToolMessageMeta = ToolDecisionMessageMeta | ToolResultMessageMeta;

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
  profile_name?: string;
  model_label?: string;
  toolMessage?: ToolMessageMeta;
  status: MessageStatus;
  userStatus?: UserMessageStatus;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens?: number;
  total_tokens: number;
}

export type ProviderType = 'openai' | 'qwen' | 'ollama';
export type InputType = 'text' | 'image';

export interface ProviderConfig {
  provider: ProviderType;
  model: string;
  api_key: string;
  base_url: string;
  enable_reasoning: boolean;
  input_type?: InputType;
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
  workspace_path?: string;
}

export interface ClientConfig {
  type: 'config';
  provider: ProviderType;
  model: string;
  api_key: string;
  base_url: string;
  enable_reasoning: boolean;
  input_type?: InputType;
}

export interface ClientToolConfirm {
  type: 'tool_confirm';
  tool_call_id: string;
  approved?: boolean;
  decision?: ToolDecision;
  scope?: ToolDecisionScope;
}

export interface ClientInterrupt {
  type: 'interrupt';
  session_id: string;
}

export interface ClientSetWorkspace {
  type: 'set_workspace';
  workspace_path: string;
}

export type ClientWebSocketMessage = ClientMessage | ClientConfig | ClientToolConfirm | ClientInterrupt | ClientSetWorkspace;

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

export interface ServerToolDecision {
  type: 'tool_decision';
  session_id: string;
  tool_call_id: string;
  name: string;
  decision: ToolDecision;
  scope: ToolDecisionScope;
  reason?: string;
}

export interface ServerToolResult {
  type: 'tool_result';
  session_id: string;
  tool_call_id: string;
  tool_name?: string;
  success: boolean;
  output: unknown;
  error?: string;
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
  session_id?: string;
  error: string;
  details?: string;
}

export interface ServerCompleted {
  type: 'completed';
  session_id: string;
  usage?: TokenUsage;
}

export interface ServerMaxRoundsReached {
  type: 'max_rounds_reached';
  session_id: string;
  error?: string;
}

export interface ServerStarted {
  type: 'started';
  session_id: string;
}

export interface ServerInterrupted {
  type: 'interrupted';
  session_id: string;
}

export interface ServerConfigUpdated {
  type: 'config_updated';
  provider: string;
  model: string;
}

export interface ServerWorkspaceUpdated {
  type: 'workspace_updated';
  workspace_path: string;
}

export type ServerWebSocketMessage =
  | ServerToken
  | ServerReasoningToken
  | ServerReasoningComplete
  | ServerToolCall
  | ServerToolConfirmRequest
  | ServerToolDecision
  | ServerToolResult
  | ServerRetry
  | ServerError
  | ServerCompleted
  | ServerMaxRoundsReached
  | ServerStarted
  | ServerInterrupted
  | ServerConfigUpdated
  | ServerWorkspaceUpdated;

export type WebSocketMessage = ClientWebSocketMessage | ServerWebSocketMessage;

