param(
    [string]$VendorRoot,
    [switch]$SkipRuntimePrepare
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "common.ps1")

$projectRoot = Get-ProjectRoot
$manifest = Get-RuntimeManifest
$backendRoot = Join-Path $projectRoot "python_backend"
$stagedPython = Join-Path $projectRoot "tmp/runtime-stage/python/python.exe"
$venvPython = Join-Path $backendRoot ".venv/Scripts/python.exe"
$sidecarBaseName = [string]$manifest.build.backendSidecarBaseName

if (-not $SkipRuntimePrepare -and -not (Test-Path -LiteralPath $stagedPython)) {
    $prepareArgs = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "prepare-runtimes.ps1"))
    if (-not [string]::IsNullOrWhiteSpace($VendorRoot)) {
        $prepareArgs += @("-VendorRoot", $VendorRoot)
    }

    Invoke-CheckedCommand -FilePath "powershell" -Arguments $prepareArgs
}

if (Test-Path -LiteralPath $venvPython) {
    $buildPython = $venvPython
}
elseif (Test-Path -LiteralPath $stagedPython) {
    $buildPython = $stagedPython
}
else {
    throw "No Python build interpreter found. Expected either $venvPython or $stagedPython"
}

Write-Host "Using build interpreter: $buildPython"

Invoke-PipInstallWithRetry -PythonExecutable $buildPython -Packages @("-r", "requirements.txt", "pyinstaller") -WorkingDirectory $backendRoot

# Verify that key runtime deps are actually importable before building.
# PyInstaller silently skips hidden imports that don't exist on the build
# system, so if typing_extensions (or similar) failed to install, the
# resulting exe will crash at startup with ModuleNotFoundError.
Write-Host "Verifying critical runtime dependencies..."
$criticalModules = @('typing_extensions', 'annotated_types', 'pydantic', 'pydantic_core', 'fastapi', 'starlette', 'httpx', 'httpcore', 'openai', 'uvicorn', 'websockets', 'anyio', 'h11', 'sniffio', 'pymupdf', 'pymupdf4llm')
foreach ($mod in $criticalModules) {
    Write-Host "  Checking $mod..."
    Invoke-CheckedCommand -FilePath $buildPython -Arguments @("-c", "import $mod; print('OK: $mod')") -WorkingDirectory $backendRoot
}
Write-Host "All critical runtime dependencies verified."

if (Test-Path -LiteralPath (Join-Path $backendRoot "build")) {
    Remove-Item -LiteralPath (Join-Path $backendRoot "build") -Recurse -Force
}

if (Test-Path -LiteralPath (Join-Path $backendRoot "dist")) {
    Remove-Item -LiteralPath (Join-Path $backendRoot "dist") -Recurse -Force
}

Invoke-CheckedCommand -FilePath $buildPython -Arguments @("-m", "PyInstaller", "--clean", "python_backend.spec") -WorkingDirectory $backendRoot

$builtExe = Join-Path $backendRoot "dist/$sidecarBaseName.exe"
if (-not (Test-Path -LiteralPath $builtExe)) {
    throw "PyInstaller did not produce the expected backend executable: $builtExe"
}

$binariesRoot = Join-Path $projectRoot "src-tauri/binaries"
Ensure-Directory -Path $binariesRoot

$tauriSidecarPath = Join-Path $binariesRoot "$sidecarBaseName-x86_64-pc-windows-msvc.exe"
Copy-Item -LiteralPath $builtExe -Destination $tauriSidecarPath -Force

Write-Host "Backend sidecar ready at $tauriSidecarPath"
