# AI Agent 设计文档

## 概述

基于 Tauri + Python Sidecar + WebSocket 架构的 AI Agent 系统，采用 "LLM - User - Tools" 三角色模型，支持多 LLM Provider、流式输出、工具调用、Session 持久化等核心功能。

## 一、系统架构

### 1.1 整体架构

```
Frontend (React + TypeScript)
    ↓ WebSocket
Rust (Tauri)
    ↓ Sidecar Process
Python Backend (FastAPI + WebSocket)
    ↓
Agent Core (User - LLM - Tools)
```

### 1.2 技术栈

**前端：**
- React 19.1 + TypeScript 5.8
- Vite 7.0
- Zustand（状态管理）
- react-markdown + react-syntax-highlighter（Markdown 渲染）

**后端（Rust）：**
- Tauri 2.x
- tauri-plugin-shell（Sidecar 管理）

**后端（Python）：**
- FastAPI + uvicorn
- WebSocket（实时通信）
- PyInstaller（打包）

### 1.3 目录结构

```
tauri_agent/
├── src/                      # 前端代码
│   ├── components/
│   │   ├── Chat/
│   │   ├── Reasoning/
│   │   ├── Tools/
│   │   ├── Sidebar/
│   │   └── Settings/
│   ├── hooks/
│   ├── stores/
│   ├── services/
│   ├── utils/
│   └── types/
├── src-tauri/                # Rust 代码
│   └── src/
│       └── main.rs
└── python_backend/           # Python 后端
    ├── main.py
    ├── core/
    │   ├── agent.py
    │   └── user.py
    ├── llms/
    │   ├── base.py
    │   ├── openai.py
    │   ├── qwen.py
    │   └── ollama.py
    ├── tools/
    │   ├── base.py
    │   ├── file_read.py
    │   └── file_write.py
    └── requirements.txt
```

## 二、Python 端核心设计

### 2.1 LLM Provider 抽象

```python
# llms/base.py
from abc import ABC, abstractmethod
from typing import AsyncIterator, Dict, Any, List

class BaseLLM(ABC):
    def __init__(self, config: Dict[str, Any]):
        self.config = config
    
    @abstractmethod
    async def stream(self, messages: List[Dict], tools: List[Dict]) -> AsyncIterator[Dict]:
        """流式生成，返回 OpenAI 格式的 chunks"""
        pass
    
    @abstractmethod
    async def complete(self, messages: List[Dict], tools: List[Dict]) -> Dict:
        """非流式生成，返回完整响应"""
        pass
    
    def get_tool_schemas(self, registered_tools: Dict[str, Any]) -> List[Dict]:
        """将工具注册表转换为 OpenAI function calling 格式"""
        pass
```

**支持的 Provider：**
- OpenAILLM: GPT-4, GPT-4-turbo, o1-preview（支持 reasoning）
- QwenLLM: 通义千问系列（兼容 OpenAI SDK）
- OllamaLLM: 本地模型

### 2.2 Tools 系统

```python
# tools/base.py
from abc import ABC, abstractmethod
from typing import Dict, Any
from pydantic import BaseModel

class ToolResult(BaseModel):
    tool_call_id: str
    tool_name: str
    success: bool
    output: Any
    error: str | None = None

class BaseTool(ABC):
    name: str
    description: str
    parameters: Dict[str, Any]  # JSON Schema
    require_confirmation: bool = False
    
    @abstractmethod
    async def execute(self, **kwargs) -> ToolResult:
        pass

class ToolRegistry:
    def __init__(self):
        self.tools: Dict[str, BaseTool] = {}
    
    def register(self, tool: BaseTool):
        self.tools[tool.name] = tool
    
    def get_schemas(self) -> List[Dict]:
        """返回 OpenAI function calling 格式"""
        pass
```

**初始工具：**
- `FileReadTool`: 读取本地文件（不需要确认）
- `FileWriteTool`: 写入文件（需要确认）

### 2.3 User 角色与 Session 管理

