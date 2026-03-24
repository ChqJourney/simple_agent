Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-ProjectRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function Read-JsonFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    return Get-Content -Raw $Path | ConvertFrom-Json
}

function Write-JsonFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [object]$Value
    )

    $json = $Value | ConvertTo-Json -Depth 100
    Write-Utf8NoBomFile -Path $Path -Content $json
}

function Write-Utf8NoBomFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Content
    )

    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Get-PackageJsonPath {
    $projectRoot = Get-ProjectRoot
    return (Join-Path $projectRoot "package.json")
}

function Get-RuntimeManifest {
    $projectRoot = Get-ProjectRoot
    return Read-JsonFile -Path (Join-Path $projectRoot "scripts/runtime-manifest.json")
}

function Get-PackageMetadata {
    return Read-JsonFile -Path (Get-PackageJsonPath)
}

function Get-TauriConfigPath {
    $projectRoot = Get-ProjectRoot
    return (Join-Path $projectRoot "src-tauri/tauri.conf.json")
}

function Get-TauriMetadata {
    return Read-JsonFile -Path (Get-TauriConfigPath)
}

function Get-CargoTomlPath {
    $projectRoot = Get-ProjectRoot
    return (Join-Path $projectRoot "src-tauri/Cargo.toml")
}

function Get-CargoPackageMetadata {
    param(
        [string]$Path = (Get-CargoTomlPath)
    )

    $inPackageSection = $false
    $name = $null
    $version = $null

    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^\s*\[(.+)\]\s*$') {
            $inPackageSection = ($Matches[1] -eq "package")
            continue
        }

        if (-not $inPackageSection) {
            continue
        }

        if ($line -match '^\s*name\s*=\s*"([^"]+)"\s*$') {
            $name = $Matches[1]
            continue
        }

        if ($line -match '^\s*version\s*=\s*"([^"]+)"\s*$') {
            $version = $Matches[1]
            continue
        }
    }

    return [PSCustomObject]@{
        name = $name
        version = $version
    }
}

function Resolve-VendorRoot {
    param(
        [string]$VendorRoot
    )

    $resolved = $VendorRoot
    if ([string]::IsNullOrWhiteSpace($resolved)) {
        $resolved = $env:TAURI_AGENT_VENDOR_ROOT
    }

    if ([string]::IsNullOrWhiteSpace($resolved)) {
        throw "Vendor root is required. Pass -VendorRoot or set TAURI_AGENT_VENDOR_ROOT."
    }

    if (-not (Test-Path -LiteralPath $resolved)) {
        throw "Vendor root does not exist: $resolved"
    }

    return (Resolve-Path $resolved).Path
}

function Ensure-Directory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
}

function Reset-Directory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Recurse -Force
    }

    New-Item -ItemType Directory -Path $Path | Out-Null
}

function Find-RequiredFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root,
        [Parameter(Mandatory = $true)]
        [string]$FileName
    )

    $match = Get-ChildItem -Path $Root -File -Recurse | Where-Object { $_.Name -eq $FileName } | Select-Object -First 1
    if ($null -eq $match) {
        throw "Required file '$FileName' was not found under '$Root'."
    }

    return $match.FullName
}

function Sync-Directory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Source,
        [Parameter(Mandatory = $true)]
        [string]$Destination
    )

    if (-not (Test-Path -LiteralPath $Source)) {
        throw "Source directory does not exist: $Source"
    }

    Reset-Directory -Path $Destination
    Copy-Item -Path (Join-Path $Source "*") -Destination $Destination -Recurse -Force
}

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory
    )

    if ($WorkingDirectory) {
        Push-Location $WorkingDirectory
    }

    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
        }
    }
    finally {
        if ($WorkingDirectory) {
            Pop-Location
        }
    }
}

function Invoke-CheckedProcess {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [string[]]$ArgumentList = @()
    )

    $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -Wait -PassThru -NoNewWindow
    if ($process.ExitCode -ne 0) {
        throw "Process failed with exit code $($process.ExitCode): $FilePath $($ArgumentList -join ' ')"
    }
}

function Get-ReleaseVersion {
    param(
        [string]$Version
    )

    if (-not [string]::IsNullOrWhiteSpace($Version)) {
        return $Version.Trim()
    }

    return (Get-PackageMetadata).version
}

function Get-AppName {
    $tauriMetadata = Get-TauriMetadata
    if (-not [string]::IsNullOrWhiteSpace($tauriMetadata.productName)) {
        return $tauriMetadata.productName
    }

    return (Get-PackageMetadata).name
}

function Get-SafeArtifactName {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $trimmed = $Name.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
        throw "Artifact name cannot be empty."
    }

    return (($trimmed -replace "[^A-Za-z0-9._-]+", "_").Trim("_"))
}

function Get-PortableArchiveFileName {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Version,
        [ValidateSet("full", "no_runtime")]
        [string]$Variant = "full"
    )

    $artifactBaseName = Get-SafeArtifactName -Name (Get-AppName)
    if ($Variant -eq "no_runtime") {
        return "${artifactBaseName}_${Version}_windows_x64_no_runtime.zip"
    }

    return "${artifactBaseName}_${Version}_windows_x64.zip"
}

function Get-BinaryBaseName {
    $cargoPackageMetadata = Get-CargoPackageMetadata
    if (-not [string]::IsNullOrWhiteSpace($cargoPackageMetadata.name)) {
        return $cargoPackageMetadata.name
    }

    return (Get-PackageMetadata).name
}

