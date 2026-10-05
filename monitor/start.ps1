# Starts the fleet-monitor server hidden if it is not running yet and opens the
# browser. Idempotent: running it again only reopens the page.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File start.ps1 [-ConfigPath <ruta>] [-Port 4200]
param(
  [string]$ConfigPath = '',
  [int]$Port = 0
)

$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$server = Join-Path $dir 'server.mjs'

if (-not (Test-Path $server)) {
  Write-Host "No se encontró server.mjs en $dir." -ForegroundColor Red
  exit 1
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host 'Node.js no está instalado o no está en el PATH.' -ForegroundColor Red
  exit 1
}

function Test-MonitorPort([int]$Candidate) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $task = $client.ConnectAsync('127.0.0.1', $Candidate)
    return ($task.Wait(700) -and $client.Connected)
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

$effectivePort = $Port
if ($effectivePort -le 0) {
  $effectivePort = 4200
  $configFile = if ($ConfigPath) { $ConfigPath } else { Join-Path $dir 'fleet-monitor.config.json' }
  if (Test-Path $configFile) {
    try {
      $config = Get-Content $configFile -Raw | ConvertFrom-Json
      if ($config.server.port) { $effectivePort = [int]$config.server.port }
    } catch {
      Write-Host "No se pudo leer $configFile; se usa el puerto 4200." -ForegroundColor Yellow
    }
  }
}

if (Test-MonitorPort $effectivePort) {
  Write-Host "El monitor ya está corriendo en http://127.0.0.1:$effectivePort/."
} else {
  $serverArgs = @("`"$server`"")
  if ($ConfigPath) { $serverArgs += "`"$ConfigPath`"" }
  Start-Process -FilePath $node.Source -ArgumentList $serverArgs -WorkingDirectory $dir -WindowStyle Hidden | Out-Null
  $ready = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-MonitorPort $effectivePort) {
      $ready = $true
      break
    }
  }
  if ($ready) {
    Write-Host "Monitor iniciado en http://127.0.0.1:$effectivePort/."
  } else {
    Write-Host 'El monitor no respondió a tiempo; revise server.mjs manualmente.' -ForegroundColor Yellow
  }
}

Start-Process "http://127.0.0.1:$effectivePort/"
