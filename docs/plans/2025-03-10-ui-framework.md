# UI Framework Implementation Plan

> **Status:** ✅ Completed (2025-03-10)

**Goal:** Implement a multi-page UI framework with Welcome, Workspace, and Settings pages using React Router.

**Architecture:** Three-page application with React Router for navigation. WelcomePage handles workspace creation and recent list. WorkspacePage features a three-column layout with collapsible panels. SettingsPage provides provider configuration with API key testing.

**Tech Stack:** React, React Router, Zustand, Tailwind CSS, Tauri APIs

---

## Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install react-router-dom**

```bash
npm install react-router-dom
```

**Step 2: Verify installation**

Run: `npm list react-router-dom`
Expected: Shows installed version

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add react-router-dom dependency"
```

---

## Task 2: Create workspaceStore

**Files:**
- Create: `src/stores/workspaceStore.ts`
- Modify: `src/stores/index.ts`

**Step 1: Write workspaceStore**

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Workspace {
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
  updateLastOpened: (id: string) => void;
}

const generateId = () => Math.random().toString(36).substring(2, 15);

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      workspaces: [],
      currentWorkspace: null,

      loadWorkspaces: () => {
        // Workspaces are loaded from persist
      },

      addWorkspace: async (path: string) => {
        const name = path.split(/[/\\]/).pop() || path;
        const newWorkspace: Workspace = {
          id: generateId(),
          name,
          path,
          lastOpened: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };
        set((state) => ({
          workspaces: [...state.workspaces, newWorkspace],
          currentWorkspace: newWorkspace,
        }));
        return newWorkspace;
      },

      removeWorkspace: (id: string) => {
        set((state) => ({
          workspaces: state.workspaces.filter((w) => w.id !== id),
          currentWorkspace: state.currentWorkspace?.id === id ? null : state.currentWorkspace,
        }));
      },

      setCurrentWorkspace: (workspace: Workspace | null) => {
        set({ currentWorkspace: workspace });
        if (workspace) {
          get().updateLastOpened(workspace.id);
        }
      },

      updateLastOpened: (id: string) => {
        set((state) => ({
          workspaces: state.workspaces.map((w) =>
            w.id === id ? { ...w, lastOpened: new Date().toISOString() } : w
          ),
        }));
      },
    }),
    {
      name: 'workspace-storage',
    }
  )
);
```

**Step 2: Export from index**

Modify `src/stores/index.ts` to add:

```typescript
export * from './workspaceStore';
```

**Step 3: Commit**

```bash
git add src/stores/workspaceStore.ts src/stores/index.ts
git commit -m "feat: add workspaceStore for workspace state management"
```

---

## Task 3: Create uiStore

**Files:**
- Create: `src/stores/uiStore.ts`
- Modify: `src/stores/index.ts`

**Step 1: Write uiStore**

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type RightPanelTab = 'filetree' | 'tasklist';

interface UIState {
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  rightPanelTab: RightPanelTab;
  theme: 'light' | 'dark' | 'system';
  
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      leftPanelCollapsed: false,
      rightPanelCollapsed: false,
      rightPanelTab: 'filetree',
      theme: 'system',

      toggleLeftPanel: () =>
        set((state) => ({ leftPanelCollapsed: !state.leftPanelCollapsed })),

      toggleRightPanel: () =>
        set((state) => ({ rightPanelCollapsed: !state.rightPanelCollapsed })),

      setRightPanelTab: (tab) => set({ rightPanelTab: tab }),

      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'ui-storage',
    }
  )
);
```

**Step 2: Export from index**

Modify `src/stores/index.ts` to add:

```typescript
export * from './uiStore';
```

**Step 3: Commit**

```bash
git add src/stores/uiStore.ts src/stores/index.ts
git commit -m "feat: add uiStore for panel and theme state"
```

---

## Task 4: Create taskStore

**Files:**
- Create: `src/stores/taskStore.ts`
- Modify: `src/stores/index.ts`

**Step 1: Write taskStore**

```typescript
import { create } from 'zustand';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface Task {
  id: string;
  sessionId: string;
  content: string;
  status: TaskStatus;
  subTasks?: Task[];
  createdAt: string;
}

