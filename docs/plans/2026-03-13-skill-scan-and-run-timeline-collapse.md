# Skill Scan And Run Timeline Collapse Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restrict skill discovery to the user's system and workspace `.agent/skills` directories, and make the workspace run timeline collapsed by default behind a lightweight status bar.

**Architecture:** Keep the existing provider and run-event contracts intact. Fix skill discovery by narrowing the configured search roots and adding a regression test around `~/.agent/skills`; fix the workspace layout by changing only the `RunTimeline` presentation layer into a collapsible summary/details component.

**Tech Stack:** Python 3.13, unittest, React 19, TypeScript, Vitest, Zustand

---

### Task 1: Fix skill discovery roots

**Files:**
- Modify: `python_backend/main.py`
- Modify: `python_backend/tests/test_context_provider_registry.py`
- Create: `python_backend/tests/test_skill_loader_paths.py`

**Step 1: Write the failing tests**

- Add a test that constructs `LocalSkillLoader` with a simulated `~/.agent/skills` root and verifies a matching `SKILL.md` resolves.
- Update the provider registry test to assert the configured system skill root is `~/.agent/skills` and that `.codex` is no longer required.

**Step 2: Run test to verify it fails**

Run:

```powershell
& 'C:\Users\patri\AppData\Local\Programs\Python\Python313\python.exe' -m unittest python_backend.tests.test_skill_loader_paths python_backend.tests.test_context_provider_registry -v
```

Expected:

- at least one test fails because the current runtime still points at legacy skill roots

**Step 3: Write minimal implementation**

- Change backend startup provider roots to use only:
  - `Path.home() / ".agent" / "skills"`
  - workspace-local `.agent/skills`
- Keep workspace-local discovery in `LocalSkillLoader`

**Step 4: Run tests to verify they pass**

Run:

```powershell
& 'C:\Users\patri\AppData\Local\Programs\Python\Python313\python.exe' -m unittest python_backend.tests.test_skill_loader_paths python_backend.tests.test_context_provider_registry python_backend.tests.test_skill_runtime -v
```

Expected:

- all focused skill discovery tests pass

### Task 2: Collapse the run timeline by default

**Files:**
- Modify: `src/components/Run/RunTimeline.tsx`
- Modify: `src/components/Run/RunTimeline.test.tsx`

**Step 1: Write the failing test**

- Add a test asserting the component renders a summary bar by default and hides detailed events until the user expands it.

**Step 2: Run test to verify it fails**

Run:

```powershell
npm.cmd run test -- src/components/Run/RunTimeline.test.tsx
```

Expected:

- the new collapse behavior test fails because the timeline currently renders expanded details immediately

**Step 3: Write minimal implementation**

- Render nothing when there are no events
- Render a compact summary row when events exist
- Default to collapsed
- Toggle details with a button click
- Reuse existing event labels/details for the expanded list and recent-event summary

**Step 4: Run tests to verify they pass**

Run:

```powershell
npm.cmd run test -- src/components/Run/RunTimeline.test.tsx
```

Expected:

- run timeline tests pass with the new default-collapsed behavior

### Task 3: Verification

**Files:**
- None

**Step 1: Run backend verification**

Run:

```powershell
& 'C:\Users\patri\AppData\Local\Programs\Python\Python313\python.exe' -m unittest python_backend.tests.test_skill_loader_paths python_backend.tests.test_context_provider_registry python_backend.tests.test_skill_runtime -v
```

Expected:

- skill discovery regression tests pass

**Step 2: Run frontend verification**

Run:

```powershell
npm.cmd run test -- src/components/Run/RunTimeline.test.tsx
```

Expected:

- run timeline collapse tests pass
