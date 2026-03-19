# Release Test-Config CORS Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix packaged Settings page connection tests by allowing the Windows release WebView origin to call `POST /test-config`, then rebuild the backend and portable package.

**Architecture:** Keep the existing `fetch`-based frontend contract and fix the actual release regression at the backend CORS boundary. Add a regression test for the release preflight origin, make the minimal allowlist change in `python_backend/main.py`, then rebuild the sidecar and portable artifact so the packaged app uses the updated backend.

**Tech Stack:** Python, FastAPI, Starlette CORS middleware, unittest, PyInstaller, Tauri Windows packaging, PowerShell build scripts

---

### Task 1: Add the failing regression test

**Files:**
- Create: `python_backend/tests/test_release_cors.py`

**Step 1: Write the failing test**

Add a unittest using `fastapi.testclient.TestClient` that sends:

```python
response = client.options(
    "/test-config",
    headers={
        "Origin": "http://tauri.localhost",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    },
)
```

Assert:

- `response.status_code == 200`
- `response.headers["access-control-allow-origin"] == "http://tauri.localhost"`

**Step 2: Run test to verify it fails**

Run: `python -m unittest python_backend.tests.test_release_cors -v`

Expected: FAIL because the current backend rejects that origin.

### Task 2: Implement the minimal backend fix

**Files:**
- Modify: `python_backend/main.py`

**Step 1: Update the CORS allowlist**

Add `http://tauri.localhost` to `ALLOWED_BROWSER_ORIGINS`.

**Step 2: Run the targeted test to verify it passes**

Run: `python -m unittest python_backend.tests.test_release_cors -v`

Expected: PASS

### Task 3: Rebuild the backend sidecar

**Files:**
- Rebuild: `src-tauri/binaries/python_backend-x86_64-pc-windows-msvc.exe`
- Rebuild: `python_backend/dist/python_backend.exe`

**Step 1: Run the backend build**

Run: `powershell -ExecutionPolicy Bypass -File scripts/build-backend.ps1`

Expected: PyInstaller completes and the sidecar is copied to `src-tauri/binaries/`.

### Task 4: Repackage the portable release

**Files:**
- Rebuild: `artifacts/release/0.1.0/portable/tauri_agent/python_backend.exe`
- Rebuild: `artifacts/release/0.1.0/portable/tauri_agent/tauri_agent.exe`

**Step 1: Run the portable packaging script**

Run: `powershell -ExecutionPolicy Bypass -File scripts/package-portable.ps1 -Version 0.1.0`

Expected: portable directory and zip are regenerated with the rebuilt backend.

### Task 5: Verify the packaged artifact

**Files:**
- Verify: `artifacts/release/0.1.0/portable/tauri_agent/python_backend.exe`

**Step 1: Start the packaged backend**

Run the packaged `python_backend.exe`.

**Step 2: Verify release-origin preflight**

Run:

```bash
curl.exe -i -X OPTIONS http://127.0.0.1:8765/test-config ^
  -H "Origin: http://tauri.localhost" ^
  -H "Access-Control-Request-Method: POST" ^
  -H "Access-Control-Request-Headers: content-type"
```

Expected: `200 OK` with `access-control-allow-origin: http://tauri.localhost`
