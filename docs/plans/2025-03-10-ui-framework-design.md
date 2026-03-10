# UI Framework Design

> **Status:** ✅ Completed (2025-03-10)

## Overview

This document describes the UI framework design for Tauri Agent, transitioning from a simple single-page layout to a multi-page application with Welcome and Workspace pages.

## Architecture

### Routing Structure

```
/                    → WelcomePage
/workspace/:id       → WorkspacePage
/settings            → SettingsPage
```

Using React Router for navigation with URL-based routing.

### Component Structure

```
src/
├── pages/
│   ├── WelcomePage.tsx
│   ├── WorkspacePage.tsx
│   └── SettingsPage.tsx
├── components/
│   ├── Welcome/
│   │   ├── WorkspaceList.tsx      # Recent workspace list
│   │   ├── WorkspaceItem.tsx      # List item with hover delete
│   │   └── WorkspaceDrawer.tsx    # Left drawer with all workspaces
│   ├── Workspace/
│   │   ├── TopBar.tsx             # Top bar with toggles
│   │   ├── LeftPanel.tsx          # Workspace info + session list
│   │   ├── RightPanel.tsx         # File tree / Task list tabs
│   │   ├── FileTree.tsx           # File tree tab
│   │   └── TaskList.tsx           # Task list tab
│   ├── Chat/                      # Reuse existing
│   │   ├── ChatContainer.tsx
│   │   ├── MessageList.tsx
│   │   ├── MessageItem.tsx
│   │   ├── MessageInput.tsx
│   │   └── ...
│   ├── common/
│   │   ├── WSStatusIndicator.tsx  # Connection status
│   │   └── ModelDisplay.tsx       # Model + Provider display
│   └── Settings/                   # Reuse existing
├── hooks/
│   └── useWorkspace.ts            # Workspace operations
├── stores/
│   ├── workspaceStore.ts         # NEW: Workspace state
│   ├── taskStore.ts              # NEW: Task state
│   ├── uiStore.ts                # NEW: UI state
│   └── ...existing stores
└── App.tsx                        # Router configuration
```

## Page Designs

### WelcomePage

```
┌─────────────────────────────────────────────────────────┐
│ [≡]                                      [⚙]            │ ← TopBar
├─────────────────────────────────────────────────────────┤
│                                                         │
│                    AI Agent                             │ ← App name
│                  Your AI Assistant                      │ ← Slogan
│                                                         │
│              [ + New Workspace ]                        │ ← Create button
│                                                         │
│                  Recent Workspaces                      │
│              ┌─────────────────────┐                    │
│              │ 📁 project-a     [x] │                    │ ← Recent list
│              │ 📁 project-b     [x] │                    │   hover shows delete
│              │ 📁 my-app        [x] │                    │
│              └─────────────────────┘                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Features:**
- Left top `[≡]` toggle: Opens drawer with full workspace list
- Right top `[⚙]`: Navigate to Settings page
- Center create button: Opens Tauri file dialog to select local folder
- Recent list: Shows recently opened workspaces (sorted by time), hover shows delete button

### WorkspacePage

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [≡] [🏠]  workspace-name                     [WS] GPT-4 · OpenAI   [≡]  │ ← TopBar
├────────────────┬─────────────────────────────────┬────────────────────┤
│                │                                 │                    │
│  workspace     │                                 │  [FileTree] [Task] │
│  ────────────  │                                 │  ─────────────────  │
│  📁 /path/to   │        Chat Messages            │  📁 src/           │
│  Model: GPT-4  │                                 │    📁 components/  │
│                │        [messages...]            │    📄 App.tsx      │
│  ────────────  │                                 │  📁 stores/        │
│  Sessions      │                                 │  ─────────────────  │
│  ────────────  │                                 │  ☑ Read file       │
│  • Session 1   │                                 │  ◐ Edit code      │
│  • Session 2   │        [input area]             │  ○ Run tests      │
│  • Session 3   │                                 │                    │
│                │                                 │                    │
└────────────────┴─────────────────────────────────┴────────────────────┘
  ← Left Panel          Center Chat             Right Panel →
```

**TopBar Components:**
- `[≡]`: Toggle left panel visibility
- `[🏠]`: Return to Welcome page
- `workspace-name`: Current workspace name
- `[WS]`: WebSocket status indicator
  - ⏳ Connecting (yellow)
  - 🟢 Connected (green)
  - 🔴 Disconnected (red) - click to reconnect
