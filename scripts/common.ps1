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

function Get-TauriWindowsConfigPath {
    $projectRoot = Get-ProjectRoot
    return (Join-Path $projectRoot "src-tauri/tauri.windows.conf.json")
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

function Get-PortableAppExecutableFileName {
    $appName = Get-AppName
    if ([string]::IsNullOrWhiteSpace($appName)) {
        throw "App name cannot be empty."
    }

    return ("{0}.exe" -f $appName.Trim())
}

function Get-PortableArchiveFileName {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Version
    )

    $artifactBaseName = Get-SafeArtifactName -Name (Get-AppName)
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

function Get-BundledReleaseRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Version
    )

    return (Join-Path (Get-ReleaseArtifactsRoot) "$Version/bundle")
}

function Get-PortableReleaseRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Version
    )

    return (Join-Path (Get-ReleaseArtifactsRoot) "$Version/portable")
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

function Get-WindowsBundleOutputRoot {
    $projectRoot = Get-ProjectRoot
    return (Join-Path $projectRoot "src-tauri/target/release/bundle")
}

function Get-EnvironmentValueOrFileContent {
    param(
        [Parameter(Mandatory = $true)]
        [string]$EnvironmentVariableName,
        [string]$FileEnvironmentVariableName
    )

    $value = [Environment]::GetEnvironmentVariable($EnvironmentVariableName)
    if (-not [string]::IsNullOrWhiteSpace($value)) {
        return $value.Trim()
    }

    if (-not [string]::IsNullOrWhiteSpace($FileEnvironmentVariableName)) {
        $path = [Environment]::GetEnvironmentVariable($FileEnvironmentVariableName)
        if (-not [string]::IsNullOrWhiteSpace($path)) {
            if (-not (Test-Path -LiteralPath $path)) {
                throw "Environment variable $FileEnvironmentVariableName points to a missing file: $path"
            }

            return (Get-Content -Raw -LiteralPath $path).Trim()
        }
    }

    return $null
}

function Get-UpdaterEndpoints {
    $raw = [Environment]::GetEnvironmentVariable("TAURI_AGENT_UPDATER_ENDPOINTS")
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return @()
    }

    $endpoints = @($raw -split "[`r`n,;]+")
    $normalized = $endpoints |
        ForEach-Object { $_.Trim() } |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

    return @($normalized)
}

function Get-UpdaterPubKey {
    return Get-EnvironmentValueOrFileContent -EnvironmentVariableName "TAURI_AGENT_UPDATER_PUBKEY" -FileEnvironmentVariableName "TAURI_AGENT_UPDATER_PUBKEY_FILE"
}

function Get-WindowsCodeSignToolPath {
    $configuredPath = [Environment]::GetEnvironmentVariable("TAURI_AGENT_WINDOWS_SIGNTOOL_PATH")
    if (-not [string]::IsNullOrWhiteSpace($configuredPath)) {
        if (-not (Test-Path -LiteralPath $configuredPath)) {
            throw "Configured signtool path does not exist: $configuredPath"
        }

        return (Resolve-Path -LiteralPath $configuredPath).Path
    }

    $command = Get-Command "signtool.exe" -ErrorAction SilentlyContinue
    if ($null -ne $command -and -not [string]::IsNullOrWhiteSpace($command.Source)) {
        return $command.Source
    }

    return $null
}

function Get-WindowsCodeSignCertificateFile {
    $path = [Environment]::GetEnvironmentVariable("TAURI_AGENT_WINDOWS_SIGN_CERT_FILE")
    if ([string]::IsNullOrWhiteSpace($path)) {
        return $null
    }

    if (-not (Test-Path -LiteralPath $path)) {
        throw "Configured Windows signing certificate file does not exist: $path"
    }

    return (Resolve-Path -LiteralPath $path).Path
}

function Get-WindowsCodeSignCertificatePassword {
    return Get-EnvironmentValueOrFileContent -EnvironmentVariableName "TAURI_AGENT_WINDOWS_SIGN_CERT_PASSWORD" -FileEnvironmentVariableName "TAURI_AGENT_WINDOWS_SIGN_CERT_PASSWORD_FILE"
}

function Get-WindowsCodeSignCertificateThumbprint {
    $thumbprint = [Environment]::GetEnvironmentVariable("TAURI_AGENT_WINDOWS_SIGN_CERT_THUMBPRINT")
    if ([string]::IsNullOrWhiteSpace($thumbprint)) {
        return $null
    }

    return ($thumbprint -replace "\s+", "").Trim()
}

