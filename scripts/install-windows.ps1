Param(
  [string]$RepoUrl = "https://github.com/galaxy8691/memok-ai.git",
  [string]$TargetDir = "$env:USERPROFILE\.openclaw\extensions\memok-ai-src"
)

$ErrorActionPreference = "Stop"

# 中文版 / Gitee 安装说明：在运行 irm … | iex 前设置 $env:MEMOK_REPO_URL 为 Gitee 仓库即可覆盖下方默认（GitHub）。
if ($env:MEMOK_REPO_URL -and $env:MEMOK_REPO_URL.Trim().Length -gt 0) {
  $RepoUrl = $env:MEMOK_REPO_URL.Trim()
}

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "[memok-ai installer] missing required command: $Name"
  }
}

Require-Command git
Require-Command openclaw
Require-Command npm
Require-Command node

function Sync-MemokInstalledPluginFromSource {
  param([string]$Src)
  $pkg = Get-Content (Join-Path $Src "package.json") -Raw | ConvertFrom-Json
  $name = $pkg.name
  $parent = Split-Path -Parent $Src
  $dest = Join-Path $parent $name
  if (-not (Test-Path $dest) -or -not (Test-Path (Join-Path $dest "package.json"))) {
    Write-Host "[memok-ai installer] installed dir missing at $dest; running openclaw plugins install..."
    openclaw plugins install $Src
    return
  }
  Write-Host "[memok-ai installer] syncing dist/, openclaw.plugin.json, skills/ into $dest ..."
  $dstDist = Join-Path $dest "dist"
  if (Test-Path $dstDist) {
    Remove-Item -Recurse -Force $dstDist
  }
  Copy-Item -Recurse -Force (Join-Path $Src "dist") $dstDist
  Copy-Item -Force (Join-Path $Src "openclaw.plugin.json") (Join-Path $dest "openclaw.plugin.json")
  $srcSkills = Join-Path $Src "skills"
  if (Test-Path $srcSkills) {
    $dstSkills = Join-Path $dest "skills"
    if (Test-Path $dstSkills) {
      Remove-Item -Recurse -Force $dstSkills
    }
    Copy-Item -Recurse -Force $srcSkills $dstSkills
  }
  $lic = Join-Path $Src "LICENSE"
  if (Test-Path $lic) {
    Copy-Item -Force $lic (Join-Path $dest "LICENSE")
  }
}

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
  $gwTimeout = 120
  if ($env:MEMOK_GATEWAY_RESTART_TIMEOUT_SECONDS -match '^\d+$') {
    $parsed = [int]$env:MEMOK_GATEWAY_RESTART_TIMEOUT_SECONDS
    if ($parsed -gt 0) {
      $gwTimeout = $parsed
    }
  }
  Write-Host "[memok-ai installer] restarting OpenClaw gateway to apply configuration (timeout ${gwTimeout}s)..."
  function Try-OpenclawRestart {
    param([string[]]$ArgList)
    try {
      $p = Start-Process -FilePath "openclaw" -ArgumentList $ArgList -PassThru -NoNewWindow
      if ($null -eq $p) {
        return $false
      }
      $timeoutMs = [Math]::Max(1, $gwTimeout) * 1000
      $exited = $p.WaitForExit($timeoutMs)
      if (-not $exited) {
        try {
          $p.Kill()
        } catch {
        }
        return $false
      }
      return ($p.ExitCode -eq 0)
    } catch {
      return $false
    }
  }
  if (Try-OpenclawRestart @("gateway", "restart")) {
    return
  }
  if (Try-OpenclawRestart @("restart")) {
    return
  }
  Write-Host "[memok-ai installer] warning: gateway restart failed or timed out. Run manually: openclaw gateway restart"
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

Write-Host "[memok-ai installer] setup done; rebuilding and syncing built artifacts into the installed extension dir."
npm --prefix $TargetDir run build | Out-Host
Sync-MemokInstalledPluginFromSource $TargetDir

Cleanup-SourceDir

Restart-Gateway-End

Write-Host ""
Write-Host "[memok-ai installer] done."