```python
# core/user.py
from typing import List, Dict, Callable, Awaitable
from pydantic import BaseModel
import json

class Message(BaseModel):
    role: str  # "user", "assistant", "tool", "reasoning"
    content: str | None
    tool_calls: List[Dict] | None = None
    tool_call_id: str | None = None
    name: str | None = None
    reasoning_content: str | None = None

class Session:
    def __init__(self, session_id: str, workspace_path: str):
        self.session_id = session_id
        self.workspace_path = workspace_path
        self.messages: List[Message] = []
        self.file_path = self._get_file_path()
    
    def add_message(self, message: Message):
        self.messages.append(message)
        self._append_to_file(message)
    
    def _get_file_path(self) -> str:
        # .agent/sessions/{session_id}.jsonl
        pass
    
    def _append_to_file(self, message: Message):
        with open(self.file_path, 'a', encoding='utf-8') as f:
            f.write(json.dumps(message.model_dump()) + '\n')
    
    def load_history(self):
        # 从 JSONL 加载历史
        pass

class UserManager:
    def __init__(self):
        self.sessions: Dict[str, Session] = {}
        self.tool_confirmations: Dict[str, bool] = {}
        self.ws_callback: Callable[[Dict], Awaitable[None]] | None = None
    
    async def send_to_frontend(self, message: Dict):
        """通过 WebSocket 发送消息给前端"""
        if self.ws_callback:
            await self.ws_callback(message)
    
    async def request_tool_confirmation(self, tool_name: str, args: Dict) -> bool:
        """请求用户确认工具执行"""
        pass
```

**Session 存储结构：**
```
{workspace_path}/.agent/
  ├── sessions/
  │   ├── {session_id_1}.jsonl
  │   └── {session_id_2}.jsonl
  └── index.json  # session 元数据
```

**AppData 存储位置（跨平台）：**
- Windows: `%APPDATA%/tauri_agent/`
- macOS: `~/Library/Application Support/tauri_agent/`
- Linux: `~/.config/tauri_agent/`

AppData 只存储 workspaces 元数据，session 数据都在 workspace 目录下的 `.agent` 目录中。

### 2.4 Agent 核心调度器

```python
# core/agent.py
import asyncio
from typing import Dict, Any, List, Optional
from llms.base import BaseLLM
from tools.base import ToolRegistry, ToolResult
from core.user import UserManager, Session, Message

class Agent:
    def __init__(self, llm: BaseLLM, tool_registry: ToolRegistry, user_manager: UserManager):
        self.llm = llm
        self.tool_registry = tool_registry
        self.user_manager = user_manager
        self.max_tool_rounds = 10
        self.max_retries = 3
        self.interrupted = False
    
    async def run(self, user_message: str, session: Session):
        """主循环：ReAct 模式"""
        try:
            session.add_message(Message(role="user", content=user_message))
            
            await self.user_manager.send_to_frontend({
                "type": "started",
                "session_id": session.session_id
            })
            
            for round_num in range(self.max_tool_rounds):
                if self.interrupted:
                    await self.user_manager.send_to_frontend({
                        "type": "interrupted",
                        "session_id": session.session_id
                    })
                    return
                
                messages = self._build_messages(session)
                tools = self.tool_registry.get_schemas()
                
                assistant_message = await self._stream_llm_with_retry(messages, tools, session)
                
                if not assistant_message:
                    continue
                
                if not assistant_message.tool_calls:
                    break
                
                tool_results = await self._execute_tools(assistant_message.tool_calls, session)
                
                for result in tool_results:
                    session.add_message(Message(
                        role="tool",
                        tool_call_id=result.tool_call_id,
                        name=result.tool_name,
                        content=result.output
                    ))
            
            await self.user_manager.send_to_frontend({
                "type": "completed",
                "session_id": session.session_id
            })
        
        except Exception as e:
            await self.user_manager.send_to_frontend({
                "type": "error",
                "session_id": session.session_id,
                "error": str(e)
            })
    
    async def _stream_llm_with_retry(self, messages: List, tools: List, session: Session) -> Optional[Message]:
        """流式调用 LLM，支持重试"""
        last_error = None
        
        for attempt in range(self.max_retries):
            try:
                return await self._stream_llm_response(messages, tools, session)
            except Exception as e:
                last_error = e
                await self.user_manager.send_to_frontend({
                    "type": "retry",
                    "session_id": session.session_id,
                    "attempt": attempt + 1,
                    "max_retries": self.max_retries,
                    "error": str(e)
                })
                
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
        
        raise last_error
    
    async def _stream_llm_response(self, messages: List, tools: List, session: Session) -> Message:
        """流式调用 LLM 并实时发送给前端"""
        # 完整实现见上文
        pass
    
    async def _execute_tools(self, tool_calls: List[Dict], session: Session) -> List[ToolResult]:
        """并行执行多个工具"""
        # 完整实现见上文
        pass
```

