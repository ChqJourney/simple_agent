param(
    [string]$VendorRoot,
    [switch]$SkipRuntimePrepare
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "common.ps1")

$projectRoot = Get-ProjectRoot
$sidecarRoot = Join-Path $projectRoot "ocr_sidecar"
$stagedPython = Join-Path $projectRoot "tmp/runtime-stage/python/python.exe"
$venvPython = Join-Path $sidecarRoot ".venv/Scripts/python.exe"
$distRoot = Join-Path $projectRoot "dist/ocr-sidecar"
$distCurrentRoot = Join-Path $distRoot "current"
$builtDir = Join-Path $sidecarRoot "dist/ocr-server"
$builtExe = Join-Path $builtDir "ocr-server.exe"
$manifestSource = Join-Path $sidecarRoot "manifest.json"
$builtManifest = Join-Path $builtDir "manifest.json"

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

Invoke-CheckedCommand -FilePath $buildPython -Arguments @("-m", "pip", "install", "-r", "requirements.txt", "pyinstaller") -WorkingDirectory $sidecarRoot

Write-Host "Verifying OCR sidecar build dependencies..."
$criticalModules = @("fastapi", "uvicorn", "pydantic", "numpy", "PIL", "paddle", "paddleocr")
foreach ($mod in $criticalModules) {
    Write-Host "  Checking $mod..."
    Invoke-CheckedCommand -FilePath $buildPython -Arguments @("-c", "import $mod; print('OK: $mod')") -WorkingDirectory $sidecarRoot
}
Write-Host "All OCR sidecar dependencies verified."

if (Test-Path -LiteralPath (Join-Path $sidecarRoot "build")) {
    Remove-Item -LiteralPath (Join-Path $sidecarRoot "build") -Recurse -Force
}

if (Test-Path -LiteralPath (Join-Path $sidecarRoot "dist")) {
    Remove-Item -LiteralPath (Join-Path $sidecarRoot "dist") -Recurse -Force
}

Invoke-CheckedCommand -FilePath $buildPython -Arguments @("-m", "PyInstaller", "--clean", "ocr_sidecar.spec") -WorkingDirectory $sidecarRoot

if (-not (Test-Path -LiteralPath $builtExe)) {
    throw "PyInstaller did not produce the expected OCR sidecar executable: $builtExe"
}

if (-not (Test-Path -LiteralPath $manifestSource)) {
    throw "OCR sidecar manifest source file not found: $manifestSource"
}

# PyInstaller 6 places collected data files under its internal content directory by
# default, but our runtime contract expects manifest.json beside ocr-server.exe.
Copy-Item -LiteralPath $manifestSource -Destination $builtManifest -Force

Ensure-Directory -Path $distRoot
Sync-Directory -Source $builtDir -Destination $distCurrentRoot

Write-Host "OCR sidecar ready at $distCurrentRoot"
