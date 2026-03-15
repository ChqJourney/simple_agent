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
