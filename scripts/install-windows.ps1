Param(
  [string]$RepoUrl = "https://github.com/galaxy8691/memok-ai.git",
  [string]$TargetDir = "$env:USERPROFILE\.openclaw\extensions\memok-ai-src"
)

$ErrorActionPreference = "Stop"

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "[memok-ai installer] missing required command: $Name"
  }
}

Require-Command git
Require-Command openclaw
Require-Command npm

function Cleanup-SourceDir {
  if ($env:MEMOK_KEEP_SOURCE -eq "1") {
    Write-Host "[memok-ai installer] keeping source dir: $TargetDir (MEMOK_KEEP_SOURCE=1)"
    return
  }
  if (Test-Path $TargetDir) {
    Remove-Item -Recurse -Force $TargetDir
    Write-Host "[memok-ai installer] removed source dir: $TargetDir"
  }
}

function Restart-Gateway-End {
  if ($env:MEMOK_SKIP_GATEWAY_RESTART -eq "1") {
    Write-Host "[memok-ai installer] skipping gateway restart (MEMOK_SKIP_GATEWAY_RESTART=1). Run: openclaw gateway restart"
    return
  }
  Write-Host "[memok-ai installer] restarting OpenClaw gateway to apply configuration..."
  try {
    openclaw gateway restart | Out-Host
  } catch {
    try {
      openclaw restart | Out-Host
    } catch {
      Write-Host "[memok-ai installer] warning: gateway restart failed. Run manually: openclaw gateway restart"
    }
  }
}

Write-Host "[memok-ai installer] cloning/updating source..."
if (Test-Path (Join-Path $TargetDir ".git")) {
  git -C $TargetDir fetch --depth=1 origin main | Out-Host
  git -C $TargetDir checkout -f origin/main | Out-Host
} else {
  if (Test-Path $TargetDir) {
    Remove-Item -Recurse -Force $TargetDir
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $TargetDir) | Out-Null
  git clone --depth=1 $RepoUrl $TargetDir | Out-Host
}

Write-Host "[memok-ai installer] building plugin dist..."
npm --prefix $TargetDir install | Out-Host
npm --prefix $TargetDir run build | Out-Host

Write-Host "[memok-ai installer] installing plugin..."
openclaw plugins install $TargetDir

Write-Host "[memok-ai installer] plugin install finished; next: interactive memok setup (gateway will be restarted at the end on success)."

Write-Host "[memok-ai installer] running interactive setup..."
try {
  openclaw memok setup
} catch {
  $msg = $_.Exception.Message
  if ($msg -match "unknown command 'memok'") {
    Write-Host "[memok-ai installer] memok command unavailable. Your OpenClaw version may be too old or gateway is still restarting."
    Write-Host "[memok-ai installer] please upgrade OpenClaw (>= 2026.3.24), restart gateway, then run: openclaw memok setup"
  } elseif ($msg -match 'plugins\.allow excludes "memok"') {
    Write-Host "[memok-ai installer] setup blocked by plugins.allow."
    Write-Host '[memok-ai installer] add "memok" to ~/.openclaw/openclaw.json -> plugins.allow, then run: openclaw memok setup'
  } else {
    Write-Host "[memok-ai installer] setup command failed. Please run manually: openclaw memok setup"
  }
  throw
}

Cleanup-SourceDir

Restart-Gateway-End

Write-Host ""
Write-Host "[memok-ai installer] done."
