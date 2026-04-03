Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "..\common.ps1")

function Assert-Equal {
    param(
        [Parameter(Mandatory = $true)]
        $Actual,
        [Parameter(Mandatory = $true)]
        $Expected,
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    if ($Actual -ne $Expected) {
        throw "$Message`nExpected: $Expected`nActual: $Actual"
    }
}

function Assert-True {
    param(
        [Parameter(Mandatory = $true)]
        [bool]$Condition,
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

$projectRoot = Get-ProjectRoot
$releaseVersion = "9.9.9"
$portableFileName = Get-PortableArchiveFileName -Version $releaseVersion
$expectedPortableFileName = "{0}_{1}_windows_x64.zip" -f (Get-SafeArtifactName -Name (Get-AppName)), $releaseVersion
Assert-Equal -Actual $portableFileName -Expected $expectedPortableFileName -Message "Portable archive name should be derived from release metadata."

$portableExecutableName = Get-PortableAppExecutableFileName
Assert-Equal -Actual $portableExecutableName -Expected "work agent.exe" -Message "Portable app executable should preserve the user-facing product name."

$releaseExecutable = Get-ReleaseExecutablePath
$expectedExecutable = Join-Path $projectRoot ("src-tauri/target/release/{0}.exe" -f (Get-BinaryBaseName))
Assert-Equal -Actual $releaseExecutable -Expected $expectedExecutable -Message "Release executable path should resolve from package metadata."

Assert-True -Condition (Test-Path -LiteralPath (Split-Path $releaseExecutable -Parent)) -Message "Release executable directory should exist."

$portableResourcesPath = Get-PortableResourcesPath
$expectedPortableResourcesPath = Join-Path $projectRoot "src-tauri/resources"
Assert-Equal -Actual $portableResourcesPath -Expected $expectedPortableResourcesPath -Message "Portable packaging should source resources from the repository staging directory."

$portableReleaseRoot = Get-PortableReleaseRoot -Version $releaseVersion
$expectedPortableReleaseRoot = Join-Path $projectRoot "artifacts/release/$releaseVersion/portable"
Assert-Equal -Actual $portableReleaseRoot -Expected $expectedPortableReleaseRoot -Message "Portable release root should live outside the frontend dist directory."

$bundleReleaseRoot = Get-BundledReleaseRoot -Version $releaseVersion
$expectedBundleReleaseRoot = Join-Path $projectRoot "artifacts/release/$releaseVersion/bundle"
Assert-Equal -Actual $bundleReleaseRoot -Expected $expectedBundleReleaseRoot -Message "Bundled release root should live alongside portable artifacts."

$bundleOutputRoot = Get-WindowsBundleOutputRoot
$expectedBundleOutputRoot = Join-Path $projectRoot "src-tauri/target/release/bundle"
Assert-Equal -Actual $bundleOutputRoot -Expected $expectedBundleOutputRoot -Message "Windows bundle output root should resolve from the Tauri target directory."

$joinedUrl = Join-UrlPath -BaseUrl "https://updates.example.com/work-agent/" -RelativePath "nsis\\setup.exe"
Assert-Equal -Actual $joinedUrl -Expected "https://updates.example.com/work-agent/nsis/setup.exe" -Message "Joined updater URLs should normalize separators."

$relativePath = Get-RelativePathNormalized -Root "/tmp/work-agent" -Path "/tmp/work-agent/nsis/setup.exe"
Assert-Equal -Actual $relativePath -Expected "nsis/setup.exe" -Message "Relative updater artifact paths should be normalized to forward slashes."

$legacyArtifactsRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("tauri-agent-legacy-release-" + [System.Guid]::NewGuid().ToString("N"))
$legacyMarker = Join-Path $legacyArtifactsRoot "portable/stale.txt"
New-Item -ItemType Directory -Path (Split-Path $legacyMarker -Parent) -Force | Out-Null
Set-Content -LiteralPath $legacyMarker -Value "stale"

try {
    Remove-LegacyReleaseArtifactsRoot -Path $legacyArtifactsRoot
    Assert-True -Condition (-not (Test-Path -LiteralPath $legacyArtifactsRoot)) -Message "Legacy dist/release roots should be removed before frontend builds."
}
finally {
    if (Test-Path -LiteralPath $legacyArtifactsRoot) {
        Remove-Item -LiteralPath $legacyArtifactsRoot -Recurse -Force
    }
}

$metadataTempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("tauri-agent-metadata-tests-" + [System.Guid]::NewGuid().ToString("N"))
$tempPackageJson = Join-Path $metadataTempRoot "package.json"
$tempTauriConf = Join-Path $metadataTempRoot "tauri.conf.json"
$tempCargoToml = Join-Path $metadataTempRoot "Cargo.toml"
New-Item -ItemType Directory -Path $metadataTempRoot -Force | Out-Null
Set-Content -LiteralPath $tempPackageJson -Value @'
{
  "name": "internal_package",
  "version": "1.2.3"
}
'@
Set-Content -LiteralPath $tempTauriConf -Value @'
{
  "productName": "Renamed App",
  "version": "0.0.1",
  "app": {
    "windows": [
      {
        "title": "Old Title"
      }
    ]
  }
}
'@
Set-Content -LiteralPath $tempCargoToml -Value @'
[package]
name = "internal_package"
version = "0.0.1"

[lib]
name = "internal_package_lib"
'@

try {
    Sync-ReleaseMetadata -PackageJsonPath $tempPackageJson -TauriConfigPath $tempTauriConf -CargoTomlPath $tempCargoToml

    $syncedTauri = Get-Content -Raw $tempTauriConf | ConvertFrom-Json
    $syncedCargo = Get-Content -Raw $tempCargoToml

    Assert-Equal -Actual $syncedTauri.version -Expected "1.2.3" -Message "Tauri version should sync from package.json."
    Assert-Equal -Actual $syncedTauri.app.windows[0].title -Expected "Renamed App" -Message "Tauri window title should sync from productName."
    Assert-True -Condition ($syncedCargo -match 'version = "1.2.3"') -Message "Cargo version should sync from package.json."
}
finally {
    if (Test-Path -LiteralPath $metadataTempRoot) {
        Remove-Item -LiteralPath $metadataTempRoot -Recurse -Force
    }
}

$previousUpdaterEndpoints = $env:TAURI_AGENT_UPDATER_ENDPOINTS
$previousUpdaterPubKey = $env:TAURI_AGENT_UPDATER_PUBKEY
$previousSigningPrivateKey = $env:TAURI_SIGNING_PRIVATE_KEY
$previousWindowsSignToolPath = $env:TAURI_AGENT_WINDOWS_SIGNTOOL_PATH
$previousWindowsSignCertFile = $env:TAURI_AGENT_WINDOWS_SIGN_CERT_FILE
$previousWindowsSignCertPassword = $env:TAURI_AGENT_WINDOWS_SIGN_CERT_PASSWORD
$previousWindowsSignThumbprint = $env:TAURI_AGENT_WINDOWS_SIGN_CERT_THUMBPRINT
$previousWindowsSignSubject = $env:TAURI_AGENT_WINDOWS_SIGN_CERT_SUBJECT
$previousWindowsSignTimestampUrl = $env:TAURI_AGENT_WINDOWS_SIGN_TIMESTAMP_URL

$windowsSignTempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("tauri-agent-signing-tests-" + [System.Guid]::NewGuid().ToString("N"))
$windowsSignTool = Join-Path $windowsSignTempRoot "signtool.exe"
$windowsCertFile = Join-Path $windowsSignTempRoot "codesign.pfx"
New-Item -ItemType Directory -Path $windowsSignTempRoot -Force | Out-Null
Set-Content -LiteralPath $windowsSignTool -Value "stub"
Set-Content -LiteralPath $windowsCertFile -Value "stub"

try {
    $env:TAURI_AGENT_UPDATER_ENDPOINTS = "https://updates.example.com/latest.json;https://backup.example.com/latest.json"
    $env:TAURI_AGENT_UPDATER_PUBKEY = "PUBLIC_KEY"
    $env:TAURI_SIGNING_PRIVATE_KEY = ""
    $env:TAURI_AGENT_WINDOWS_SIGNTOOL_PATH = $windowsSignTool
    $env:TAURI_AGENT_WINDOWS_SIGN_CERT_FILE = $windowsCertFile
    $env:TAURI_AGENT_WINDOWS_SIGN_CERT_PASSWORD = "secret"
    $env:TAURI_AGENT_WINDOWS_SIGN_TIMESTAMP_URL = "https://timestamp.example.com"

    Assert-True -Condition (Test-UpdaterConfigInputsAvailable) -Message "Updater config inputs should be detected from environment variables."
    Assert-True -Condition (-not (Test-TauriUpdaterArtifactSigningConfigured)) -Message "Updater signing should remain disabled without a signing key."
    Assert-True -Condition (Test-WindowsCodeSigningConfigured) -Message "Windows code signing should be detected from environment variables."

    $signingConfig = Get-WindowsCodeSigningConfig
    Assert-Equal -Actual $signingConfig.signToolPath -Expected $windowsSignTool -Message "Configured signtool path should be resolved from environment."
    Assert-Equal -Actual $signingConfig.certificateFile -Expected $windowsCertFile -Message "Configured certificate path should be resolved from environment."

    $signArguments = New-WindowsCodeSigningArguments -FilePath "C:\temp\work-agent.exe" -Config $signingConfig
    Assert-True -Condition ($signArguments -contains "/tr") -Message "Windows signing arguments should include timestamping when configured."
    Assert-True -Condition ($signArguments -contains $windowsCertFile) -Message "Windows signing arguments should include the certificate path."

    $generatedBuildConfig = New-TauriBuildConfigOverrideFile
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace($generatedBuildConfig)) -Message "A temporary Tauri build config file should be generated when updater or signing env vars are present."

    $buildConfig = Get-Content -Raw -LiteralPath $generatedBuildConfig | ConvertFrom-Json
    Assert-Equal -Actual $buildConfig.plugins.updater.pubkey -Expected "PUBLIC_KEY" -Message "Updater public key should be written into the generated config."
    Assert-Equal -Actual $buildConfig.plugins.updater.endpoints.Count -Expected 2 -Message "Updater endpoints should be parsed into an array."
    Assert-True -Condition ($null -eq $buildConfig.bundle.createUpdaterArtifacts) -Message "Updater artifacts should not be enabled without a Tauri signing key."
    Assert-Equal -Actual $buildConfig.bundle.windows.signCommand.cmd -Expected "powershell" -Message "Windows sign command should run through PowerShell."
    Assert-True -Condition ($buildConfig.bundle.windows.signCommand.args -contains "%1") -Message "Windows sign command should preserve the %1 placeholder for Tauri."

    Remove-Item -LiteralPath (Split-Path -Parent $generatedBuildConfig) -Recurse -Force
}
finally {
    $env:TAURI_AGENT_UPDATER_ENDPOINTS = $previousUpdaterEndpoints
    $env:TAURI_AGENT_UPDATER_PUBKEY = $previousUpdaterPubKey
    $env:TAURI_SIGNING_PRIVATE_KEY = $previousSigningPrivateKey
    $env:TAURI_AGENT_WINDOWS_SIGNTOOL_PATH = $previousWindowsSignToolPath
    $env:TAURI_AGENT_WINDOWS_SIGN_CERT_FILE = $previousWindowsSignCertFile
    $env:TAURI_AGENT_WINDOWS_SIGN_CERT_PASSWORD = $previousWindowsSignCertPassword
    $env:TAURI_AGENT_WINDOWS_SIGN_CERT_THUMBPRINT = $previousWindowsSignThumbprint
    $env:TAURI_AGENT_WINDOWS_SIGN_CERT_SUBJECT = $previousWindowsSignSubject
    $env:TAURI_AGENT_WINDOWS_SIGN_TIMESTAMP_URL = $previousWindowsSignTimestampUrl
    if (Test-Path -LiteralPath $windowsSignTempRoot) {
        Remove-Item -LiteralPath $windowsSignTempRoot -Recurse -Force
    }
}

$previousUpdaterBaseUrl = $env:TAURI_AGENT_UPDATER_BASE_URL
$previousUpdaterNotes = $env:TAURI_AGENT_UPDATER_NOTES
$previousUpdaterPubDate = $env:TAURI_AGENT_UPDATER_PUB_DATE

try {
    $env:TAURI_AGENT_UPDATER_BASE_URL = "https://updates.example.com/work-agent"
    $env:TAURI_AGENT_UPDATER_NOTES = "Bug fixes and updater support."
    $env:TAURI_AGENT_UPDATER_PUB_DATE = "2026-04-03T00:00:00Z"

    $resolvedUpdaterBaseUrl = Get-UpdaterBaseUrl
    Assert-Equal -Actual $resolvedUpdaterBaseUrl -Expected "https://updates.example.com/work-agent" -Message "Updater base URL should be resolved from environment."

    $updaterNotes = Get-UpdaterReleaseNotes
    Assert-Equal -Actual $updaterNotes -Expected "Bug fixes and updater support." -Message "Updater release notes should be resolved from environment."

    $updaterManifest = New-UpdaterManifestObject -Version "1.2.3" -BaseUrl $resolvedUpdaterBaseUrl -InstallerRelativePath "nsis/setup.exe" -Signature "SIGNATURE" -ReleaseNotes $updaterNotes -PublishDate (Get-UpdaterPublishDate)
    Assert-Equal -Actual $updaterManifest.version -Expected "1.2.3" -Message "Updater manifest version should match the requested release."
    Assert-Equal -Actual $updaterManifest.platforms["windows-x86_64"].url -Expected "https://updates.example.com/work-agent/nsis/setup.exe" -Message "Updater manifest URL should be built from the base URL and relative installer path."
    Assert-Equal -Actual $updaterManifest.platforms["windows-x86_64"].signature -Expected "SIGNATURE" -Message "Updater manifest should embed the signature contents."
    Assert-Equal -Actual $updaterManifest.pub_date -Expected "2026-04-03T00:00:00Z" -Message "Updater manifest publish date should be configurable."
}
finally {
    $env:TAURI_AGENT_UPDATER_BASE_URL = $previousUpdaterBaseUrl
    $env:TAURI_AGENT_UPDATER_NOTES = $previousUpdaterNotes
    $env:TAURI_AGENT_UPDATER_PUB_DATE = $previousUpdaterPubDate
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("tauri-agent-tests-" + [System.Guid]::NewGuid().ToString("N"))
$sitePackages = Join-Path $tempRoot "Lib/site-packages"
New-Item -ItemType Directory -Path (Join-Path $sitePackages "pip") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $sitePackages "pip-25.3.dist-info") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $sitePackages "setuptools") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $sitePackages "setuptools-78.1.dist-info") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $sitePackages "torch") -Force | Out-Null

try {
    Prune-PythonSitePackages -PythonRoot $tempRoot

    Assert-True -Condition (Test-Path -LiteralPath (Join-Path $sitePackages "pip")) -Message "pip package should be preserved."
    Assert-True -Condition (Test-Path -LiteralPath (Join-Path $sitePackages "pip-25.3.dist-info")) -Message "pip metadata should be preserved."
    Assert-True -Condition (Test-Path -LiteralPath (Join-Path $sitePackages "setuptools")) -Message "setuptools package should be preserved."
    Assert-True -Condition (Test-Path -LiteralPath (Join-Path $sitePackages "setuptools-78.1.dist-info")) -Message "setuptools metadata should be preserved."
    Assert-True -Condition (-not (Test-Path -LiteralPath (Join-Path $sitePackages "torch"))) -Message "Unrelated third-party packages should be removed."
}
finally {
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
}

Write-Host "release-scripts.tests.ps1 passed"
