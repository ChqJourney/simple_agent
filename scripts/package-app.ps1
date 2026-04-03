param(
    [string]$Version,
    [string]$VendorRoot,
    [switch]$SkipBackendBuild,
    [switch]$Bundle
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "common.ps1")

$projectRoot = Get-ProjectRoot
$syncArgs = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "sync-release-metadata.ps1"))
if (-not [string]::IsNullOrWhiteSpace($Version)) {
    $syncArgs += @("-Version", $Version)
}

Invoke-CheckedCommand -FilePath "powershell" -Arguments $syncArgs

$manifest = Get-RuntimeManifest
$releaseVersion = Get-ReleaseVersion
$legacyReleaseRoot = Get-LegacyReleaseArtifactsRoot
$sidecarPath = Join-Path $projectRoot "src-tauri/binaries/$($manifest.build.backendSidecarBaseName)-x86_64-pc-windows-msvc.exe"
$pythonResources = Join-Path $projectRoot "src-tauri/resources/runtimes/python"
$nodeResources = Join-Path $projectRoot "src-tauri/resources/runtimes/node"
$portableResources = Get-PortableResourcesPath
$releaseExecutable = Get-ReleaseExecutablePath
$compiledSidecar = Join-Path $projectRoot "src-tauri/target/release/$($manifest.build.backendSidecarBaseName).exe"

if ((-not (Test-Path -LiteralPath $pythonResources) -or -not (Test-Path -LiteralPath $nodeResources)) -and -not [string]::IsNullOrWhiteSpace($VendorRoot)) {
    $prepareArgs = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "prepare-runtimes.ps1"), "-VendorRoot", $VendorRoot)
    Invoke-CheckedCommand -FilePath "powershell" -Arguments $prepareArgs
}

Remove-LegacyReleaseArtifactsRoot -Path $legacyReleaseRoot

if (-not $SkipBackendBuild -and -not (Test-Path -LiteralPath $sidecarPath)) {
    $buildArgs = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "build-backend.ps1"))
    if (-not [string]::IsNullOrWhiteSpace($VendorRoot)) {
        $buildArgs += @("-VendorRoot", $VendorRoot)
    }

    Invoke-CheckedCommand -FilePath "powershell" -Arguments $buildArgs
}

if (-not (Test-Path -LiteralPath $sidecarPath)) {
    throw "Backend sidecar is missing: $sidecarPath"
}

if (-not (Test-Path -LiteralPath $pythonResources) -or -not (Test-Path -LiteralPath $nodeResources)) {
    throw "Embedded runtime resources are missing. Run scripts/prepare-runtimes.ps1 first."
}

Invoke-CheckedCommand -FilePath "npm" -Arguments @("run", "build") -WorkingDirectory $projectRoot
$originalCargoBuildJobs = $env:CARGO_BUILD_JOBS
$env:CARGO_BUILD_JOBS = "1"
$buildOverrideConfigPath = $null

try {
    $tauriBuildArgs = @("run", "tauri", "build", "--")

    if (-not $Bundle) {
        $tauriBuildArgs += "--no-bundle"
    }
    else {
        $buildOverrideConfigPath = New-TauriBuildConfigOverrideFile
        if ($null -ne $buildOverrideConfigPath) {
            Write-Host "Using generated Tauri build override config: $buildOverrideConfigPath"
            $tauriBuildArgs += @("--config", $buildOverrideConfigPath)
        }
        else {
            Write-Host "No temporary Tauri build overrides were generated; building NSIS installer with repository defaults."
        }
    }

    Invoke-CheckedCommand -FilePath "npm" -Arguments $tauriBuildArgs -WorkingDirectory $projectRoot
}
finally {
    if ($null -ne $buildOverrideConfigPath) {
        $buildOverrideConfigDir = Split-Path -Parent $buildOverrideConfigPath
        if (Test-Path -LiteralPath $buildOverrideConfigDir) {
            Remove-Item -LiteralPath $buildOverrideConfigDir -Recurse -Force
        }
    }

    if ($null -eq $originalCargoBuildJobs) {
        Remove-Item Env:CARGO_BUILD_JOBS -ErrorAction SilentlyContinue
    }
    else {
        $env:CARGO_BUILD_JOBS = $originalCargoBuildJobs
    }
}

if (-not (Test-Path -LiteralPath $releaseExecutable)) {
    throw "Could not find compiled app executable: $releaseExecutable"
}

if (-not (Test-Path -LiteralPath $compiledSidecar)) {
    throw "Could not find compiled backend sidecar: $compiledSidecar"
}

if (-not (Test-Path -LiteralPath $portableResources)) {
    throw "Could not find portable resources directory: $portableResources"
}

if (-not $Bundle) {
    Invoke-WindowsCodeSignFiles -Paths @(
        $releaseExecutable,
        $compiledSidecar
    )
}

Write-Host "App compiled for release version $releaseVersion"
Write-Host "Executable: $releaseExecutable"

if ($Bundle) {
    $bundleOutputRoot = Get-WindowsBundleOutputRoot
    if (-not (Test-Path -LiteralPath $bundleOutputRoot)) {
        throw "Could not find Tauri bundle output directory: $bundleOutputRoot"
    }

    $bundleReleaseRoot = Get-BundledReleaseRoot -Version $releaseVersion
    Ensure-Directory -Path (Split-Path $bundleReleaseRoot -Parent)
    Reset-Directory -Path $bundleReleaseRoot
    Get-ChildItem -LiteralPath $bundleOutputRoot -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $bundleReleaseRoot $_.Name) -Recurse -Force
    }

    Write-Host "Bundled installer artifacts copied to $bundleReleaseRoot"
}