interface TaskState {
  tasks: Task[];
  
  addTask: (task: Task) => void;
  updateTaskStatus: (id: string, status: TaskStatus) => void;
  removeTask: (id: string) => void;
  getTasksBySession: (sessionId: string) => Task[];
  clearTasks: () => void;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],

  addTask: (task) =>
    set((state) => ({ tasks: [...state.tasks, task] })),

  updateTaskStatus: (id, status) =>
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, status } : t
      ),
    })),

  removeTask: (id) =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id),
    })),

  getTasksBySession: (sessionId) =>
    get().tasks.filter((t) => t.sessionId === sessionId),

  clearTasks: () => set({ tasks: [] }),
}));
```

**Step 2: Export from index**

Modify `src/stores/index.ts` to add:

```typescript
export * from './taskStore';
```

**Step 3: Commit**

```bash
git add src/stores/taskStore.ts src/stores/index.ts
git commit -m "feat: add taskStore for agent task tracking"
```

---

## Task 5: Create Pages Directory and Basic Router Setup

**Files:**
- Create: `src/pages/index.ts`
- Modify: `src/App.tsx`

**Step 1: Create pages index**

```typescript
export { WelcomePage } from './WelcomePage';
export { WorkspacePage } from './WorkspacePage';
export { SettingsPage } from './SettingsPage';
```

**Step 2: Update App.tsx with Router**

```typescript
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { WelcomePage, WorkspacePage, SettingsPage } from './pages';
import { useWorkspaceStore } from './stores';
import "./index.css";

const IS_DEV = import.meta.env.DEV;

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<WelcomePage />} />
        <Route path="/workspace/:workspaceId" element={<WorkspacePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
```

**Step 3: Commit**

```bash
git add src/pages/index.ts src/App.tsx
git commit -m "feat: setup React Router with page routes"
```

---

## Task 6: Create WelcomePage Component

**Files:**
- Create: `src/pages/WelcomePage.tsx`
- Create: `src/components/Welcome/index.ts`

**Step 1: Write WelcomePage**

```typescript
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspaceStore } from '../../stores';
import { WorkspaceList } from '../../components/Welcome/WorkspaceList';
import { WorkspaceDrawer } from '../../components/Welcome/WorkspaceDrawer';

const IS_DEV = import.meta.env.DEV;

export const WelcomePage: React.FC = () => {
  const navigate = useNavigate();
  const { workspaces, addWorkspace, setCurrentWorkspace } = useWorkspaceStore();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateWorkspace = async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Workspace Folder',
      });
      if (selected && typeof selected === 'string') {
        const existing = workspaces.find((w) => w.path === selected);
        if (existing) {
          setCurrentWorkspace(existing);
          navigate(`/workspace/${existing.id}`);
        } else {
          const workspace = await addWorkspace(selected);
          navigate(`/workspace/${workspace.id}`);
        }
      }
    } catch (error) {
      console.error('Failed to create workspace:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleOpenWorkspace = (workspaceId: string) => {
    const workspace = workspaces.find((w) => w.id === workspaceId);
    if (workspace) {
      setCurrentWorkspace(workspace);
      navigate(`/workspace/${workspaceId}`);
    }
  };

  const recentWorkspaces = [...workspaces]
    .sort((a, b) => new Date(b.lastOpened).getTime() - new Date(a.lastOpened).getTime())
    .slice(0, 5);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      {/* Top Bar */}
      <header className="fixed top-0 left-0 right-0 h-14 flex items-center justify-between px-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <button
          onClick={() => setIsDrawerOpen(true)}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          title="Workspace list"
        >
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <button
          onClick={() => navigate('/settings')}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          title="Settings"
        >
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </header>

      {/* Main Content */}
      <main className="flex flex-col items-center justify-center min-h-screen px-4 pt-14">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
            AI Agent
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Your AI Assistant
          </p>
        </div>

        <button
          onClick={handleCreateWorkspace}
          disabled={isCreating}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium transition-colors mb-8"
        >
          {isCreating ? 'Creating...' : '+ New Workspace'}
        </button>

        {recentWorkspaces.length > 0 && (
          <div className="w-full max-w-md">
            <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3 text-center">
              Recent Workspaces
            </h2>
            <WorkspaceList
              workspaces={recentWorkspaces}
              onSelect={handleOpenWorkspace}
            />
          </div>
        )}
      </main>

      {/* Drawer */}
      <WorkspaceDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onSelect={handleOpenWorkspace}
      />
    </div>
  );
};
```

**Step 2: Create Welcome components index**

```typescript
export { WorkspaceList } from './WorkspaceList';
export { WorkspaceItem } from './WorkspaceItem';
export { WorkspaceDrawer } from './WorkspaceDrawer';
```

**Step 3: Commit**

```bash
git add src/pages/WelcomePage.tsx src/components/Welcome/index.ts
git commit -m "feat: add WelcomePage component"
```

---

## Task 7: Create WorkspaceList and WorkspaceItem Components

**Files:**
- Create: `src/components/Welcome/WorkspaceList.tsx`
- Create: `src/components/Welcome/WorkspaceItem.tsx`

**Step 1: Write WorkspaceItem**

```typescript
import React, { useState } from 'react';
import { Workspace } from '../../stores/workspaceStore';