function Get-WindowsCodeSignCertificateSubject {
    $subject = [Environment]::GetEnvironmentVariable("TAURI_AGENT_WINDOWS_SIGN_CERT_SUBJECT")
    if ([string]::IsNullOrWhiteSpace($subject)) {
        return $null
    }

    return $subject.Trim()
}

function Get-WindowsCodeSignTimestampUrl {
    $timestampUrl = [Environment]::GetEnvironmentVariable("TAURI_AGENT_WINDOWS_SIGN_TIMESTAMP_URL")
    if ([string]::IsNullOrWhiteSpace($timestampUrl)) {
        return $null
    }

    return $timestampUrl.Trim()
}

function Get-WindowsCodeSignDigestAlgorithm {
    $digest = [Environment]::GetEnvironmentVariable("TAURI_AGENT_WINDOWS_SIGN_DIGEST")
    if ([string]::IsNullOrWhiteSpace($digest)) {
        return "SHA256"
    }

    return $digest.Trim().ToUpperInvariant()
}

function Get-WindowsCodeSignTimestampDigestAlgorithm {
    $digest = [Environment]::GetEnvironmentVariable("TAURI_AGENT_WINDOWS_SIGN_TIMESTAMP_DIGEST")
    if ([string]::IsNullOrWhiteSpace($digest)) {
        return "SHA256"
    }

    return $digest.Trim().ToUpperInvariant()
}

function Test-WindowsCodeSignTspEnabled {
    $value = [Environment]::GetEnvironmentVariable("TAURI_AGENT_WINDOWS_SIGN_TSP")
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $false
    }

    return $value.Trim().ToLowerInvariant() -eq "true"
}

function Get-WindowsCodeSigningConfig {
    $signToolPath = Get-WindowsCodeSignToolPath
    if ([string]::IsNullOrWhiteSpace($signToolPath)) {
        return $null
    }

    $certificateFile = Get-WindowsCodeSignCertificateFile
    $certificateThumbprint = Get-WindowsCodeSignCertificateThumbprint
    $certificateSubject = Get-WindowsCodeSignCertificateSubject

    if ([string]::IsNullOrWhiteSpace($certificateFile) -and [string]::IsNullOrWhiteSpace($certificateThumbprint) -and [string]::IsNullOrWhiteSpace($certificateSubject)) {
        return $null
    }

    return [PSCustomObject]@{
        signToolPath = $signToolPath
        certificateFile = $certificateFile
        certificatePassword = Get-WindowsCodeSignCertificatePassword
        certificateThumbprint = $certificateThumbprint
        certificateSubject = $certificateSubject
        timestampUrl = Get-WindowsCodeSignTimestampUrl
        tspEnabled = Test-WindowsCodeSignTspEnabled
        fileDigestAlgorithm = Get-WindowsCodeSignDigestAlgorithm
        timestampDigestAlgorithm = Get-WindowsCodeSignTimestampDigestAlgorithm
    }
}

function Test-WindowsCodeSigningConfigured {
    return $null -ne (Get-WindowsCodeSigningConfig)
}

function New-WindowsCodeSigningArguments {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [Parameter(Mandatory = $true)]
        [object]$Config
    )

    $arguments = @("sign", "/fd", $Config.fileDigestAlgorithm)

    if (-not [string]::IsNullOrWhiteSpace($Config.timestampUrl)) {
        if ($Config.PSObject.Properties.Name -contains "tspEnabled" -and $Config.tspEnabled) {
            $arguments += @("/tr", $Config.timestampUrl, "/td", $Config.timestampDigestAlgorithm)
        }
        else {
            $arguments += @("/t", $Config.timestampUrl)
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($Config.certificateFile)) {
        $arguments += @("/f", $Config.certificateFile)
        if (-not [string]::IsNullOrWhiteSpace($Config.certificatePassword)) {
            $arguments += @("/p", $Config.certificatePassword)
        }
    }
    elseif (-not [string]::IsNullOrWhiteSpace($Config.certificateThumbprint)) {
        $arguments += @("/sha1", $Config.certificateThumbprint)
    }
    elseif (-not [string]::IsNullOrWhiteSpace($Config.certificateSubject)) {
        $arguments += @("/n", $Config.certificateSubject)
    }
    else {
        throw "Windows code signing configuration is missing a certificate selector."
    }

    $arguments += $FilePath
    return $arguments
}

