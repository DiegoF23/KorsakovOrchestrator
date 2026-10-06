# Starts the fleet-monitor server hidden if it is not running yet and opens the
# browser. Idempotent: running it again only reopens the page.
# The server is created through WMI so it is detached from the calling shell:
# it keeps running when the terminal or the agent session that started it ends.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File start.ps1 [-ConfigPath <ruta>] [-Port 4200] [-NoBrowser]
param(
  [string]$ConfigPath = '',
  [int]$Port = 0,
  [switch]$NoBrowser
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
  $commandLine = "`"$($node.Source)`" `"$server`""
  if ($ConfigPath) { $commandLine += " `"$ConfigPath`"" }
  $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
  $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $commandLine
    CurrentDirectory = $dir
    ProcessStartupInformation = $startup
  }
  if ($created.ReturnValue -ne 0) {
    Write-Host "No se pudo iniciar el servidor (código WMI $($created.ReturnValue))." -ForegroundColor Red
    exit 1
  }
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

if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$effectivePort/" }
