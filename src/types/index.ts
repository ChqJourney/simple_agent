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

export interface Attachment {
  kind: 'image';
  path: string;
  name: string;
  mime_type?: string;
  data_url?: string;
}

export interface PendingQuestion {
  tool_call_id: string;
  tool_name: string;
  question: string;
  details?: string;
  options: string[];
  status: 'idle' | 'submitting';
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
  attachments?: Attachment[];
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
  context_length?: number;
}

export interface RunEventRecord {
  event_type: string;
  session_id: string;
  run_id: string;
  step_index?: number;
  payload: Record<string, unknown>;
  timestamp: string;
}

export type ProviderType = 'openai' | 'deepseek' | 'qwen' | 'ollama';
export type InputType = 'text' | 'image';

export interface ModelProfile {
  provider: ProviderType;
  model: string;
  api_key: string;
  base_url: string;
  enable_reasoning: boolean;
  input_type?: InputType;
  profile_name?: string;
}

export interface RuntimePolicy {
  context_length?: number;
  max_output_tokens?: number;
  max_tool_rounds?: number;
  max_retries?: number;
}

export interface LocalSkillContextProviderConfig {
  enabled: boolean;
}

export interface WorkspaceRetrievalContextProviderConfig {
  enabled: boolean;
  max_hits?: number;
  extensions?: string[];
}

export interface ContextProviderConfig {
  skills?: {
    local?: LocalSkillContextProviderConfig;
  };
  retrieval?: {
    workspace?: WorkspaceRetrievalContextProviderConfig;
  };
}

export interface ProviderConfig extends ModelProfile {
  profiles?: {
    primary: ModelProfile;
    secondary?: ModelProfile;
  };
  runtime?: RuntimePolicy;
  context_providers?: ContextProviderConfig;
}

export interface LockedModelRef {
  profile_name: string;
  provider: string;
  model: string;
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
  title?: string;
  locked_model?: LockedModelRef;
}

export interface ClientMessage {
  type: 'message';
  session_id: string;
  content: string;
  attachments?: Attachment[];
  workspace_path?: string;
}

export interface ClientConfig {
  type: 'config';
  auth_token?: string;
  provider: ProviderType;
  model: string;
  api_key: string;
  base_url: string;
  enable_reasoning: boolean;
  input_type?: InputType;
  profiles?: ProviderConfig['profiles'];
  runtime?: RuntimePolicy;
  context_providers?: ContextProviderConfig;
}

export interface ClientToolConfirm {
  type: 'tool_confirm';
  tool_call_id: string;
  approved?: boolean;
  decision?: ToolDecision;
  scope?: ToolDecisionScope;
}

export interface ClientQuestionResponse {
  type: 'question_response';
  tool_call_id: string;
  answer?: string;
  action: 'submit' | 'dismiss';
}

export interface ClientInterrupt {
  type: 'interrupt';
  session_id: string;
}

export interface ClientSetWorkspace {
  type: 'set_workspace';
  workspace_path: string;
}

export type ClientWebSocketMessage =
  | ClientMessage
  | ClientConfig
  | ClientToolConfirm
  | ClientQuestionResponse
  | ClientInterrupt
  | ClientSetWorkspace;

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

export interface ServerQuestionRequest {
  type: 'question_request';
  session_id: string;
  tool_call_id: string;
  tool_name?: string;
  question: string;
  details?: string;
  options: string[];
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

export interface ServerSessionTitleUpdated {
  type: 'session_title_updated';
  session_id: string;
  title: string;
}

export interface ServerSessionLockUpdated {
  type: 'session_lock_updated';
  session_id: string;
  locked_model: LockedModelRef;
}

export interface ServerRunEvent {
  type: 'run_event';
  session_id: string;
  event: RunEventRecord;
}

export type ServerWebSocketMessage =
  | ServerToken
  | ServerReasoningToken
  | ServerReasoningComplete
  | ServerToolCall
  | ServerToolConfirmRequest
  | ServerToolDecision
  | ServerToolResult
  | ServerQuestionRequest
  | ServerRetry
  | ServerError
  | ServerCompleted
  | ServerMaxRoundsReached
  | ServerStarted
  | ServerInterrupted
  | ServerConfigUpdated
  | ServerWorkspaceUpdated
  | ServerSessionTitleUpdated
  | ServerSessionLockUpdated
  | ServerRunEvent;

export type WebSocketMessage = ClientWebSocketMessage | ServerWebSocketMessage;