function Invoke-WindowsCodeSignFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $config = Get-WindowsCodeSigningConfig
    if ($null -eq $config) {
        return
    }

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Cannot sign missing file: $Path"
    }

    $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
    $arguments = New-WindowsCodeSigningArguments -FilePath $resolvedPath -Config $config
    Write-Host "Authenticode signing $resolvedPath"
    Invoke-CheckedProcess -FilePath $config.signToolPath -ArgumentList $arguments
}

function Invoke-WindowsCodeSignFiles {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Paths
    )

    if (-not (Test-WindowsCodeSigningConfigured)) {
        return
    }

    $uniquePaths = $Paths | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
    foreach ($path in $uniquePaths) {
        Invoke-WindowsCodeSignFile -Path $path
    }
}

function Test-UpdaterConfigInputsAvailable {
    $endpoints = @(Get-UpdaterEndpoints)
    return ($endpoints.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace((Get-UpdaterPubKey)))
}

function Test-TauriUpdaterArtifactSigningConfigured {
    $privateKey = Get-EnvironmentValueOrFileContent -EnvironmentVariableName "TAURI_SIGNING_PRIVATE_KEY" -FileEnvironmentVariableName "TAURI_SIGNING_PRIVATE_KEY_FILE"
    if ([string]::IsNullOrWhiteSpace($privateKey)) {
        $privateKey = Get-EnvironmentValueOrFileContent -EnvironmentVariableName "TAURI_SIGNING_PRIVATE_KEY" -FileEnvironmentVariableName "TAURI_SIGNING_PRIVATE_KEY_PATH"
    }

    return -not [string]::IsNullOrWhiteSpace($privateKey)
}

function New-TauriWindowsSignCommandConfig {
    $projectRoot = Get-ProjectRoot
    $signScriptPath = Join-Path $projectRoot "scripts/sign-windows-file.ps1"
    if (-not (Test-Path -LiteralPath $signScriptPath)) {
        throw "Windows signing helper script is missing: $signScriptPath"
    }

    return @{
        cmd = "powershell"
        args = @(
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            $signScriptPath,
            "-Path",
            "%1"
        )
    }
}

function New-TauriWindowsBundleSigningConfig {
    $signingConfig = Get-WindowsCodeSigningConfig
    if ($null -eq $signingConfig) {
        return $null
    }

    if (-not [string]::IsNullOrWhiteSpace($signingConfig.certificateThumbprint)) {
        $windowsConfig = @{
            certificateThumbprint = $signingConfig.certificateThumbprint
            digestAlgorithm = $signingConfig.fileDigestAlgorithm.ToLowerInvariant()
        }

        if (-not [string]::IsNullOrWhiteSpace($signingConfig.timestampUrl)) {
            $windowsConfig.timestampUrl = $signingConfig.timestampUrl
            if ($signingConfig.tspEnabled) {
                $windowsConfig.tsp = $true
            }
        }

        return $windowsConfig
    }

    return @{
        signCommand = New-TauriWindowsSignCommandConfig
    }
}

function New-TauriBuildConfigOverrideFile {
    $config = @{
        '$schema' = 'https://schema.tauri.app/config/2'
    }

    if (Test-UpdaterConfigInputsAvailable) {
        $updaterEndpoints = @(Get-UpdaterEndpoints)
        $config.plugins = @{
            updater = @{
                endpoints = $updaterEndpoints
                pubkey = Get-UpdaterPubKey
            }
        }
    }

    if ((Test-TauriUpdaterArtifactSigningConfigured) -or (Test-WindowsCodeSigningConfigured)) {
        $config.bundle = @{}
    }

    if (Test-TauriUpdaterArtifactSigningConfigured) {
        $config.bundle.createUpdaterArtifacts = $true
    }

    if (Test-WindowsCodeSigningConfigured) {
        $config.bundle.windows = New-TauriWindowsBundleSigningConfig
    }

    if ($config.Count -le 1) {
        return $null
    }

    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("tauri-agent-build-config-" + [System.Guid]::NewGuid().ToString("N"))
    Ensure-Directory -Path $tempRoot

    $path = Join-Path $tempRoot "tauri.build.override.conf.json"
    Write-JsonFile -Path $path -Value $config
    return $path
}

