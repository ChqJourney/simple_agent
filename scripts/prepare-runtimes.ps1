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

    Write-Host "Installing pip via ensurepip"
    Invoke-CheckedCommand -FilePath $pythonExecutable -Arguments @("-m", "ensurepip", "--upgrade", "--default-pip")
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
Prune-PythonSitePackages -PythonRoot $pythonCache

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
