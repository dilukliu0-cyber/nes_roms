$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$cloudflared = Join-Path $projectRoot ".bin\cloudflared.exe"
$runDir = Join-Path $projectRoot ".run"
$stdout = Join-Path $runDir "cloudflared.stdout.log"
$stderr = Join-Path $runDir "cloudflared.stderr.log"
$pidPath = Join-Path $runDir "cloudflared.quick.pid"
$healthUrl = "http://127.0.0.1:3000/api/health"

if (-not (Test-Path -LiteralPath $cloudflared)) {
  throw "cloudflared.exe not found: $cloudflared"
}

if (-not (Test-Path -LiteralPath $runDir)) {
  New-Item -ItemType Directory -Force -Path $runDir | Out-Null
}

try {
  $health = Invoke-WebRequest -UseBasicParsing $healthUrl -TimeoutSec 5
  if ($health.StatusCode -ne 200) {
    throw "Local server is not healthy."
  }
} catch {
  throw "Local server is not reachable on http://127.0.0.1:3000. Start the app first with npm start."
}

Remove-Item -LiteralPath $stdout, $stderr, $pidPath -ErrorAction SilentlyContinue

$process = Start-Process `
  -FilePath $cloudflared `
  -ArgumentList @("tunnel", "--url", "http://127.0.0.1:3000", "--no-autoupdate") `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr `
  -PassThru

Set-Content -Path $pidPath -Value $process.Id

Write-Host "Started cloudflared. Waiting for URL..." -ForegroundColor Cyan
Write-Host "If Windows shows a firewall prompt, allow cloudflared." -ForegroundColor Yellow

$deadline = (Get-Date).AddSeconds(40)
$url = $null

while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 800

  if (Test-Path -LiteralPath $stdout) {
    $match = Select-String -Path $stdout -Pattern 'https://[-a-z0-9.]+trycloudflare.com' | Select-Object -Last 1
    if ($match) {
      $url = $match.Matches.Value
      break
    }
  }
}

if ($url) {
  Write-Host ""
  Write-Host "Cloudflare Tunnel URL:" -ForegroundColor Green
  Write-Host $url -ForegroundColor Green
  Write-Host ""
  Write-Host "Test room:" -ForegroundColor Cyan
  Write-Host "$url/room/03DDD0" -ForegroundColor Cyan
  exit 0
}

Write-Host ""
Write-Host "Tunnel URL was not received in time." -ForegroundColor Red
Write-Host "Check logs:" -ForegroundColor Yellow
Write-Host $stdout
Write-Host $stderr
exit 1
