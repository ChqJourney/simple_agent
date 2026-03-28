param(
    [string]$Version,
    [string]$VendorRoot,
    [switch]$SkipAppBuild
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
$appName = Get-AppName
$artifactBaseName = Get-SafeArtifactName -Name $appName
$portableAppExecutableName = Get-PortableAppExecutableFileName
$releaseExecutable = Get-ReleaseExecutablePath
$compiledSidecar = Join-Path $projectRoot "src-tauri/target/release/$($manifest.build.backendSidecarBaseName).exe"
$portableResources = Get-PortableResourcesPath
$iconSource = Join-Path $projectRoot "src-tauri/icons/icon.ico"
$releaseRoot = Get-PortableReleaseRoot -Version $releaseVersion
$portableRoot = Join-Path $releaseRoot $artifactBaseName
$archivePath = Join-Path $releaseRoot (Get-PortableArchiveFileName -Version $releaseVersion)

if (-not $SkipAppBuild) {
    $buildArgs = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "package-app.ps1"), "-Version", $releaseVersion)
    if (-not [string]::IsNullOrWhiteSpace($VendorRoot)) {
        $buildArgs += @("-VendorRoot", $VendorRoot)
    }

    Invoke-CheckedCommand -FilePath "powershell" -Arguments $buildArgs
}

if (-not (Test-Path -LiteralPath $releaseExecutable)) {
    throw "Compiled app executable is missing: $releaseExecutable"
}

if (-not (Test-Path -LiteralPath $compiledSidecar)) {
    throw "Compiled backend sidecar is missing: $compiledSidecar"
}

if (-not (Test-Path -LiteralPath $portableResources)) {
    throw "Portable resources directory is missing: $portableResources"
}

Ensure-Directory -Path (Split-Path $releaseRoot -Parent)
Reset-Directory -Path $releaseRoot
Ensure-Directory -Path $portableRoot
Copy-Item -LiteralPath $releaseExecutable -Destination (Join-Path $portableRoot $portableAppExecutableName) -Force
Copy-Item -LiteralPath $compiledSidecar -Destination (Join-Path $portableRoot (Split-Path $compiledSidecar -Leaf)) -Force
Ensure-Directory -Path (Join-Path $portableRoot "resources")

$runtimeRoot = Join-Path $portableRoot "runtimes"
$resourceRoot = Join-Path $portableRoot "resources"

Get-ChildItem -LiteralPath $portableResources -Force | ForEach-Object {
    if ($_.Name -eq "runtimes") {
        Ensure-Directory -Path $runtimeRoot
        Get-ChildItem -LiteralPath $_.FullName -Force | ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $runtimeRoot $_.Name) -Recurse -Force
        }
    }
    else {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $resourceRoot $_.Name) -Recurse -Force
    }
}

if (Test-Path -LiteralPath $iconSource) {
    Copy-Item -LiteralPath $iconSource -Destination (Join-Path $portableRoot "resources/icon.ico") -Force
}

if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
}

Compress-Archive -Path $portableRoot -DestinationPath $archivePath -CompressionLevel Optimal

if (-not (Test-Path -LiteralPath $archivePath)) {
    throw "Portable archive was not created: $archivePath"
}

Write-Host "Portable ZIP packaged at $archivePath"
