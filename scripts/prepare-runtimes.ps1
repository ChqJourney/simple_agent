param(
    [string]$VendorRoot,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "common.ps1")

$projectRoot = Get-ProjectRoot
$manifest = Get-RuntimeManifest
$resolvedVendorRoot = Resolve-VendorRoot -VendorRoot $VendorRoot

$pythonArchive = Find-RequiredFile -Root $resolvedVendorRoot -FileName $manifest.python.embeddableArchive
$nodeArchive = Find-RequiredFile -Root $resolvedVendorRoot -FileName $manifest.node.archive

$pythonCache = Join-Path $resolvedVendorRoot "cache/python-runtime"
$nodeCache = Join-Path $resolvedVendorRoot "cache/node-runtime"
$nodeExtractTemp = Join-Path $resolvedVendorRoot "cache/node-extract"

$pythonStage = Join-Path $projectRoot "tmp/runtime-stage/python"
$nodeStage = Join-Path $projectRoot "tmp/runtime-stage/node"
$pythonResource = Join-Path $projectRoot "src-tauri/resources/runtimes/python"
$nodeResource = Join-Path $projectRoot "src-tauri/resources/runtimes/node"

Ensure-Directory -Path (Join-Path $resolvedVendorRoot "cache")
Ensure-Directory -Path (Join-Path $projectRoot "tmp/runtime-stage")
Ensure-Directory -Path (Join-Path $projectRoot "src-tauri/resources")
Ensure-Directory -Path (Join-Path $projectRoot "src-tauri/resources/runtimes")

$pythonExecutable = Join-Path $pythonCache "python.exe"
$nodeExecutable = Join-Path $nodeCache "node.exe"

if ($Force -or -not (Test-Path -LiteralPath $pythonExecutable)) {
    Write-Host "Staging Python embeddable runtime from $pythonArchive"
    Reset-Directory -Path $pythonCache
    Expand-Archive -LiteralPath $pythonArchive -DestinationPath $pythonCache -Force

    Write-Host "Configuring python._pth for site-packages support"
    $versionParts = $manifest.python.version.Split(".")
    $pthFileName = "python{0}{1}._pth" -f $versionParts[0], $versionParts[1]
    $pthPath = Join-Path $pythonCache $pthFileName

    if (-not (Test-Path -LiteralPath $pthPath)) {
        throw "Expected python._pth file not found: $pthPath"
    }

    $pthContent = @"
python$($versionParts[0])$($versionParts[1]).zip
.
Lib
Lib/site-packages
import site
"@
    Write-Utf8NoBomFile -Path $pthPath -Content $pthContent

    Write-Host "Installing pip (ensurepip or get-pip.py fallback)"
    $ensurepipAvailable = $true
    try {
        Invoke-CheckedCommand -FilePath $pythonExecutable -Arguments @("-c", "import ensurepip; print('ensurepip available')")
    }
    catch {
        $ensurepipAvailable = $false
        Write-Host "ensurepip not available in this embeddable build, will use get-pip.py"
    }

    if ($ensurepipAvailable) {
        Invoke-CheckedCommand -FilePath $pythonExecutable -Arguments @("-m", "ensurepip", "--upgrade", "--default-pip")
    }
    else {
        # Download get-pip.py and run it with the embedded Python itself
        # so that pip is installed into the embedded Python's site-packages.
        $getPipPath = Join-Path $pythonCache "get-pip.py"
        Write-Host "Downloading get-pip.py"
        $getPipUrl = "https://bootstrap.pypa.io/get-pip.py"
        Invoke-WebRequest -Uri $getPipUrl -OutFile $getPipPath

        Write-Host "Installing pip via get-pip.py using embedded Python"
        Invoke-CheckedCommand -FilePath $pythonExecutable -Arguments @($getPipPath)

        # Remove get-pip.py to keep the runtime clean
        Remove-Item -LiteralPath $getPipPath -Force
    }
    # Install pre-bundled pip packages declared in runtime-manifest.json
    if ($manifest.python.pipPackages -and $manifest.python.pipPackages.Count -gt 0) {
        Write-Host "Installing pre-bundled pip packages: $($manifest.python.pipPackages -join ', ')"
        foreach ($packageName in $manifest.python.pipPackages) {
            Write-Host "  Installing $packageName"
            Invoke-CheckedCommand -FilePath $pythonExecutable -Arguments @("-m", "pip", "install", $packageName)
        }
    }
}