- `GPT-4 · OpenAI`: Current model + Provider display
- `[≡]`: Toggle right panel visibility

**LeftPanel Components:**
- Workspace basic info (name, path, current model)
- Session list (create new, switch, delete)

**Center Chat:**
- Reuse existing `ChatContainer` component

**RightPanel Components:**
- Tab switch: FileTree / TaskList
- FileTree: Display workspace directory structure, support expand/collapse
- TaskList: Display agent task execution status

### SettingsPage

```
┌─────────────────────────────────────────────────────────┐
│ [← Back]                                    Settings    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Provider Configuration                                  │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Provider: [OpenAI ▼]                            │   │
│  │ Model:    [gpt-4 ▼]                             │   │
│  │ API Key:  [••••••••••••] [Test] [🟢/🔴]         │   │
│  │ Base URL: [https://api.openai.com/v1]           │   │
│  │ [x] Enable Reasoning                            │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  Appearance                                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Theme: [System ▼]                               │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  [Save]                                                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**API Key Test Feature:**
- `[Test]` button: Sends test request to validate API Key
- Status indicator:
  - 🟢 Green: Test passed
  - 🔴 Red: Test failed
  - ⏳ Gray: Testing in progress
  - Default: No indicator

## Component Details

### FileTree

```
📁 project-root/
├── 📁 src/
│   ├── 📁 components/
│   │   ├── 📄 App.tsx       ← Highlighted (recently modified)
│   │   └── 📄 Button.tsx
│   ├── 📁 stores/
│   └── 📄 main.tsx
├── 📄 package.json
└── 📄 README.md
```

**Features:**
- Use Tauri API to read directory structure
- Support expand/collapse folders
- Click file: Can drag to chat input for reference
- Highlight: Files involved in current conversation / recently modified

### TaskList

```
Tasks
─────────────────────
☑ Read file config.ts
☑ Analyze codebase structure  
◐ Edit file App.tsx
  └─ Modifying component...
○ Run tests
○ Commit changes
```

**Task Status:**
- `pending` ○: Waiting to execute
- `in_progress` ◐: Executing (expandable for sub-tasks)
- `completed` ☑: Completed
- `failed` ✗: Failed

## State Management

### workspaceStore (NEW)

```typescript
interface Workspace {
  id: string;
  name: string;
  path: string;
  lastOpened: string;
  createdAt: string;
}

interface WorkspaceState {
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  
  loadWorkspaces: () => void;
  addWorkspace: (path: string) => Promise<Workspace>;
  removeWorkspace: (id: string) => void;
  setCurrentWorkspace: (workspace: Workspace | null) => void;
}
```

### taskStore (NEW)

```typescript
interface Task {
  id: string;
  sessionId: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  createdAt: string;
}

interface TaskState {
  tasks: Task[];
  addTask: (task: Task) => void;
  updateTaskStatus: (id: string, status: Task['status']) => void;
  getTasksBySession: (sessionId: string) => Task[];
}
```

### uiStore (NEW)

```typescript
interface UIState {
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  rightPanelTab: 'filetree' | 'tasklist';
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  setRightPanelTab: (tab: 'filetree' | 'tasklist') => void;
}
```

## Data Flow

```
WelcomePage                    WorkspacePage
    │                              │
    ├─ workspaceStore ◄────────────┤
    │   (workspaces list)           │
    │                              │
    └─ Click workspace ───────────►│
                                   │
                            ┌──────┴──────┐
                            │             │
                    sessionStore     chatStore
                    (sessions)      (messages)
                            │             │
                            └──────┬──────┘
                                   │
                            websocket ◄── backend
```

## Dependencies

**New Dependencies:**
- `react-router-dom` - Routing

**Tauri APIs:**
- `@tauri-apps/plugin-dialog` - File dialog
- `@tauri-apps/plugin-fs` - File system operations

## Theme Support

- Support light/dark/system modes
- Use Tailwind `dark:` prefix for dark mode styles

## Implementation Notes

1. All stores use Zustand with persist middleware where appropriate
2. File tree uses lazy loading for large directories
3. Task list updates via WebSocket messages from backend
4. Workspace data persists in localStorage via Zustand persist