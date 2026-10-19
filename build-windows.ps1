$ErrorActionPreference = "Stop"
$BuilderArgs = $args

# Windows PowerShell 5.1 does not turn native command failures into exceptions.
function Invoke-CheckedCommand {
    param(
        [string]$Command,
        [string[]]$Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed with exit code $LASTEXITCODE."
    }
}

# mini-electron currently publishes a Windows x64 runtime only.
$Arches = @("x64")
if (-not [string]::IsNullOrWhiteSpace($env:WINDOWS_ARCHES)) {
    $Arches = $env:WINDOWS_ARCHES.Trim() -split '\s+'
}
foreach ($Arch in $Arches) {
    if ($Arch -cne "x64") {
        throw "Unsupported Windows architecture: $Arch"
    }
}

$PreviousStaging = $env:OMP_DESKTOP_WINDOWS_KEYRING_STAGING
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "omp-desktop-windows-$([guid]::NewGuid().ToString('N'))"
Push-Location -LiteralPath $PSScriptRoot
try {
    $KeyringStaging = Join-Path $TempDir "keyring-packages"
    New-Item -ItemType Directory -Path $KeyringStaging -Force | Out-Null
    $env:OMP_DESKTOP_WINDOWS_KEYRING_STAGING = $KeyringStaging

    # Stage immediately before electron-builder, after npm-driven prerequisite builds.
    $KeyringVersion = Invoke-CheckedCommand "node" @("-p", "require('./node_modules/@napi-rs/keyring/package.json').version")
    foreach ($Arch in $Arches) {
        $PackageName = "keyring-win32-$Arch-msvc"
        $Archive = Invoke-CheckedCommand "npm.cmd" @("pack", "--silent", "--pack-destination", $TempDir, "@napi-rs/$PackageName@$KeyringVersion")
        $PackageDir = Join-Path $KeyringStaging $PackageName
        New-Item -ItemType Directory -Path $PackageDir -Force | Out-Null
        Invoke-CheckedCommand "tar.exe" @("-xzf", (Join-Path $TempDir $Archive), "-C", $PackageDir, "--strip-components=1")
        $BindingPath = Join-Path $PackageDir "keyring.win32-$Arch-msvc.node"
        if (-not (Test-Path -LiteralPath $BindingPath -PathType Leaf)) {
            throw "Windows keyring binding is missing: $BindingPath"
        }
    }

    # Do not leave a stale universal installer in release/ after splitting builds.
    $Version = Invoke-CheckedCommand "node" @("-p", "require('./packages/desktop/package.json').version")
    $Channel = "latest"
    if ($Version.Contains("-")) {
        $Channel = ($Version -split '-', 2)[1].Split('.')[0]
    }
    $ReleaseDir = Join-Path $PSScriptRoot "packages/desktop/release"
    foreach ($Name in @("OMP-Desktop-Setup-$Version.exe", "OMP-Desktop-Setup-$Version.exe.blockmap")) {
        $StalePath = Join-Path $ReleaseDir $Name
        if (Test-Path -LiteralPath $StalePath) {
            Remove-Item -LiteralPath $StalePath -Force
        }
    }

    $MetadataDir = Join-Path $TempDir "update-metadata"
    New-Item -ItemType Directory -Path $MetadataDir -Force | Out-Null
    $MetadataPath = Join-Path $ReleaseDir "$Channel.yml"
    $MetadataFiles = @()
    foreach ($Arch in $Arches) {
        Invoke-CheckedCommand "npm.cmd" (@("run", "build:desktop", "--", "--win", "--$Arch", "--publish", "never") + $BuilderArgs)
        $SnapshotPath = Join-Path $MetadataDir "$Channel-$Arch.yml"
        Copy-Item -LiteralPath $MetadataPath -Destination $SnapshotPath
        $MetadataFiles += $SnapshotPath
    }

    Invoke-CheckedCommand "node" (@("scripts/merge-windows-update-metadata.mjs", $MetadataPath) + $MetadataFiles)
} finally {
    $env:OMP_DESKTOP_WINDOWS_KEYRING_STAGING = $PreviousStaging
    if (Test-Path -LiteralPath $TempDir) {
        Remove-Item -LiteralPath $TempDir -Recurse -Force
    }
    Pop-Location
}
