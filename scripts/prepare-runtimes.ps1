param(
    [string]$VendorRoot,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "common.ps1")

function Get-InstalledPythonRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Version
    )

    $versionParts = $Version.Split(".")
    if ($versionParts.Length -lt 2) {
        throw "Python version '$Version' is not in the expected major.minor.patch format."
    }

    $folderName = "Python{0}{1}" -f $versionParts[0], $versionParts[1]
    $installedRoot = Join-Path $env:LocalAppData "Programs\\Python\\$folderName"
    if (-not (Test-Path -LiteralPath (Join-Path $installedRoot "python.exe"))) {
        throw "Python installer finished, but no usable runtime was found at $installedRoot"
    }

    return $installedRoot
}

$projectRoot = Get-ProjectRoot
$manifest = Get-RuntimeManifest
$resolvedVendorRoot = Resolve-VendorRoot -VendorRoot $VendorRoot

$pythonInstaller = Find-RequiredFile -Root $resolvedVendorRoot -FileName $manifest.python.installer
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
    Write-Host "Staging Python runtime from $pythonInstaller"
    Reset-Directory -Path $pythonCache
    $pythonArgs = @(
        "/quiet",
        "InstallAllUsers=0",
        "TargetDir=$pythonCache",
        "Include_pip=1",
        "Include_launcher=0",
        "Include_test=0",
        "Include_tcltk=0",
        "Include_doc=0",
        "AssociateFiles=0",
        "Shortcuts=0",
        "PrependPath=0"
    )
    Invoke-CheckedProcess -FilePath $pythonInstaller -ArgumentList $pythonArgs

    if (-not (Test-Path -LiteralPath $pythonExecutable)) {
        $installedPythonRoot = Get-InstalledPythonRoot -Version $manifest.python.version
        Write-Host "Python installer used its default location. Syncing from $installedPythonRoot"
        Sync-Directory -Source $installedPythonRoot -Destination $pythonCache
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
