param(
    [string]$Version,
    [string]$VendorRoot,
    [switch]$SkipRuntimePrepare,
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

if (-not $SkipPortablePackage) {
    $portableArgs = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "package-portable.ps1"), "-Version", $releaseVersion)
    if (-not [string]::IsNullOrWhiteSpace($VendorRoot)) {
        $portableArgs += @("-VendorRoot", $VendorRoot)
    }

    Invoke-CheckedCommand -FilePath "powershell" -Arguments $portableArgs
}

Write-Host "Release pipeline completed for version $releaseVersion"
