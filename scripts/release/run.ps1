#Requires -Version 5
<#
  MCP Token Footprint - one-shot launcher for Docker Desktop (Windows).

  You do NOT need this project's source code or any registry login. Just:
    1. Put this file in the SAME folder as the mcp-token-footprint-*-docker-image.tar.gz you were given.
    2. Make sure Docker Desktop is installed and running.
    3. Right-click this file -> "Run with PowerShell"   (or run  .\run.ps1  in a PowerShell window).

  It loads the image and starts the app at http://localhost:8080. Your data is kept in a Docker
  volume ("mcp-token-footprint-data") and survives restarts and upgrades.

  Different port:   $env:PORT = '9090'; .\run.ps1
#>
$ErrorActionPreference = 'Stop'

$Container = 'mcp-token-footprint'
$Volume    = 'mcp-token-footprint-data'
$Port      = if ($env:PORT) { $env:PORT } else { '8080' }
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Say($m)  { Write-Host "> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "OK $m" -ForegroundColor Green }
function Warn($m) { Write-Host "!  $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "X  $m" -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }

# True if something is already listening on 127.0.0.1:$p
function Test-PortInUse([int]$p) {
  $listener = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
  if ($listener) { return $true }
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $iar = $c.BeginConnect('127.0.0.1', $p, $null, $null)
    $connected = $iar.AsyncWaitHandle.WaitOne(200) -and $c.Connected
    $c.Close()
    return [bool]$connected
  } catch { return $false }
}
# First free port at or after $start (scans a 50-port window); 0 if none free.
function Find-FreePort([int]$start) {
  for ($p = $start; $p -le $start + 50; $p++) { if (-not (Test-PortInUse $p)) { return $p } }
  return 0
}

# 1. Docker present & running -----------------------------------------------------------------
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Die 'Docker is not installed. Get Docker Desktop from https://www.docker.com/products/docker-desktop/ , start it, then re-run this.'
}
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Die 'Docker Desktop is installed but not running. Open it, wait until it says running, then re-run this.'
}

# 2. Locate the image tarball -----------------------------------------------------------------
$tar = Get-ChildItem -Path $ScriptDir -Filter 'mcp-token-footprint-*-docker-image.tar.gz' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $tar) {
  $tar = Get-ChildItem -Path $ScriptDir -Filter 'mcp-token-footprint-*-docker-image.tar' -ErrorAction SilentlyContinue | Select-Object -First 1
}
if (-not $tar) {
  Die "No image file found next to this script. Expected 'mcp-token-footprint-vX.Y.Z-docker-image.tar.gz' in $ScriptDir"
}
Ok "Found image file: $($tar.Name)"

# 3. Load the image ---------------------------------------------------------------------------
Say 'Loading the image into Docker (first time can take a minute)...'
$loadOut  = docker load -i $tar.FullName
$match    = $loadOut | Select-String -Pattern '^Loaded image: (.+)$' | Select-Object -First 1
$imageRef = if ($match) { $match.Matches.Groups[1].Value.Trim() } else { $null }
if (-not $imageRef) { Die "Could not parse the loaded image reference from:`n$loadOut" }
Ok "Loaded $imageRef"

# 4. Replace any existing container (data volume kept) ----------------------------------------
$existing = docker ps -a --format '{{.Names}}' | Select-String -SimpleMatch $Container
if ($existing) {
  Say "Replacing the existing '$Container' container (your data volume is kept)..."
  docker rm -f $Container *> $null
}

# 5. Pick a free host port (starting from the requested one) and run --------------------------
$desired = [int]$Port
$Port = Find-FreePort $desired
if ($Port -eq 0) { Die "No free port found in $desired..$($desired + 50). Free one up and retry." }
if ($Port -ne $desired) { Warn "Port $desired is in use - using the next free port: $Port" }

Say "Starting the container on port $Port..."
$attempt = 0
while ($true) {
  docker run -d --name $Container --init --restart unless-stopped -p "${Port}:8080" -v "${Volume}:/data" $imageRef *> $null
  if ($LASTEXITCODE -eq 0) { break }
  $attempt++
  if ($attempt -gt 10) { Die 'Failed to start the container after several port attempts.' }
  # A port can be grabbed between the probe and the run - advance and retry.
  docker rm -f $Container *> $null
  $next = Find-FreePort ($Port + 1)
  if ($next -eq 0) { Die 'No free port available.' }
  Warn "Port $Port was taken - retrying on $next..."
  $Port = $next
}

# 6. Wait for health --------------------------------------------------------------------------
$url = "http://localhost:$Port"
Say 'Waiting for the app to become healthy...'
for ($i = 0; $i -lt 45; $i++) {
  try { Invoke-WebRequest -UseBasicParsing "$url/api/health" -TimeoutSec 3 | Out-Null; Ok 'App is healthy'; break }
  catch { Start-Sleep -Seconds 2 }
}

# 7. Open the browser -------------------------------------------------------------------------
Ok "MCP Token Footprint is running -> $url"
Start-Process $url

Write-Host ''
Write-Host "  Open in your browser:  $url"
Write-Host ''
Write-Host "  Stop it:     docker stop $Container"
Write-Host "  Start again: docker start $Container"
Write-Host "  Remove it:   docker rm -f $Container      (your data volume '$Volume' is kept)"
Write-Host "  Wipe data:   docker volume rm $Volume     (only after removing the container)"
Write-Host ''
Read-Host 'Press Enter to close'
