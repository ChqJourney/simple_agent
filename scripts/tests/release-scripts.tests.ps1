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
$portableFileName = Get-PortableArchiveFileName -Version $releaseVersion -Variant "full"
$expectedPortableFileName = "{0}_{1}_windows_x64.zip" -f (Get-SafeArtifactName -Name (Get-AppName)), $releaseVersion
Assert-Equal -Actual $portableFileName -Expected $expectedPortableFileName -Message "Portable archive name should be derived from release metadata."

$noRuntimePortableFileName = Get-PortableArchiveFileName -Version $releaseVersion -Variant "no_runtime"
$expectedNoRuntimePortableFileName = "{0}_{1}_windows_x64_no_runtime.zip" -f (Get-SafeArtifactName -Name (Get-AppName)), $releaseVersion
Assert-Equal -Actual $noRuntimePortableFileName -Expected $expectedNoRuntimePortableFileName -Message "No-runtime portable archive name should be derived from release metadata."

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

$noRuntimePortableRoot = Get-PortableVariantRoot -Version $releaseVersion -Variant "no_runtime"
$expectedNoRuntimePortableRoot = Join-Path $projectRoot "artifacts/release/$releaseVersion/portable/no_runtime"
Assert-Equal -Actual $noRuntimePortableRoot -Expected $expectedNoRuntimePortableRoot -Message "No-runtime portable root should live under its dedicated variant directory."

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
