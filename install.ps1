# random-albums Spicetify installer
# One-liner: iwr -useb "https://raw.githubusercontent.com/daviidpaark/random-albums/main/install.ps1" | iex

$repoBaseUrl   = "https://raw.githubusercontent.com/daviidpaark/random-albums/main"
$appsToInstall = @("random-albums")
$appFiles      = @{
    "random-albums" = @("index.js", "manifest.json")
}

$ErrorActionPreference = "Stop"

$spicePath  = "$env:APPDATA\spicetify"
$configFile = "$spicePath\config-xpui.ini"

# ── 1. Verify spicetify is installed ────────────────────────────────────────
if (-not (Get-Command spicetify -ErrorAction SilentlyContinue)) {
    Write-Error "spicetify not found in PATH. Install it from https://spicetify.app first."
    exit 1
}
if (-not (Test-Path $configFile)) {
    Write-Error "config-xpui.ini not found at $configFile. Run 'spicetify backup' first."
    exit 1
}

# ── 2. Copy/download custom app files ───────────────────────────────────────
foreach ($app in $appsToInstall) {
    $dest     = Join-Path $spicePath "CustomApps\$app"
    $localSrc = if ($PSScriptRoot) { Join-Path $PSScriptRoot $app } else { $null }

    Write-Host "Installing $app..." -ForegroundColor Cyan
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    New-Item -ItemType Directory -Path $dest -Force | Out-Null

    if ($localSrc -and (Test-Path $localSrc)) {
        Copy-Item "$localSrc\*" $dest -Recurse
        Write-Host "  Copied to $dest" -ForegroundColor Green
    } else {
        foreach ($file in $appFiles[$app]) {
            $url = "$repoBaseUrl/$app/$file"
            Write-Host "  Downloading $file..." -ForegroundColor DarkCyan
            Invoke-WebRequest -Uri $url -OutFile (Join-Path $dest $file) -UseBasicParsing
        }
        Write-Host "  Downloaded to $dest" -ForegroundColor Green
    }
}

# ── 3. Register apps in config-xpui.ini ─────────────────────────────────────
$config = Get-Content $configFile -Raw

foreach ($app in $appsToInstall) {
    if ($config -match "(?m)^(custom_apps\s*=\s*)(.*)$") {
        $key    = $Matches[1]
        $values = $Matches[2] -split "\|" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }

        if ($values -notcontains $app) {
            $values  += $app
            $newLine  = "$key$($values -join '|')"
            $config   = $config -replace "(?m)^custom_apps\s*=.*$", $newLine
            Set-Content $configFile $config -NoNewline
            Write-Host "Registered '$app' in config-xpui.ini" -ForegroundColor Green
        } else {
            Write-Host "'$app' already registered in config-xpui.ini" -ForegroundColor Yellow
        }
    }
}

# ── 4. Apply ─────────────────────────────────────────────────────────────────
Write-Host "`nApplying spicetify..." -ForegroundColor Cyan
spicetify apply
Write-Host "`nDone! Restart Spotify if it's already open." -ForegroundColor Green
