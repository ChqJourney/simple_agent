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

Invoke-CheckedCommand -FilePath $buildPython -Arguments @("-m", "pip", "install", "-r", "requirements.txt", "pyinstaller") -WorkingDirectory $backendRoot

# Force-install critical transitive deps that pip may skip on embedded Python.
# Python 3.13 embeddable sometimes satisfies typing_extensions via a stdlib stub
# that does NOT actually provide the module at import time, so pip thinks it is
# already installed and skips it.  Using --force-reinstall ensures the real
# package lands in site-packages regardless.
Write-Host "Force-installing critical transitive dependencies..."
$forceInstallPackages = @('typing_extensions', 'annotated_types')
foreach ($pkg in $forceInstallPackages) {
    Write-Host "  Force-installing $pkg..."
    Invoke-CheckedCommand -FilePath $buildPython -Arguments @("-m", "pip", "install", "--force-reinstall", $pkg) -WorkingDirectory $backendRoot
}

# Verify that key runtime deps are actually importable before building.
# PyInstaller silently skips hidden imports that don't exist on the build
# system, so if typing_extensions (or similar) failed to install, the
# resulting exe will crash at startup with ModuleNotFoundError.
Write-Host "Verifying critical runtime dependencies..."
$criticalModules = @('typing_extensions', 'annotated_types', 'pydantic', 'pydantic_core', 'fastapi', 'starlette', 'httpx', 'httpcore', 'openai', 'uvicorn', 'websockets', 'aiohttp', 'anyio', 'h11', 'sniffio')
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

# Verify that critical modules were actually bundled into the exe.
# Use PyInstaller's own archive inspector to check.
Write-Host "Verifying bundled modules in output exe..."
$bundledModules = & $buildPython -m PyInstaller.utils.cliutils.archive_viewer $builtExe --with-module-names 2>$null
if ($LASTEXITCODE -ne 0) {
    # archive_viewer doesn't have --with-module-names in older versions,
    # skip this check
    Write-Host "  (archive_viewer module listing not supported, skipping bundle verification)"
} else {
    $criticalCheck = @('typing_extensions', 'annotated_types', 'pydantic_core', 'pydantic')
    foreach ($mod in $criticalCheck) {
        if ($bundledModules -notmatch [regex]::Escape($mod)) {
            throw "CRITICAL: Module '$mod' is NOT bundled in the output exe! PyInstaller silently skipped it. The exe will crash at startup."
        }
        Write-Host "  OK: $mod is bundled"
    }
}

$binariesRoot = Join-Path $projectRoot "src-tauri/binaries"
Ensure-Directory -Path $binariesRoot

$tauriSidecarPath = Join-Path $binariesRoot "$sidecarBaseName-x86_64-pc-windows-msvc.exe"
Copy-Item -LiteralPath $builtExe -Destination $tauriSidecarPath -Force

Write-Host "Backend sidecar ready at $tauriSidecarPath"
