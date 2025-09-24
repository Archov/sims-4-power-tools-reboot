# scripts/agent-build.ps1
$ErrorActionPreference = 'Stop'

# Prefer machine-wide Node install
$npmCmds = @(
  "$env:ProgramFiles\nodejs\npm.cmd",
  "$env:ProgramFiles(x86)\nodejs\npm.cmd",
  "$env:USERPROFILE\AppData\Roaming\npm\npm.cmd"
) | Where-Object { Test-Path $_ }

if (-not $npmCmds) {
  Write-Host "[agent] npm not found on common paths. Dumping PATH and exiting..."
  Write-Host "PATH=$env:Path"
  throw "npm.cmd not found; agent shell likely missing Node on PATH"
}

$NPM = $npmCmds[0]
Write-Host "[agent] Using npm: $NPM"
& $NPM -v

# Headless-safe env
$env:CI = "1"
$env:BROWSERSLIST_IGNORE_OLD_DATA = "1"
$env:NEXT_TELEMETRY_DISABLED = "1"
$env:ADBLOCK = "1"
$env:DISABLE_OPENCOLLECTIVE = "1"
$env:HUSKY = "0"
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1"
$env:PUPPETEER_SKIP_DOWNLOAD = "1"
$env:NPM_CONFIG_PROGRESS = "false"
$env:NPM_CONFIG_AUDIT = "false"
$env:NPM_CONFIG_FUND = "false"

# Install without postinstall hooks (common hang source in agents)
& $NPM ci --ignore-scripts

# Build with foreground logs so stalls are visible
& $NPM run build --foreground-scripts --loglevel verbose --timing
