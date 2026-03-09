# AI Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a complete AI Agent system with Tauri + Python Sidecar + WebSocket architecture using LLM-User-Tools three-role model.

**Architecture:** Python backend runs as Sidecar process managed by Tauri, communicates with React frontend via WebSocket. Agent core implements ReAct loop with streaming output, tool execution, and session persistence.

**Tech Stack:** Tauri 2.x, React 19, TypeScript 5.8, FastAPI, WebSocket, Zustand, PyInstaller

---

## Phase 1: Python Backend Core (Tasks 1-9)

See detailed implementation in separate sections below.

## Phase 2: Tauri Sidecar Integration (Tasks 10-12)

## Phase 3: Frontend Implementation (Tasks 13-20)

---

## Task 1: Setup Python Project Structure

**Files:**
- Create: `python_backend/requirements.txt`
- Create: `python_backend/main.py`
- Create: `python_backend/core/__init__.py`
- Create: `python_backend/llms/__init__.py`
- Create: `python_backend/tools/__init__.py`

**Step 1: Create requirements.txt**

```txt
fastapi==0.115.0
uvicorn==0.32.0
websockets==13.0
openai==1.54.0
pydantic==2.9.0
python-multipart==0.0.12
```

**Step 2: Create directory structure**

Run:
```bash
mkdir -p python_backend/core
mkdir -p python_backend/llms
mkdir -p python_backend/tools
```

**Step 3: Create empty __init__.py in each subdirectory**

**Step 4: Create minimal main.py**

```python
from fastapi import FastAPI

app = FastAPI()

@app.get("/")
async def root():
    return {"message": "AI Agent Backend"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)
```

**Step 5: Test the server**

Run:
```bash
cd python_backend
pip install -r requirements.txt
python main.py
```

Expected: Server starts on http://127.0.0.1:8765

**Step 6: Commit**

```bash
git add python_backend/
git commit -m "feat: setup Python backend project structure"
```

---

## Task 2-9: Python Core Implementation

For detailed implementation of Tasks 2-9 (LLM base, OpenAI provider, Tools system, User/Session management, Agent core, WebSocket server), refer to the design document at `docs/plans/2026-03-09-ai-agent-design.md`.

Each task follows the pattern:
1. Write the code
2. Test if applicable
3. Commit with descriptive message

---

## Task 10: Add Tauri Shell Plugin

**Files:**
- Modify: `src-tauri/Cargo.toml`

**Step 1: Add tauri-plugin-shell dependency**

Add to dependencies section:
```toml
tauri-plugin-shell = "2"
```

**Step 2: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "feat: add tauri-plugin-shell dependency"
```

---

## Task 11: Implement Sidecar Management

**Files:**
- Modify: `src-tauri/src/main.rs`

**Step 1: Update main.rs with complete Sidecar management code (see design doc)**

**Step 2: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "feat: implement Python sidecar management"
```

---

## Task 12: Configure Sidecar Binary Path

**Files:**
- Modify: `src-tauri/tauri.conf.json`

**Step 1: Add externalBin to bundle section**

```json
"externalBin": [
  "binaries/python_backend"
]
```

**Step 2: Create binaries directory**

```bash
mkdir -p src-tauri/binaries
```

**Step 3: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "feat: configure sidecar binary path"
```

---

## Task 13: Install Frontend Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Add frontend dependencies (zustand, react-markdown, react-syntax-highlighter, uuid)**

**Step 2: Install dependencies**

```bash
npm install
```

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add frontend dependencies"
```

---

## Task 14-20: Frontend Implementation

For detailed implementation of Tasks 14-20 (Type definitions, Stores, WebSocket hook, Components), refer to the design document.

Each component follows the pattern:
1. Create the file
2. Write the component code
3. Test in development mode
4. Commit

---

## Phase 4: Build and Package

### Task 21: Build Python Sidecar

**Step 1: Install PyInstaller**

```bash
pip install pyinstaller
```

**Step 2: Build executable**

```bash
cd python_backend
pyinstaller --onefile --name python_backend main.py
```

**Step 3: Copy to Tauri binaries**

```bash
cp dist/python_backend ../src-tauri/binaries/python_backend-x86_64-pc-windows-msvc.exe
```

**Step 4: Commit**

```bash
git add src-tauri/binaries/
git commit -m "build: add Python sidecar binary"
```

---

### Task 22: Build Tauri Application

**Step 1: Build frontend**

```bash
npm run build
```

**Step 2: Build Tauri app**

```bash
npm run tauri build
```

**Step 3: Test the built application**

Run the executable from `src-tauri/target/release/`

---

## Testing Strategy

### Unit Tests
- Test each tool in isolation
- Test Agent logic with mock LLM
- Test session persistence

### Integration Tests
- Test WebSocket message flow
- Test tool execution flow
- Test error handling and retry

### Manual Testing
- Test with real OpenAI API
- Test tool confirmations
- Test session persistence across restarts

---

## Deployment Checklist

- [ ] All Python tests passing
- [ ] All TypeScript type checks passing
- [ ] Frontend builds successfully
- [ ] Python sidecar builds successfully
- [ ] Tauri app builds successfully
- [ ] Manual testing complete
- [ ] Documentation updated

---

## Notes

- Follow the design document for exact code implementations
- Commit frequently with descriptive messages
- Test each component before moving to the next
- Use TypeScript strict mode
- Follow Python PEP 8 style guide