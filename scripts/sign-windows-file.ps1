param(
    [Parameter(Mandatory = $true)]
    [string]$Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "common.ps1")

if (-not (Test-WindowsCodeSigningConfigured)) {
    throw "Windows code signing is not configured. Set TAURI_AGENT_WINDOWS_SIGNTOOL_PATH and a certificate selector before invoking this script."
}

Invoke-WindowsCodeSignFile -Path $Path
