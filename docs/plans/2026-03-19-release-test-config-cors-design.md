# Release Test-Config CORS Design

**Problem**

The packaged Windows app starts the backend successfully, but the Settings page reports `Cannot reach backend endpoint: http://127.0.0.1:8765/test-config` when testing a provider connection. Direct probing of the packaged backend shows `/test-config` is reachable, so the failure is in the browser-to-backend boundary rather than backend startup.

**Root Cause**

The release WebView origin on Windows uses `http://tauri.localhost`, while the backend CORS allowlist currently permits only:

- `http://localhost:1420`
- `http://127.0.0.1:1420`
- `tauri://localhost`
- `https://tauri.localhost`

Because `http://tauri.localhost` is missing, the `OPTIONS` preflight for `POST /test-config` is rejected by `CORSMiddleware` with `400 Disallowed CORS origin`. The frontend then surfaces that browser-level fetch failure as "Cannot reach backend endpoint".

**Approach Options**

1. Add `http://tauri.localhost` to the backend CORS allowlist and cover it with a regression test.
   Recommendation. This is the smallest, most direct fix and matches the observed packaged behavior.
2. Force Tauri to use the HTTPS custom protocol.
   This changes release networking semantics and risks mixed-content restrictions for local `http://127.0.0.1:8765` requests.
3. Replace frontend `fetch` with a Tauri-native HTTP plugin.
   This is a larger architectural change and unnecessary for this bug.

**Chosen Design**

Add `http://tauri.localhost` to the backend CORS allowlist in `python_backend/main.py`. Add a regression test that exercises the release-origin preflight request against `/test-config` and asserts that the response is no longer rejected. Rebuild the PyInstaller backend sidecar and regenerate the portable package so the packaged app uses the updated backend binary.

**Testing**

- Add a backend regression test for `OPTIONS /test-config` with origin `http://tauri.localhost`.
- Run the targeted backend test and verify it fails before the code change and passes after it.
- Rebuild the backend sidecar with `scripts/build-backend.ps1`.
- Repackage the portable artifact with `scripts/package-portable.ps1`.
- Verify the packaged backend returns CORS success for the same release-origin preflight request.