**关键特性：**
1. 多轮工具调用：支持连续调用工具直到 LLM 认为完成
2. 并行执行：一次调用多个工具时并行执行
3. 流式输出：实时将 LLM 的 token 流发送给前端
4. 确认机制：工具执行前检查 `require_confirmation`，需要时请求用户确认
5. 自动重试：LLM 调用失败时自动重试最多 3 次，指数退避
6. 中断支持：支持用户中断正在进行的任务

## 三、WebSocket 通信协议

### 3.1 消息格式（基于 OpenAI API，支持 Reasoning + Token 统计）

**客户端 → Python：**

```json
// 用户消息
{
  "type": "message",
  "session_id": "session-uuid",
  "content": "请帮我分析这个问题..."
}

// 配置更新
{
  "type": "config",
  "provider": "openai",
  "model": "o1-preview",
  "api_key": "sk-xxx",
  "base_url": "https://api.openai.com/v1",
  "enable_reasoning": true
}

// 工具确认响应
{
  "type": "tool_confirm",
  "tool_call_id": "call-xxx",
  "approved": true
}

// 中断请求
{
  "type": "interrupt",
  "session_id": "session-uuid"
}
```

**Python → 客户端：**

```json
// 流式 reasoning token（思考过程）
{
  "type": "reasoning_token",
  "session_id": "session-uuid",
  "content": "让我分析一下这个问题..."
}

// 流式 content token（最终答案）
{
  "type": "token",
  "session_id": "session-uuid",
  "content": "根据分析，我的建议是..."
}

// 完整的 reasoning 阶段结束
{
  "type": "reasoning_complete",
  "session_id": "session-uuid"
}

// 工具调用
{
  "type": "tool_call",
  "session_id": "session-uuid",
  "tool_call_id": "call-xxx",
  "name": "file_read",
  "arguments": {"path": "/path/to/file.txt"}
}

// 工具确认请求
{
  "type": "tool_confirm_request",
  "session_id": "session-uuid",
  "tool_call_id": "call-xxx",
  "name": "file_write",
  "arguments": {"path": "/path/to/file.txt", "content": "..."}
}

// 工具执行结果
{
  "type": "tool_result",
  "session_id": "session-uuid",
  "tool_call_id": "call-xxx",
  "success": true,
  "output": "file content..."
}

// 重试通知
{
  "type": "retry",
  "session_id": "session-uuid",
  "attempt": 2,
  "max_retries": 3,
  "error": "API timeout"
}

// 错误
{
  "type": "error",
  "session_id": "session-uuid",
  "error": "API request failed",
  "details": "..."
}

// 完成（包含 token 统计）
{
  "type": "completed",
  "session_id": "session-uuid",
  "usage": {
    "prompt_tokens": 1250,
    "completion_tokens": 450,
    "reasoning_tokens": 200,
    "total_tokens": 1900
  }
}
```

## 四、Tauri 端实现（Rust）

### 4.1 Sidecar 进程管理

```rust
// src-tauri/src/main.rs
use tauri::{Manager, ManagerWindowEvent, RunEvent};
use tauri_plugin_shell::ShellExt;
use std::sync::Mutex;

pub struct PythonSidecar(Mutex<Option<tauri::shell::CommandChild>>);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PythonSidecar(Mutex::new(None)))
        .setup(|app| {
            let shell = app.shell();
            let sidecar_command = shell.sidecar("python_backend").unwrap();
            
            let (mut rx, child) = sidecar_command.spawn().expect("Failed to spawn sidecar");
            
            let sidecar = app.state::<PythonSidecar>();
            *sidecar.0.lock().unwrap() = Some(child);
            
            tauri::async_runtime::spawn(async move {
                use tauri::shell::process::CommandEvent;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            println!("[Python] {}", line);
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!("[Python Error] {}", line);
                        }
                        _ => {}
                    }
                }
            });
            
            Ok(())
        })
        .on_window_event(|window, event| {
            if let ManagerWindowEvent::CloseRequested { .. } = event {
                let app = window.app_handle();
                let sidecar = app.state::<PythonSidecar>();
                if let Some(mut child) = sidecar.0.lock().unwrap().take() {
                    child.kill().expect("Failed to kill Python sidecar");
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 4.2 Sidecar 配置

```json
// src-tauri/tauri.conf.json
{
  "bundle": {
    "externalBin": [
      "binaries/python_backend"
    ]
  }
}
```

## 五、前端实现（React + TypeScript）

### 5.1 项目结构

```
src/
├── components/
│   ├── Chat/
│   │   ├── ChatContainer.tsx
│   │   ├── MessageList.tsx
│   │   ├── MessageItem.tsx
│   │   ├── MessageInput.tsx
│   │   └── StreamingMessage.tsx
│   ├── Reasoning/
│   │   └── ReasoningBlock.tsx
│   ├── Tools/
│   │   ├── ToolCallDisplay.tsx
│   │   └── ToolConfirmModal.tsx
│   ├── Sidebar/
│   │   ├── Sidebar.tsx
│   │   ├── SessionList.tsx
│   │   └── WorkspaceSelector.tsx
│   └── Settings/
│       ├── SettingsModal.tsx
│       └── ProviderConfig.tsx
├── hooks/
│   ├── useWebSocket.ts
│   ├── useSession.ts
│   └── useConfig.ts
├── stores/
│   ├── chatStore.ts
│   ├── sessionStore.ts
│   └── configStore.ts
├── services/
│   └── websocket.ts
├── utils/
│   ├── markdown.ts
│   └── storage.ts
└── types/
    └── index.ts
