$ErrorActionPreference = "Stop"

function Test-IsAdministrator {
  $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
  Write-Host "Requesting administrator rights..." -ForegroundColor Yellow
  Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList @(
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "`"$PSCommandPath`""
    ) `
    -Verb RunAs
  exit 0
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$cloudflared = Join-Path $projectRoot ".bin\cloudflared.exe"

if (-not (Test-Path -LiteralPath $cloudflared)) {
  throw "cloudflared.exe not found: $cloudflared"
}

Write-Host "Adding outbound Windows Firewall rule for cloudflared..." -ForegroundColor Cyan
$output = & netsh advfirewall firewall add rule name="NES Cloudflared Outbound" dir=out action=allow program="$cloudflared" enable=yes 2>&1
$exitCode = $LASTEXITCODE

if ($output) {
  $output | ForEach-Object { Write-Host $_ }
}

if ($exitCode -ne 0) {
  throw "Failed to add firewall rule."
}

Write-Host "Firewall rule added." -ForegroundColor Green
