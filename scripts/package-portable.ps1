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
$releaseExecutable = Get-ReleaseExecutablePath
$compiledSidecar = Join-Path $projectRoot "src-tauri/target/release/$($manifest.build.backendSidecarBaseName).exe"
$portableResources = Get-PortableResourcesPath
$iconSource = Join-Path $projectRoot "src-tauri/icons/icon.ico"
$releaseRoot = Get-PortableReleaseRoot -Version $releaseVersion
$fullPortableParent = Get-PortableVariantRoot -Version $releaseVersion -Variant "full"
$fullPortableRoot = Join-Path $fullPortableParent $artifactBaseName
$fullArchivePath = Join-Path $releaseRoot (Get-PortableArchiveFileName -Version $releaseVersion -Variant "full")
$noRuntimePortableParent = Get-PortableVariantRoot -Version $releaseVersion -Variant "no_runtime"
$noRuntimePortableRoot = Join-Path $noRuntimePortableParent $artifactBaseName
$noRuntimeArchivePath = Join-Path $releaseRoot (Get-PortableArchiveFileName -Version $releaseVersion -Variant "no_runtime")

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
Ensure-Directory -Path $fullPortableRoot
Ensure-Directory -Path $noRuntimePortableRoot

foreach ($portableRoot in @($fullPortableRoot, $noRuntimePortableRoot)) {
    Copy-Item -LiteralPath $releaseExecutable -Destination (Join-Path $portableRoot (Split-Path $releaseExecutable -Leaf)) -Force
    Copy-Item -LiteralPath $compiledSidecar -Destination (Join-Path $portableRoot (Split-Path $compiledSidecar -Leaf)) -Force
    Ensure-Directory -Path (Join-Path $portableRoot "resources")
}

# Copy contents of portableResources (src-tauri/resources) into the
# destination "resources" directory so that runtimes/ appears directly
# under tauri_agent/resources/ — not under resources/resources/.
Get-ChildItem -LiteralPath $portableResources | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $fullPortableRoot "resources" $_.Name) -Recurse -Force
}

$noRuntimeResources = Join-Path $noRuntimePortableRoot "resources"
Get-ChildItem -LiteralPath $portableResources | ForEach-Object {
    if ($_.Name -ne "runtimes") {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $noRuntimeResources $_.Name) -Recurse -Force
    }
}

if (Test-Path -LiteralPath $iconSource) {
    Copy-Item -LiteralPath $iconSource -Destination (Join-Path $fullPortableRoot "resources/icon.ico") -Force
    Copy-Item -LiteralPath $iconSource -Destination (Join-Path $noRuntimePortableRoot "resources/icon.ico") -Force
}

foreach ($archivePath in @($fullArchivePath, $noRuntimeArchivePath)) {
    if (Test-Path -LiteralPath $archivePath) {
        Remove-Item -LiteralPath $archivePath -Force
    }
}

Compress-Archive -Path $fullPortableRoot -DestinationPath $fullArchivePath -CompressionLevel Optimal
Compress-Archive -Path $noRuntimePortableRoot -DestinationPath $noRuntimeArchivePath -CompressionLevel Optimal

foreach ($archivePath in @($fullArchivePath, $noRuntimeArchivePath)) {
    if (-not (Test-Path -LiteralPath $archivePath)) {
        throw "Portable archive was not created: $archivePath"
    }
}

Write-Host "Portable ZIP packaged at $fullArchivePath"
Write-Host "Portable ZIP packaged at $noRuntimeArchivePath"
