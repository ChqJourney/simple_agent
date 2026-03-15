param(
    [string]$Version
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "common.ps1")

Sync-ReleaseMetadata -Version $Version

Write-Host ("Synchronized release metadata to version {0}" -f (Get-ReleaseVersion))