```

### 5.2 WebSocket 连接管理

```typescript
// hooks/useWebSocket.ts
import { useEffect, useRef, useCallback, useState } from 'react';
import { useChatStore } from '../stores/chatStore';
import { useConfigStore } from '../stores/configStore';

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { addToken, addReasoningToken, setToolCall, setCompleted, setError } = useChatStore();
  const { config } = useConfigStore();

  const connect = useCallback(() => {
    const ws = new WebSocket('ws://127.0.0.1:8765');
    
    ws.onopen = () => {
      setIsConnected(true);
      if (config) {
        ws.send(JSON.stringify({ type: 'config', ...config }));
      }
    };
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      handleMessage(data);
    };
    
    ws.onclose = () => {
      setIsConnected(false);
      setTimeout(connect, 3000);
    };
    
    wsRef.current = ws;
  }, [config]);

  const handleMessage = (data: any) => {
    switch (data.type) {
      case 'token':
        addToken(data.session_id, data.content);
        break;
      case 'reasoning_token':
        addReasoningToken(data.session_id, data.content);
        break;
      case 'tool_call':
        setToolCall(data.session_id, data);
        break;
      case 'completed':
        setCompleted(data.session_id, data.usage);
        break;
      case 'error':
        setError(data.session_id, data.error, data.details);
        break;
    }
  };

  const sendMessage = useCallback((sessionId: string, content: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'message',
        session_id: sessionId,
        content
      }));
    }
  }, []);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  return { isConnected, sendMessage };
}
```

### 5.3 状态管理（Zustand）

```typescript
// stores/chatStore.ts
import { create } from 'zustand';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'reasoning' | 'tool';
  content: string;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
  tool_results?: ToolResult[];
  usage?: TokenUsage;
  status: 'streaming' | 'completed' | 'error';
}

interface ChatState {
  sessions: Record<string, {
    messages: Message[];
    currentStreamingContent: string;
    currentReasoningContent: string;
    isStreaming: boolean;
  }>;
  
  addToken: (sessionId: string, token: string) => void;
  addReasoningToken: (sessionId: string, token: string) => void;
  setToolCall: (sessionId: string, toolCall: any) => void;
  setCompleted: (sessionId: string, usage: TokenUsage) => void;
  setError: (sessionId: string, error: string, details: string) => void;
  addUserMessage: (sessionId: string, content: string) => void;
  clearSession: (sessionId: string) => void;
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
          currentStreamingContent: session.currentStreamingContent + token,
        },
      },
    };
  }),
  
  // ... 其他方法
}));
```

### 5.4 Markdown 流式渲染

```typescript
// components/Chat/StreamingMessage.tsx
import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface Props {
  content: string;
  isStreaming: boolean;
}