if ($Force -or -not (Test-Path -LiteralPath $nodeExecutable)) {
    Write-Host "Staging Node runtime from $nodeArchive"
    Reset-Directory -Path $nodeExtractTemp
    Reset-Directory -Path $nodeCache
    Expand-Archive -LiteralPath $nodeArchive -DestinationPath $nodeExtractTemp -Force
    $nodeRoot = Get-ChildItem -Path $nodeExtractTemp -Directory | Select-Object -First 1
    if ($null -eq $nodeRoot) {
        throw "Could not find extracted Node.js directory under $nodeExtractTemp"
    }

    Copy-Item -Path (Join-Path $nodeRoot.FullName "*") -Destination $nodeCache -Recurse -Force
}

Write-Host "Pruning staged Python site-packages"
# Collect the names of all installed packages (including transitive dependencies)
# so that the prune step does not remove any package that pip pulled in.
# We use both pip freeze names (for dist-info matching) and a Python helper
# that resolves the actual top-level module names (for package directory matching),
# because pip install names often differ from the module directory names
# (e.g. Pillow -> PIL, python-docx -> docx, PyYAML -> yaml).
Write-Host "  Collecting installed package list via pip freeze"
$pipFreezeOutput = & $pythonExecutable -m pip freeze 2>$null
if ($LASTEXITCODE -ne 0) {
    throw "pip freeze failed with exit code ${LASTEXITCODE}"
}
$installedPackages = @()
foreach ($line in ($pipFreezeOutput -split "`r?`n")) {
    $line = $line.Trim()
    if ($line -match "^([A-Za-z0-9_.-]+)") {
        $installedPackages += $Matches[1]
    }
}
# Also collect top-level module names from package metadata
$topLevelModules = & $pythonExecutable -c @"
import importlib.metadata, sys
for dist in importlib.metadata.distributions():
    try:
        files = dist.files
    except Exception:
        continue
    for f in (files or []):
        parts = f.parts
        if len(parts) >= 2 and parts[0].endswith('.dist-info'):
            top = parts[1]
            if not top.startswith('_') and not top.endswith('.py'):
                print(top)
                break
"@ 2>$null
foreach ($mod in ($topLevelModules -split "`r?`n")) {
    $mod = $mod.Trim()
    if ($mod -and $mod -match "^[A-Za-z0-9_]+$" -and $installedPackages -notcontains $mod) {
        $installedPackages += $mod
    }
}
Write-Host "  Keeping $($installedPackages.Count) installed packages/modules during prune"
Prune-PythonSitePackages -PythonRoot $pythonCache -ExtraKeepPatterns $installedPackages

Write-Host "Verifying staged Python runtime"
Invoke-CheckedCommand -FilePath $pythonExecutable -Arguments @("--version")
Invoke-CheckedCommand -FilePath $pythonExecutable -Arguments @("-m", "pip", "--version")

Write-Host "Verifying staged Node runtime"
Invoke-CheckedCommand -FilePath $nodeExecutable -Arguments @("--version")
Invoke-CheckedCommand -FilePath (Join-Path $nodeCache "npm.cmd") -Arguments @("--version")
Invoke-CheckedCommand -FilePath (Join-Path $nodeCache "npx.cmd") -Arguments @("--version")

Write-Host "Syncing staged runtimes into the repository"
Sync-Directory -Source $pythonCache -Destination $pythonStage
Sync-Directory -Source $nodeCache -Destination $nodeStage
Sync-Directory -Source $pythonCache -Destination $pythonResource
Sync-Directory -Source $nodeCache -Destination $nodeResource

Write-Host "Prepared embedded runtimes successfully."