function Get-ReleaseExecutablePath {
    $projectRoot = Get-ProjectRoot
    $tauriMetadata = Get-TauriMetadata
    $candidates = @()

    $candidates += (Join-Path $projectRoot "src-tauri/target/release/$(Get-BinaryBaseName).exe")

    if (-not [string]::IsNullOrWhiteSpace($tauriMetadata.productName)) {
        $safeProductName = Get-SafeArtifactName -Name $tauriMetadata.productName
        $candidates += (Join-Path $projectRoot "src-tauri/target/release/$safeProductName.exe")
    }

    $existingCandidate = $candidates | Select-Object -Unique | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($null -ne $existingCandidate) {
        return $existingCandidate
    }

    return ($candidates | Select-Object -First 1)
}

function Get-PortableResourcesPath {
    $projectRoot = Get-ProjectRoot
    return (Join-Path $projectRoot "src-tauri/resources")
}

function Get-ReleaseArtifactsRoot {
    $projectRoot = Get-ProjectRoot
    return (Join-Path $projectRoot "artifacts/release")
}

function Get-PortableReleaseRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Version
    )

    return (Join-Path (Get-ReleaseArtifactsRoot) "$Version/portable")
}

function Get-PortableVariantRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Version,
        [ValidateSet("full", "no_runtime")]
        [string]$Variant
    )

    return (Join-Path (Get-PortableReleaseRoot -Version $Version) $Variant)
}

function Get-LegacyReleaseArtifactsRoot {
    $projectRoot = Get-ProjectRoot
    return (Join-Path $projectRoot "dist/release")
}

function Remove-LegacyReleaseArtifactsRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Recurse -Force
    }
}

function Set-CargoPackageVersion {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Version
    )

    $lines = Get-Content -LiteralPath $Path
    $updatedLines = New-Object System.Collections.Generic.List[string]
    $inPackageSection = $false
    $updated = $false

    foreach ($line in $lines) {
        if ($line -match '^\s*\[(.+)\]\s*$') {
            $inPackageSection = ($Matches[1] -eq "package")
            $updatedLines.Add($line)
            continue
        }

        if ($inPackageSection -and $line -match '^\s*version\s*=\s*"([^"]+)"\s*$') {
            $updatedLines.Add(('version = "{0}"' -f $Version))
            $updated = $true
            continue
        }

        $updatedLines.Add($line)
    }

    if (-not $updated) {
        throw "Could not find [package] version entry in $Path"
    }

    Write-Utf8NoBomFile -Path $Path -Content ([string]::Join([Environment]::NewLine, $updatedLines))
}

function Sync-ReleaseMetadata {
    param(
        [string]$PackageJsonPath = (Get-PackageJsonPath),
        [string]$TauriConfigPath = (Get-TauriConfigPath),
        [string]$CargoTomlPath = (Get-CargoTomlPath),
        [string]$Version
    )

    $packageMetadata = Read-JsonFile -Path $PackageJsonPath
    if (-not [string]::IsNullOrWhiteSpace($Version)) {
        $packageMetadata.version = $Version.Trim()
        Write-JsonFile -Path $PackageJsonPath -Value $packageMetadata
    }

    $resolvedVersion = $packageMetadata.version
    if ([string]::IsNullOrWhiteSpace($resolvedVersion)) {
        throw "package.json version is required for release metadata synchronization."
    }

    $tauriMetadata = Read-JsonFile -Path $TauriConfigPath
    $tauriMetadata.version = $resolvedVersion
    if ($null -ne $tauriMetadata.app -and $null -ne $tauriMetadata.app.windows -and -not [string]::IsNullOrWhiteSpace($tauriMetadata.productName)) {
        foreach ($window in $tauriMetadata.app.windows) {
            $window.title = $tauriMetadata.productName
        }
    }

    Write-JsonFile -Path $TauriConfigPath -Value $tauriMetadata
    Set-CargoPackageVersion -Path $CargoTomlPath -Version $resolvedVersion
}

function Prune-PythonSitePackages {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PythonRoot,
        [string[]]$ExtraKeepPatterns = @()
    )

    $sitePackagesPath = Join-Path $PythonRoot "Lib/site-packages"
    if (-not (Test-Path -LiteralPath $sitePackagesPath)) {
        return
    }

    $keepPatterns = @(
        "pip",
        "pip-*.dist-info",
        "setuptools",
        "setuptools-*.dist-info"
    )

    foreach ($pattern in $ExtraKeepPatterns) {
        # Each entry is an installed package name (from pip freeze).
        # We need to keep the package directory, its dist-info, and
        # handle the python-xxx -> xxx naming convention.
        $keepPatterns += $pattern
        $keepPatterns += "$pattern.dist-info"
        $keepPatterns += "$pattern-*.dist-info"
        # Handle python-xxx convention: "python-docx" installs as "docx" package
        if ($pattern.StartsWith("python-")) {
            $shortName = $pattern.Substring("python-".Length)
            $keepPatterns += $shortName
            $keepPatterns += "$shortName.dist-info"
            $keepPatterns += "$shortName-*.dist-info"
        }
    }

    Get-ChildItem -LiteralPath $sitePackagesPath -Force | ForEach-Object {
        $shouldKeep = $false

        foreach ($pattern in $keepPatterns) {
            if ($_.Name -like $pattern) {
                $shouldKeep = $true
                break
            }
        }

        if (-not $shouldKeep) {
            Remove-Item -LiteralPath $_.FullName -Recurse -Force
        }
    }
}