export function StreamingMessage({ content, isStreaming }: Props) {
  return (
    <div className="streaming-message">
      <ReactMarkdown
        children={content}
        components={{
          code({ node, inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            return !inline && match ? (
              <SyntaxHighlighter
                style={oneDark}
                language={match[1]}
                PreTag="div"
                {...props}
              >
                {String(children).replace(/\n$/, '')}
              </SyntaxHighlighter>
            ) : (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
        }}
      />
      {isStreaming && <span className="cursor">▊</span>}
    </div>
  );
}
```

### 5.5 配置管理

```typescript
// stores/configStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ProviderConfig {
  provider: 'openai' | 'qwen' | 'ollama';
  model: string;
  api_key: string;
  base_url: string;
  enable_reasoning: boolean;
}

interface ConfigState {
  config: ProviderConfig | null;
  workspaces: Workspace[];
  currentWorkspaceId: string | null;
  
  setConfig: (config: ProviderConfig) => void;
  addWorkspace: (workspace: Workspace) => void;
  setCurrentWorkspace: (id: string) => void;
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      config: null,
      workspaces: [],
      currentWorkspaceId: null,
      
      setConfig: (config) => set({ config }),
      addWorkspace: (workspace) => set((state) => ({
        workspaces: [...state.workspaces, workspace],
      })),
      setCurrentWorkspace: (id) => set({ currentWorkspaceId: id }),
    }),
    {
      name: 'config-storage',
    }
  )
);
```

## 六、Python 端 FastAPI/WebSocket 入口

```python
# main.py
import asyncio
import json
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from core.agent import Agent
from core.user import UserManager, Session
from llms.openai import OpenAILLM
from llms.qwen import QwenLLM
from llms.ollama import OllamaLLM
from tools.base import ToolRegistry
from tools.file_read import FileReadTool
from tools.file_write import FileWriteTool

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

tool_registry = ToolRegistry()
tool_registry.register(FileReadTool())
tool_registry.register(FileWriteTool())

user_manager = UserManager()
active_agents: dict[str, Agent] = {}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    
    async def send_callback(message: dict):
        await websocket.send_json(message)
    
    user_manager.ws_callback = send_callback
    
    try:
        while True:
            data = await websocket.receive_json()
            await handle_message(websocket, data)
    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"Error: {e}")
        await websocket.send_json({
            "type": "error",
            "error": str(e)
        })

async def handle_message(websocket: WebSocket, data: dict):
    message_type = data.get("type")
    
    if message_type == "config":
        await handle_config(data)
    elif message_type == "message":
        await handle_user_message(websocket, data)
    elif message_type == "tool_confirm":
        await handle_tool_confirm(data)
    elif message_type == "interrupt":
        await handle_interrupt(data)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)
```

## 七、打包与部署

### 7.1 Python Sidecar 打包

```bash
# 使用 PyInstaller 打包
pyinstaller --onefile --name python_backend main.py

# 输出到 src-tauri/binaries/
# Windows: python_backend-x86_64-pc-windows-msvc.exe
# macOS: python_backend-x86_64-apple-darwin
# Linux: python_backend-x86_64-unknown-linux-gnu
```

### 7.2 Tauri 构建配置

```json
// src-tauri/tauri.conf.json
{
  "bundle": {
    "externalBin": [
      "binaries/python_backend"
    ]
  }
}
```

## 八、关键设计决策

### 8.1 Provider 配置管理

- **决策**：前端配置文件存储
- **理由**：便于用户管理 API Key，支持多 Provider 切换
- **实现**：使用 Zustand persist 中间件存储到 localStorage

### 8.2 工具执行确认机制

- **决策**：自动执行 + 可选确认
- **理由**：平衡安全性和用户体验
- **实现**：工具基类中的 `require_confirmation` 属性

### 8.3 Session 持久化

- **决策**：JSONL + 完整消息历史
- **理由**：便于重现完整对话，支持流式输出回放
- **实现**：每条消息追加到 JSONL 文件

### 8.4 错误处理与重试

- **决策**：自动重试 + Agent 决策
- **理由**：提高系统稳定性，减少用户干预
- **实现**：LLM 调用失败自动重试 3 次，指数退避

### 8.5 WebSocket 协议

- **决策**：OpenAI API 格式
- **理由**：兼容性好，便于理解和扩展
- **实现**：消息格式参考 OpenAI Chat Completion API

### 8.6 初始工具集

- **决策**：最小化工具集
- **理由**：快速验证架构，降低初期复杂度
- **实现**：FileReadTool + FileWriteTool

## 九、未来扩展

### 9.1 短期扩展（v1.1）

- 添加更多工具：网页搜索、命令执行、代码执行
- 支持多模态输入（图片）
- Workspace 切换和管理

### 9.2 中期扩展（v1.2）

- 支持多会话并行
- 对话分支和回溯
- 工具市场和自定义工具

### 9.3 长期扩展（v2.0）

- 多 Agent 协作
- 知识库集成
- RAG 支持