function Get-UpdaterBaseUrl {
    param(
        [string]$BaseUrl
    )

    if (-not [string]::IsNullOrWhiteSpace($BaseUrl)) {
        return $BaseUrl.Trim().TrimEnd("/")
    }

    $fromEnv = [Environment]::GetEnvironmentVariable("TAURI_AGENT_UPDATER_BASE_URL")
    if (-not [string]::IsNullOrWhiteSpace($fromEnv)) {
        return $fromEnv.Trim().TrimEnd("/")
    }

    return $null
}

function Get-UpdaterReleaseNotes {
    param(
        [string]$ReleaseNotes
    )

    if (-not [string]::IsNullOrWhiteSpace($ReleaseNotes)) {
        return $ReleaseNotes.Trim()
    }

    $fromEnv = Get-EnvironmentValueOrFileContent -EnvironmentVariableName "TAURI_AGENT_UPDATER_NOTES" -FileEnvironmentVariableName "TAURI_AGENT_UPDATER_NOTES_FILE"
    if (-not [string]::IsNullOrWhiteSpace($fromEnv)) {
        return $fromEnv.Trim()
    }

    return ""
}

function Get-UpdaterPublishDate {
    $fromEnv = [Environment]::GetEnvironmentVariable("TAURI_AGENT_UPDATER_PUB_DATE")
    if (-not [string]::IsNullOrWhiteSpace($fromEnv)) {
        return $fromEnv.Trim()
    }

    return [DateTimeOffset]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
}

function Join-UrlPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BaseUrl,
        [Parameter(Mandatory = $true)]
        [string]$RelativePath
    )

    $normalizedBase = $BaseUrl.Trim().TrimEnd("/")
    $normalizedRelative = ($RelativePath -replace "[\\/]+", "/").TrimStart("/")
    return "$normalizedBase/$normalizedRelative"
}

function Get-RelativePathNormalized {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root,
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $resolvedRoot = [System.IO.Path]::GetFullPath($Root)
    $resolvedPath = [System.IO.Path]::GetFullPath($Path)
    $relative = [System.IO.Path]::GetRelativePath($resolvedRoot, $resolvedPath)
    return ($relative -replace "\\", "/")
}

function Find-UpdaterNsisInstaller {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BundleRoot
    )

    $nsisRoot = Join-Path $BundleRoot "nsis"
    if (-not (Test-Path -LiteralPath $nsisRoot)) {
        throw "Expected NSIS bundle directory was not found: $nsisRoot"
    }

    $candidates = Get-ChildItem -LiteralPath $nsisRoot -File -Recurse | Where-Object {
        $_.Extension -ieq ".exe"
    } | Sort-Object FullName

    if ($candidates.Count -eq 0) {
        throw "No NSIS installer executable was found under $nsisRoot"
    }

    if ($candidates.Count -gt 1) {
        $setupCandidates = @($candidates | Where-Object { $_.Name -match "setup" })
        if ($setupCandidates.Count -eq 1) {
            return $setupCandidates[0]
        }
    }

    return $candidates[0]
}

function Read-UpdaterSignature {
    param(
        [Parameter(Mandatory = $true)]
        [string]$InstallerPath
    )

    $signaturePath = "$InstallerPath.sig"
    if (-not (Test-Path -LiteralPath $signaturePath)) {
        throw "Missing updater signature file for installer: $signaturePath"
    }

    $signature = (Get-Content -Raw -LiteralPath $signaturePath).Trim()
    if ([string]::IsNullOrWhiteSpace($signature)) {
        throw "Updater signature file is empty: $signaturePath"
    }

    return [PSCustomObject]@{
        signaturePath = $signaturePath
        signature = $signature
    }
}

function New-UpdaterManifestObject {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Version,
        [Parameter(Mandatory = $true)]
        [string]$BaseUrl,
        [Parameter(Mandatory = $true)]
        [string]$InstallerRelativePath,
        [Parameter(Mandatory = $true)]
        [string]$Signature,
        [string]$ReleaseNotes = "",
        [string]$PublishDate = (Get-UpdaterPublishDate)
    )

    return [ordered]@{
        version = $Version
        notes = $ReleaseNotes
        pub_date = $PublishDate
        platforms = [ordered]@{
            "windows-x86_64" = [ordered]@{
                url = (Join-UrlPath -BaseUrl $BaseUrl -RelativePath $InstallerRelativePath)
                signature = $Signature
            }
        }
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
