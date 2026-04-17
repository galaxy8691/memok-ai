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

Write-Host "[memok-ai installer] running interactive setup..."
try {
  openclaw memok setup
} catch {
  $msg = $_.Exception.Message
  if ($msg -match 'plugins\.allow excludes "memok"') {
    Write-Host "[memok-ai installer] setup blocked by plugins.allow."
    Write-Host '[memok-ai installer] add "memok" to ~/.openclaw/openclaw.json -> plugins.allow, then run: openclaw memok setup'
  } else {
    Write-Host "[memok-ai installer] setup command failed. Please run manually: openclaw memok setup"
  }
  throw
}

Write-Host ""
Write-Host "[memok-ai installer] done. Please restart OpenClaw gateway."
