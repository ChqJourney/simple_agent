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
$modelsSource = Join-Path $sidecarRoot "models"
$builtModels = Join-Path $builtDir "models"
$hasVenvPython = Test-Path -LiteralPath $venvPython
$hasStagedPython = Test-Path -LiteralPath $stagedPython

if (-not $SkipRuntimePrepare -and -not $hasVenvPython -and -not $hasStagedPython) {
    $prepareArgs = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "prepare-runtimes.ps1"))
    if (-not [string]::IsNullOrWhiteSpace($VendorRoot)) {
        $prepareArgs += @("-VendorRoot", $VendorRoot)
    }

    Invoke-CheckedCommand -FilePath "powershell" -Arguments $prepareArgs
    $hasStagedPython = Test-Path -LiteralPath $stagedPython
}

if ($hasVenvPython) {
    $buildPython = $venvPython
}
elseif ($hasStagedPython) {
    $buildPython = $stagedPython
}
else {
    throw "No Python build interpreter found. Expected either $venvPython or $stagedPython"
}

Write-Host "Using build interpreter: $buildPython"

Invoke-CheckedCommand -FilePath $buildPython -Arguments @("-m", "pip", "install", "-r", "requirements.txt", "pyinstaller") -WorkingDirectory $sidecarRoot

Write-Host "Verifying OCR sidecar build dependencies..."
$criticalImports = @(
    "fastapi",
    "uvicorn",
    "pydantic",
    "numpy",
    "PIL",
    "paddle",
    "paddleocr",
    "paddlex",
    "chardet",
    "chardet.pipeline.orchestrator__mypyc"
)
foreach ($importTarget in $criticalImports) {
    Write-Host "  Checking $importTarget..."
    Invoke-CheckedCommand -FilePath $buildPython -Arguments @("-c", "import $importTarget; print('OK: $importTarget')") -WorkingDirectory $sidecarRoot
}
Write-Host "All OCR sidecar dependencies verified."

Write-Host "Verifying PaddleX OCR extras..."
Invoke-CheckedCommand `
    -FilePath $buildPython `
    -Arguments @(
        "-c",
        "from paddlex.utils.deps import is_extra_available; import sys; ok = is_extra_available('ocr') or is_extra_available('ocr-core'); print(f'PaddleX OCR extras available: {ok}'); sys.exit(0 if ok else 1)"
    ) `
    -WorkingDirectory $sidecarRoot

Write-Host "Preparing bundled OCR models..."
Invoke-CheckedCommand `
    -FilePath $buildPython `
    -Arguments @("prepare_models.py", "--output-dir", "models", "--languages", "ch", "en") `
    -WorkingDirectory $sidecarRoot
Write-Host "Bundled OCR models prepared under $modelsSource"

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

$requiredMetadataPatterns = @(
    "paddleocr-*.dist-info",
    "paddlex-*.dist-info",
    "paddlepaddle-*.dist-info"
)
foreach ($pattern in $requiredMetadataPatterns) {
    $metadataDir = Get-ChildItem -Path $builtDir -Directory -Filter $pattern -Recurse | Select-Object -First 1
    if ($null -eq $metadataDir) {
        throw "PyInstaller output is missing required package metadata: $pattern"
    }
}

if (-not (Test-Path -LiteralPath $manifestSource)) {
    throw "OCR sidecar manifest source file not found: $manifestSource"
}

# PyInstaller 6 places collected data files under its internal content directory by
# default, but our runtime contract expects manifest.json beside ocr-server.exe.
Copy-Item -LiteralPath $manifestSource -Destination $builtManifest -Force

if (-not (Test-Path -LiteralPath $modelsSource)) {
    throw "Bundled OCR models source directory not found: $modelsSource"
}

if (Test-Path -LiteralPath $builtModels) {
    Remove-Item -LiteralPath $builtModels -Recurse -Force
}

Copy-Item -LiteralPath $modelsSource -Destination $builtModels -Recurse -Force

Ensure-Directory -Path $distRoot
Sync-Directory -Source $builtDir -Destination $distCurrentRoot

Write-Host "OCR sidecar ready at $distCurrentRoot"