interface WorkspaceItemProps {
  workspace: Workspace;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export const WorkspaceItem: React.FC<WorkspaceItemProps> = ({
  workspace,
  onSelect,
  onDelete,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer transition-colors group"
      onClick={() => onSelect(workspace.id)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex items-center gap-3 overflow-hidden">
        <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <div className="overflow-hidden">
          <div className="font-medium text-gray-900 dark:text-white truncate">
            {workspace.name}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {workspace.path}
          </div>
        </div>
      </div>
      {isHovered && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(workspace.id);
          }}
          className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
          title="Remove workspace"
        >
          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
};
```

**Step 2: Write WorkspaceList**

```typescript
import React from 'react';
import { Workspace } from '../../stores/workspaceStore';
import { WorkspaceItem } from './WorkspaceItem';

interface WorkspaceListProps {
  workspaces: Workspace[];
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
}

export const WorkspaceList: React.FC<WorkspaceListProps> = ({
  workspaces,
  onSelect,
  onDelete,
}) => {
  const handleDelete = (id: string) => {
    if (onDelete) {
      onDelete(id);
    }
  };

  if (workspaces.length === 0) {
    return (
      <div className="text-center text-gray-500 dark:text-gray-400 py-4">
        No workspaces yet
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {workspaces.map((workspace) => (
        <WorkspaceItem
          key={workspace.id}
          workspace={workspace}
          onSelect={onSelect}
          onDelete={handleDelete}
        />
      ))}
    </div>
  );
};
```

**Step 3: Commit**

```bash
git add src/components/Welcome/WorkspaceItem.tsx src/components/Welcome/WorkspaceList.tsx
git commit -m "feat: add WorkspaceItem and WorkspaceList components"
```

---

## Task 8: Create WorkspaceDrawer Component

**Files:**
- Create: `src/components/Welcome/WorkspaceDrawer.tsx`

**Step 1: Write WorkspaceDrawer**

```typescript
import React from 'react';
import { useWorkspaceStore } from '../../stores';
import { WorkspaceList } from './WorkspaceList';

interface WorkspaceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
}

export const WorkspaceDrawer: React.FC<WorkspaceDrawerProps> = ({
  isOpen,
  onClose,
  onSelect,
}) => {
  const { workspaces, removeWorkspace } = useWorkspaceStore();

  const handleDelete = (id: string) => {
    removeWorkspace(id);
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed left-0 top-0 bottom-0 w-80 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 z-50 flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-white">
            Workspaces
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {workspaces.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-400 py-8">
              No workspaces yet.
              <br />
              Create your first workspace to get started.
            </div>
          ) : (
            <WorkspaceList
              workspaces={workspaces}
              onSelect={(id) => {
                onSelect(id);
                onClose();
              }}
              onDelete={handleDelete}
            />
          )}
        </div>
      </div>
    </>
  );
};
```

**Step 2: Commit**

```bash
git add src/components/Welcome/WorkspaceDrawer.tsx
git commit -m "feat: add WorkspaceDrawer component"
```

---

## Task 9: Create Common Components (WSStatusIndicator, ModelDisplay)

**Files:**
- Create: `src/components/common/WSStatusIndicator.tsx`
- Create: `src/components/common/ModelDisplay.tsx`
- Create: `src/components/common/index.ts`

**Step 1: Write WSStatusIndicator**

```typescript
import React from 'react';
import { useWebSocket } from '../../hooks/useWebSocket';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export const WSStatusIndicator: React.FC = () => {
  const { status, reconnect } = useWebSocket();

  const statusConfig: Record<ConnectionStatus, { color: string; label: string; icon: string }> = {
    connecting: { color: 'text-yellow-500', label: 'Connecting...', icon: '⏳' },
    connected: { color: 'text-green-500', label: 'Connected', icon: '🟢' },
    disconnected: { color: 'text-red-500', label: 'Disconnected', icon: '🔴' },
  };

  const config = statusConfig[status];

  const handleClick = () => {
    if (status === 'disconnected') {
      reconnect();
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
        status === 'disconnected' ? 'hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer' : 'cursor-default'
      }`}
      title={config.label}
    >
      <span>{config.icon}</span>
      {status === 'disconnected' && (
        <span className="text-xs text-red-500">Reconnect</span>
      )}
    </button>
  );
};
```

**Step 2: Write ModelDisplay**

```typescript
import React from 'react';
import { useConfigStore } from '../../stores/configStore';

export const ModelDisplay: React.FC = () => {
  const { config } = useConfigStore();

  if (!config) {
    return (
      <span className="text-sm text-gray-500 dark:text-gray-400">
        No model selected
      </span>
    );
  }

  const providerLabel: Record<string, string> = {
    openai: 'OpenAI',
    qwen: 'Qwen',
    ollama: 'Ollama',
  };

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="font-medium text-gray-900 dark:text-white">
        {config.model}
      </span>
      <span className="text-gray-400">·</span>
      <span className="text-gray-500 dark:text-gray-400">
        {providerLabel[config.provider] || config.provider}
      </span>
    </div>
  );
};
```

**Step 3: Create common index**

```typescript
export { WSStatusIndicator } from './WSStatusIndicator';
export { ModelDisplay } from './ModelDisplay';
```

**Step 4: Commit**

```bash
git add src/components/common/
git commit -m "feat: add WSStatusIndicator and ModelDisplay components"
```

---

## Task 10: Create WorkspacePage TopBar Component

**Files:**
- Create: `src/components/Workspace/TopBar.tsx`

**Step 1: Write TopBar**

```typescript
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useUIStore, useWorkspaceStore } from '../../stores';
import { WSStatusIndicator, ModelDisplay } from '../common';

export const TopBar: React.FC = () => {
  const navigate = useNavigate();
  const { currentWorkspace } = useWorkspaceStore();
  const { leftPanelCollapsed, rightPanelCollapsed, toggleLeftPanel, toggleRightPanel } = useUIStore();

  return (
    <header className="h-12 flex items-center justify-between px-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      {/* Left section */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleLeftPanel}
          className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
          title={leftPanelCollapsed ? 'Show left panel' : 'Hide left panel'}
        >
          <svg className={`w-5 h-5 text-gray-600 dark:text-gray-300 transition-transform ${leftPanelCollapsed ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
        <button
          onClick={() => navigate('/')}
          className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
          title="Back to home"
        >
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        </button>
        {currentWorkspace && (
          <span className="font-medium text-gray-900 dark:text-white ml-2">
            {currentWorkspace.name}
          </span>
        )}
      </div>

      {/* Center section */}
      <div className="flex items-center gap-3">
        <WSStatusIndicator />
        <ModelDisplay />
      </div>

      {/* Right section */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleRightPanel}
          className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
          title={rightPanelCollapsed ? 'Show right panel' : 'Hide right panel'}
        >
          <svg className={`w-5 h-5 text-gray-600 dark:text-gray-300 transition-transform ${rightPanelCollapsed ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </header>
  );
};
```

**Step 2: Commit**

```bash
git add src/components/Workspace/TopBar.tsx
git commit -m "feat: add WorkspacePage TopBar component"
```

---

## Task 11: Create WorkspacePage LeftPanel Component

**Files:**
- Create: `src/components/Workspace/LeftPanel.tsx`

**Step 1: Write LeftPanel**

```typescript
import React from 'react';
import { useWorkspaceStore, useSessionStore, useConfigStore } from '../../stores';
import { SessionList } from '../Sidebar/SessionList';

export const LeftPanel: React.FC = () => {
  const { currentWorkspace } = useWorkspaceStore();
  const { config } = useConfigStore();

  if (!currentWorkspace) {
    return (
      <div className="p-4 text-center text-gray-500 dark:text-gray-400">
        No workspace selected
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Workspace Info */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="font-medium text-gray-900 dark:text-white mb-2">
          Workspace
        </h3>
        <div className="space-y-1 text-sm">
          <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <span className="truncate">{currentWorkspace.path}</span>
          </div>
          {config && (
            <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <span className="truncate">{config.model}</span>
            </div>
          )}
        </div>
      </div>

      {/* Sessions */}
      <div className="flex-1 overflow-hidden">
        <SessionList workspacePath={currentWorkspace.path} />
      </div>
    </div>
  );
};
```

**Step 2: Commit**

```bash
git add src/components/Workspace/LeftPanel.tsx
git commit -m "feat: add WorkspacePage LeftPanel component"
```

---

## Task 12: Create FileTree Component

**Files:**
- Create: `src/components/Workspace/FileTree.tsx`

**Step 1: Write FileTree**

```typescript
import React, { useState, useEffect } from 'react';
import { useWorkspaceStore } from '../../stores';

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

export const FileTree: React.FC = () => {
  const { currentWorkspace } = useWorkspaceStore();
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (currentWorkspace?.path) {
      loadDirectory(currentWorkspace.path);
    }
  }, [currentWorkspace?.path]);

  const loadDirectory = async (dirPath: string): Promise<FileNode[]> => {
    try {
      const { readDir } = await import('@tauri-apps/plugin-fs');
      const entries = await readDir(dirPath);
      
      const nodes: FileNode[] = entries
        .filter((entry) => !entry.name.startsWith('.'))
        .sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name);
        })
        .map((entry) => ({
          name: entry.name,
          path: `${dirPath}/${entry.name}`,
          isDirectory: entry.isDirectory,
        }));

      if (dirPath === currentWorkspace?.path) {
        setTree(nodes);
        setLoading(false);
      }

      return nodes;
    } catch (error) {
      console.error('Failed to load directory:', error);
      setLoading(false);
      return [];
    }
  };

  const toggleExpand = async (node: FileNode) => {
    if (!node.isDirectory) return;

    const newExpanded = new Set(expandedPaths);
    if (newExpanded.has(node.path)) {
      newExpanded.delete(node.path);
    } else {
      newExpanded.add(node.path);
      if (!node.children) {
        const children = await loadDirectory(node.path);
        node.children = children;
        setTree([...tree]);
      }
    }
    setExpandedPaths(newExpanded);
  };

  const renderNode = (node: FileNode, depth: number = 0) => {
    const isExpanded = expandedPaths.has(node.path);

    return (
      <div key={node.path}>
        <div
          className="flex items-center gap-1 px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer rounded text-sm"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => toggleExpand(node)}
          draggable={!node.isDirectory}
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', node.path);
          }}
        >
          {node.isDirectory ? (
            <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          ) : (
            <span className="w-4" />
          )}
          {node.isDirectory ? (
            <svg className="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
              <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          )}
          <span className="text-gray-700 dark:text-gray-300 truncate">{node.name}</span>
        </div>
        {node.isDirectory && isExpanded && node.children && (
          <div>
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="p-4 text-center text-gray-500 dark:text-gray-400">
        Loading...
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="py-2">
        {tree.map((node) => renderNode(node))}
      </div>
    </div>
  );
};
```

**Step 2: Commit**

```bash
git add src/components/Workspace/FileTree.tsx
git commit -m "feat: add FileTree component with Tauri fs integration"
```

---

## Task 13: Create TaskList Component

**Files:**
- Create: `src/components/Workspace/TaskList.tsx`

**Step 1: Write TaskList**

```typescript
import React from 'react';
import { useTaskStore, useSessionStore } from '../../stores';

export const TaskList: React.FC = () => {
  const { currentSessionId } = useSessionStore();
  const { getTasksBySession } = useTaskStore();

  const tasks = currentSessionId ? getTasksBySession(currentSessionId) : [];

  const statusIcons: Record<string, React.ReactNode> = {
    pending: (
      <span className="w-4 h-4 rounded-full border-2 border-gray-300 dark:border-gray-600" />
    ),
    in_progress: (
      <div className="w-4 h-4 relative">
        <span className="absolute inset-0 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
      </div>
    ),
    completed: (
      <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    failed: (
      <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  };

  const statusColors: Record<string, string> = {
    pending: 'text-gray-500 dark:text-gray-400',
    in_progress: 'text-blue-600 dark:text-blue-400',
    completed: 'text-green-600 dark:text-green-400',
    failed: 'text-red-600 dark:text-red-400',
  };

  if (tasks.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500 dark:text-gray-400">
        No tasks yet
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="py-2 space-y-1">
        {tasks.map((task) => (
          <div key={task.id} className="px-4 py-2">
            <div className="flex items-start gap-2">
              {statusIcons[task.status]}
              <span className={`text-sm ${statusColors[task.status]}`}>
                {task.content}
              </span>
            </div>
            {task.subTasks && task.subTasks.length > 0 && (
              <div className="ml-6 mt-1 space-y-1">
                {task.subTasks.map((subTask) => (
                  <div key={subTask.id} className="flex items-center gap-2">
                    {statusIcons[subTask.status]}
                    <span className={`text-xs ${statusColors[subTask.status]}`}>
                      {subTask.content}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
```

**Step 2: Commit**

```bash
git add src/components/Workspace/TaskList.tsx
git commit -m "feat: add TaskList component for agent task display"
```

---

## Task 14: Create RightPanel Component

**Files:**
- Create: `src/components/Workspace/RightPanel.tsx`

**Step 1: Write RightPanel**

```typescript
import React from 'react';
import { useUIStore } from '../../stores';
import { FileTree } from './FileTree';
import { TaskList } from './TaskList';

export const RightPanel: React.FC = () => {
  const { rightPanelTab, setRightPanelTab } = useUIStore();

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setRightPanelTab('filetree')}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            rightPanelTab === 'filetree'
              ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          File Tree
        </button>
        <button
          onClick={() => setRightPanelTab('tasklist')}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            rightPanelTab === 'tasklist'
              ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          Tasks
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {rightPanelTab === 'filetree' ? <FileTree /> : <TaskList />}
      </div>
    </div>
  );
};
```

**Step 2: Commit**

```bash
git add src/components/Workspace/RightPanel.tsx
git commit -m "feat: add RightPanel with FileTree and TaskList tabs"
```

---

## Task 15: Create Workspace Components Index

**Files:**
- Create: `src/components/Workspace/index.ts`

**Step 1: Write index**

```typescript
export { TopBar } from './TopBar';
export { LeftPanel } from './LeftPanel';
export { RightPanel } from './RightPanel';
export { FileTree } from './FileTree';
export { TaskList } from './TaskList';
```

**Step 2: Commit**

```bash
git add src/components/Workspace/index.ts
git commit -m "feat: add Workspace components index"
```

---

## Task 16: Create WorkspacePage Component

**Files:**
- Create: `src/pages/WorkspacePage.tsx`

**Step 1: Write WorkspacePage**

```typescript
import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWorkspaceStore, useUIStore } from '../../stores';
import { TopBar, LeftPanel, RightPanel } from '../../components/Workspace';
import { ChatContainer } from '../../components/Chat';

const IS_DEV = import.meta.env.DEV;

export const WorkspacePage: React.FC = () => {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const { workspaces, setCurrentWorkspace, currentWorkspace } = useWorkspaceStore();
  const { leftPanelCollapsed, rightPanelCollapsed } = useUIStore();

  useEffect(() => {
    if (workspaceId) {
      const workspace = workspaces.find((w) => w.id === workspaceId);
      if (workspace) {
        setCurrentWorkspace(workspace);
      } else {
        navigate('/');
      }
    }
  }, [workspaceId, workspaces]);

  if (!currentWorkspace) {
    return (
      <div className="flex h-screen items-center justify-center bg-white dark:bg-gray-900">
        <div className="text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900">
      <TopBar />

      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel */}
        {!leftPanelCollapsed && (
          <div className="w-64 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <LeftPanel />
          </div>
        )}

        {/* Center Chat */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {IS_DEV ? (
            <DevBackendChecker>
              <ChatContainer />
            </DevBackendChecker>
          ) : (
            <ChatContainer />
          )}
        </main>

        {/* Right Panel */}
        {!rightPanelCollapsed && (
          <div className="w-72 border-l border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <RightPanel />
          </div>
        )}
      </div>
    </div>
  );
};

const DevBackendChecker: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [backendReady, setBackendReady] = React.useState(false);

  React.useEffect(() => {
    const checkBackend = async () => {
      try {
        const response = await fetch('http://127.0.0.1:8765/health');
        if (response.ok) {
          setBackendReady(true);
        }
      } catch {
        console.log('Backend not ready, retrying...');
      }
    };

    checkBackend();
    const interval = setInterval(checkBackend, 2000);
    return () => clearInterval(interval);
  }, []);

  if (!backendReady) {
    return (
      <div className="flex-1 flex items-center justify-center p-4 bg-yellow-50 dark:bg-yellow-950 text-yellow-900 dark:text-yellow-200 text-center text-sm">
        <div>
          Waiting for Python backend at http://127.0.0.1:8765...
          <br />
          <code className="text-xs bg-yellow-100 dark:bg-yellow-900 px-1.5 py-0.5 rounded">
            cd python_backend && python main.py
          </code>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
```

**Step 2: Commit**

```bash
git add src/pages/WorkspacePage.tsx
git commit -m "feat: add WorkspacePage with three-column layout"
```

---

## Task 17: Create SettingsPage Component

**Files:**
- Create: `src/pages/SettingsPage.tsx`

**Step 1: Write SettingsPage**

```typescript
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProviderConfig } from '../components/Settings/ProviderConfig';
import { useConfigStore } from '../stores/configStore';
import { useUIStore } from '../stores';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';

export const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { config, setConfig } = useConfigStore();
  const { theme, setTheme } = useUIStore();
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testError, setTestError] = useState<string | null>(null);

  const handleTest = async () => {
    if (!config) return;

    setTestStatus('testing');
    setTestError(null);

    try {
      const response = await fetch(`${config.base_url}/models`, {
        headers: {
          'Authorization': `Bearer ${config.api_key}`,
        },
      });

      if (response.ok) {
        setTestStatus('success');
      } else {
        const error = await response.text();
        setTestStatus('error');
        setTestError(error);
      }
    } catch (error) {
      setTestStatus('error');
      setTestError(error instanceof Error ? error.message : 'Connection failed');
    }
  };

  const handleSave = () => {
    navigate(-1);
  };

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      {/* Header */}
      <header className="h-14 flex items-center px-4 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="ml-4 text-lg font-semibold text-gray-900 dark:text-white">
          Settings
        </h1>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto p-6 space-y-8">
        {/* Provider Configuration */}
        <section>
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Provider Configuration
          </h2>
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-4">
            <ProviderConfig
              config={config}
              onChange={setConfig}
              onTest={handleTest}
              testStatus={testStatus}
              testError={testError}
            />
          </div>
        </section>

        {/* Appearance */}
        <section>
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">
            Appearance
          </h2>
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-700 dark:text-gray-300">
                Theme
              </label>
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
                className="px-3 py-1.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white"
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>
          </div>
        </section>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            Save
          </button>
        </div>
      </main>
    </div>
  );
};
```

**Step 2: Commit**

```bash
git add src/pages/SettingsPage.tsx
git commit -m "feat: add SettingsPage with API key testing"
```

---

## Task 18: Update ProviderConfig Component

**Files:**
- Modify: `src/components/Settings/ProviderConfig.tsx`

**Step 1: Update ProviderConfig to support test functionality**

Read the existing file first and update with test button and status indicator.

Add the following props interface and test functionality to the existing ProviderConfig component:

```typescript
import React from 'react';
import { ProviderConfig as ProviderConfigType, ProviderType } from '../../types';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';

interface ProviderConfigProps {
  config: ProviderConfigType | null;
  onChange: (config: ProviderConfigType) => void;
  onTest?: () => void;
  testStatus?: TestStatus;
  testError?: string | null;
}

export const ProviderConfig: React.FC<ProviderConfigProps> = ({
  config,
  onChange,
  onTest,
  testStatus = 'idle',
  testError,
}) => {
  // ... existing implementation with added test button
  
  // Add test button next to API key input:
  // [API Key Input] [Test] [Status Indicator]
  
  // Status indicators:
  // 'idle': no indicator
  // 'testing': ⏳ gray spinner
  // 'success': 🟢 green check
  // 'error': 🔴 red X with error tooltip
};
```

**Step 2: Commit**

```bash
git add src/components/Settings/ProviderConfig.tsx
git commit -m "feat: add API key test button and status indicator to ProviderConfig"
```

---

## Task 19: Install Tauri Plugins

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/capabilities/default.json`

**Step 1: Install Tauri dialog plugin**

```bash
npm install @tauri-apps/plugin-dialog
```

**Step 2: Install Tauri fs plugin**

```bash
npm install @tauri-apps/plugin-fs
```

**Step 3: Update Cargo.toml**

Add to dependencies in `src-tauri/Cargo.toml`:
```toml
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
```

**Step 4: Register plugins in main.rs**

Update `src-tauri/src/main.rs`:
```rust
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Step 5: Update capabilities**

Add permissions to `src-tauri/capabilities/default.json`:
```json
{
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "dialog:default",
    "fs:default"
  ]
}
```

**Step 6: Commit**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/src/main.rs src-tauri/capabilities/default.json
git commit -m "feat: add Tauri dialog and fs plugins"
```

---

## Task 20: Clean Up Old Sidebar Component

**Files:**
- Delete: `src/components/Sidebar/Sidebar.tsx`
- Delete: `src/components/Sidebar/WorkspaceSelector.tsx`
- Modify: `src/components/Sidebar/index.ts`

**Step 1: Remove old components**

Delete `src/components/Sidebar/Sidebar.tsx` and `src/components/Sidebar/WorkspaceSelector.tsx` as they are replaced by new components.

**Step 2: Update Sidebar index**

Update `src/components/Sidebar/index.ts`:
```typescript
export { SessionList } from './SessionList';
```

**Step 3: Commit**

```bash
git add src/components/Sidebar/
git commit -m "refactor: remove old Sidebar and WorkspaceSelector components"
```

---

## Task 21: Update useWebSocket Hook

**Files:**
- Modify: `src/hooks/useWebSocket.ts`

**Step 1: Add reconnect function and expose status**

Update the hook to export `status` and `reconnect` function for the WSStatusIndicator component.

```typescript
// Add status state and reconnect function
// Export: { status, connect, disconnect, reconnect, send, ... }
```

**Step 2: Commit**

```bash
git add src/hooks/useWebSocket.ts
git commit -m "feat: add reconnect functionality to useWebSocket hook"
```

---

## Task 22: Final Integration and Testing

**Step 1: Run type check**

```bash
npm run build
```

**Step 2: Run dev server**

```bash
npm run tauri dev
```

**Step 3: Test all pages**

1. Welcome page loads correctly
2. Create workspace from folder
3. Navigate to workspace page
4. Toggle left/right panels
5. File tree loads
6. Task list displays
7. Settings page with API test
8. Return to welcome page
9. Delete workspace

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete UI framework implementation"
```

---

## Summary

This plan implements a complete UI framework with:

1. **Three pages**: Welcome, Workspace, Settings
2. **React Router** for navigation
3. **Zustand stores** for state management
4. **Collapsible panels** in Workspace page
5. **File tree** with Tauri fs integration
6. **Task list** for agent status
7. **WebSocket status** indicator
8. **API key testing** in Settings

Each task is bite-sized (2-5 minutes) with clear file paths and complete code.