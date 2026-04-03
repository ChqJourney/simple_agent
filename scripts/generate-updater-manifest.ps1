param(
    [string]$Version,
    [string]$BaseUrl,
    [string]$ReleaseNotes
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "common.ps1")

$releaseVersion = Get-ReleaseVersion -Version $Version
$resolvedBaseUrl = Get-UpdaterBaseUrl -BaseUrl $BaseUrl

if ([string]::IsNullOrWhiteSpace($resolvedBaseUrl)) {
    throw "Updater base URL is required. Pass -BaseUrl or set TAURI_AGENT_UPDATER_BASE_URL."
}

$bundleRoot = Get-BundledReleaseRoot -Version $releaseVersion
if (-not (Test-Path -LiteralPath $bundleRoot)) {
    throw "Bundled release root does not exist: $bundleRoot"
}

$installer = Find-UpdaterNsisInstaller -BundleRoot $bundleRoot
$signatureInfo = Read-UpdaterSignature -InstallerPath $installer.FullName
$installerRelativePath = Get-RelativePathNormalized -Root $bundleRoot -Path $installer.FullName
$notes = Get-UpdaterReleaseNotes -ReleaseNotes $ReleaseNotes
$publishDate = Get-UpdaterPublishDate

$manifest = New-UpdaterManifestObject `
    -Version $releaseVersion `
    -BaseUrl $resolvedBaseUrl `
    -InstallerRelativePath $installerRelativePath `
    -Signature $signatureInfo.signature `
    -ReleaseNotes $notes `
    -PublishDate $publishDate

$latestManifestPath = Join-Path $bundleRoot "latest.json"
Write-JsonFile -Path $latestManifestPath -Value $manifest

$versionedManifestPath = Join-Path $bundleRoot ("{0}.json" -f $releaseVersion)
Write-JsonFile -Path $versionedManifestPath -Value $manifest

Write-Host "Updater manifest generated at $latestManifestPath"
Write-Host "Versioned updater manifest generated at $versionedManifestPath"
Write-Host "Installer URL: $(Join-UrlPath -BaseUrl $resolvedBaseUrl -RelativePath $installerRelativePath)"
