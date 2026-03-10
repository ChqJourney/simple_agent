# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-03-10

### Added

#### UI Framework
- **Multi-page application structure** with React Router
  - WelcomePage: Landing page with workspace creation and recent workspace list
  - WorkspacePage: Three-column layout with collapsible side panels
  - SettingsPage: Provider configuration with API key testing

#### Pages

**WelcomePage**
- App title and description display
- "New Workspace" button with Tauri file dialog integration
- Recent workspaces list (sorted by last opened time)
- Workspace drawer with full workspace list
- Delete workspace on hover

**WorkspacePage**
- Three-column responsive layout
- Collapsible left panel (workspace info + session list)
- Collapsible right panel (file tree / task list tabs)
- Central chat container
- WebSocket connection status indicator
- Model and provider display
- Dev mode backend checker

**SettingsPage**
- Provider configuration (OpenAI, Qwen, Ollama)
- Model selection per provider
- API key input with test functionality
- Base URL configuration
- Reasoning model enable/disable toggle
- Theme selection (Light/Dark/System)
- API key validation with status indicator

#### Components

**Workspace Components**
- `TopBar`: Navigation controls, workspace name, connection status, model display
- `LeftPanel`: Workspace info, path, model, session list
- `RightPanel`: Tab switcher for FileTree and TaskList
- `FileTree`: Directory tree with Tauri fs integration, expand/collapse, drag support
- `TaskList`: Agent task status display with sub-tasks support

**Welcome Components**
- `WorkspaceList`: Display list of workspaces
- `WorkspaceItem`: Individual workspace item with hover delete
- `WorkspaceDrawer`: Side drawer for full workspace list

**Common Components**
- `WSStatusIndicator`: WebSocket connection status (connecting/connected/disconnected)
- `ModelDisplay`: Current model and provider display

#### State Management

**New Stores**
- `workspaceStore`: Workspace list, current workspace, CRUD operations with persistence
- `uiStore`: Panel visibility, theme, right panel tab state with persistence
- `taskStore`: Agent task tracking with status updates

#### Features
- React Router for URL-based navigation
- Workspace persistence via Zustand persist middleware
- File tree with lazy loading for large directories
- Task list with status indicators (pending/in_progress/completed/failed)
- Dark mode support with system preference detection
- Tauri dialog plugin for folder selection
- Tauri fs plugin for file system operations

### Dependencies

**New Dependencies**
- `react-router-dom` v7.13.1 - Client-side routing
- `@tauri-apps/plugin-dialog` v2.6.0 - Native file dialogs
- `@tauri-apps/plugin-fs` v2.4.5 - File system access

**Tauri Plugins**
- `tauri-plugin-dialog` - File dialog integration
- `tauri-plugin-fs` - File system operations

### Architecture

```
/                    → WelcomePage
/workspace/:id       → WorkspacePage
/settings            → SettingsPage
```

### Project Structure

```
src/
├── pages/
│   ├── WelcomePage.tsx
│   ├── WorkspacePage.tsx
│   └── SettingsPage.tsx
├── components/
│   ├── Welcome/
│   │   ├── WorkspaceList.tsx
│   │   ├── WorkspaceItem.tsx
│   │   └── WorkspaceDrawer.tsx
│   ├── Workspace/
│   │   ├── TopBar.tsx
│   │   ├── LeftPanel.tsx
│   │   ├── RightPanel.tsx
│   │   ├── FileTree.tsx
│   │   └── TaskList.tsx
│   ├── common/
│   │   ├── WSStatusIndicator.tsx
│   │   └── ModelDisplay.tsx
│   └── Settings/       (existing, enhanced)
├── stores/
│   ├── workspaceStore.ts  (new)
│   ├── uiStore.ts         (new)
│   └── taskStore.ts       (new)
└── App.tsx             (updated with Router)
```

### Removed

- `src/components/Sidebar/Sidebar.tsx` - Replaced by new layout
- `src/components/Sidebar/WorkspaceSelector.tsx` - Moved to WelcomePage