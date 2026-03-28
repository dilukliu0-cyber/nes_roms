$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$pidPath = Join-Path $projectRoot ".run\cloudflared.quick.pid"

if (-not (Test-Path -LiteralPath $pidPath)) {
  Write-Host "No cloudflared PID file found."
  exit 0
}

$pidValue = Get-Content -Path $pidPath -ErrorAction Stop
if ($pidValue) {
  Stop-Process -Id ([int]$pidValue) -Force -ErrorAction SilentlyContinue
}

Remove-Item -LiteralPath $pidPath -ErrorAction SilentlyContinue
Write-Host "Cloudflare tunnel stopped."
