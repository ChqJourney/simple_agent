param(
    [string]$Version,
    [string]$VendorRoot,
    [string]$UpdaterBaseUrl,
    [string]$ReleaseNotes,
    [switch]$SkipRuntimePrepare,
    [switch]$SkipInstallerPackage,
    [switch]$SkipPortablePackage
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "common.ps1")

$syncArgs = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "sync-release-metadata.ps1"))
if (-not [string]::IsNullOrWhiteSpace($Version)) {
    $syncArgs += @("-Version", $Version)
}

Invoke-CheckedCommand -FilePath "powershell" -Arguments $syncArgs

$releaseVersion = Get-ReleaseVersion

if (-not $SkipRuntimePrepare) {
    $prepareArgs = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "prepare-runtimes.ps1"))
    if (-not [string]::IsNullOrWhiteSpace($VendorRoot)) {
        $prepareArgs += @("-VendorRoot", $VendorRoot)
    }

    Invoke-CheckedCommand -FilePath "powershell" -Arguments $prepareArgs
}

if (-not $SkipInstallerPackage) {
    $installerArgs = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "package-app.ps1"), "-Version", $releaseVersion, "-Bundle")
    if (-not [string]::IsNullOrWhiteSpace($VendorRoot)) {
        $installerArgs += @("-VendorRoot", $VendorRoot)
    }

    Invoke-CheckedCommand -FilePath "powershell" -Arguments $installerArgs

    $resolvedUpdaterBaseUrl = Get-UpdaterBaseUrl -BaseUrl $UpdaterBaseUrl
    $updaterArtifactSigningConfigured = Test-TauriUpdaterArtifactSigningConfigured

    if (-not [string]::IsNullOrWhiteSpace($resolvedUpdaterBaseUrl) -and $updaterArtifactSigningConfigured) {
        $manifestArgs = @(
            "-ExecutionPolicy", "Bypass",
            "-File", (Join-Path $PSScriptRoot "generate-updater-manifest.ps1"),
            "-Version", $releaseVersion,
            "-BaseUrl", $resolvedUpdaterBaseUrl
        )
        if (-not [string]::IsNullOrWhiteSpace($ReleaseNotes)) {
            $manifestArgs += @("-ReleaseNotes", $ReleaseNotes)
        }

        Invoke-CheckedCommand -FilePath "powershell" -Arguments $manifestArgs
    }
    elseif (-not [string]::IsNullOrWhiteSpace($resolvedUpdaterBaseUrl)) {
        Write-Host "TAURI_SIGNING_PRIVATE_KEY not set; skipping latest.json generation."
    }
    else {
        Write-Host "TAURI_AGENT_UPDATER_BASE_URL not set; skipping latest.json generation."
    }
}

if (-not $SkipPortablePackage) {
    $portableArgs = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "package-portable.ps1"), "-Version", $releaseVersion)
    if (-not [string]::IsNullOrWhiteSpace($VendorRoot)) {
        $portableArgs += @("-VendorRoot", $VendorRoot)
    }

    Invoke-CheckedCommand -FilePath "powershell" -Arguments $portableArgs
}

Write-Host "Release pipeline completed for version $releaseVersion"
