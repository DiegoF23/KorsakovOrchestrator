# Keeps the monitor server alive: runs server.mjs, appends its output to log
# files and starts it again when it exits. start.ps1 launches this script
# detached through WMI. To restart the server after a code change, stop only
# the node process: this loop brings it back within a couple of seconds.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File supervise.ps1 [-ConfigPath <ruta>] [-LogDir <carpeta>]
param(
  [string]$ConfigPath = '',
  [string]$LogDir = ''
)

$ErrorActionPreference = 'Continue'
$dir = $PSScriptRoot
$server = Join-Path $dir 'server.mjs'
$node = (Get-Command node -ErrorAction Stop).Source

if (-not $LogDir) {
  $LogDir = if ($ConfigPath) { Split-Path -Parent $ConfigPath } else { $dir }
}
New-Item -ItemType Directory -Force $LogDir | Out-Null
$outLog = Join-Path $LogDir 'monitor.out.log'
$errLog = Join-Path $LogDir 'monitor.err.log'
$supLog = Join-Path $LogDir 'monitor.supervise.log'

function Write-SupLog([string]$Text) {
  Add-Content -Path $supLog -Value ("{0} {1}" -f (Get-Date).ToString('s'), $Text) -Encoding utf8
}

$recent = New-Object System.Collections.Generic.List[datetime]
Write-SupLog "supervisor started (pid $PID)"
while ($true) {
  $serverArgs = "`"$server`""
  if ($ConfigPath) { $serverArgs += " `"$ConfigPath`"" }
  $line = "`"$node`" $serverArgs >> `"$outLog`" 2>> `"$errLog`""
  $started = Get-Date
  $proc = Start-Process -FilePath $env:ComSpec -ArgumentList "/d /s /c `"$line`"" -WorkingDirectory $dir -WindowStyle Hidden -PassThru
  Write-SupLog "server started (cmd pid $($proc.Id))"
  $proc.WaitForExit()
  Write-SupLog ("server exited with code {0} after {1:N0} s" -f $proc.ExitCode, ((Get-Date) - $started).TotalSeconds)

  # Back off when it keeps crashing right away, so a broken build does not spin.
  $now = Get-Date
  $recent.Add($now)
  $recent.RemoveAll({ param($t) ($now - $t).TotalSeconds -gt 60 }) | Out-Null
  if ($recent.Count -ge 5) {
    Write-SupLog 'five exits in a minute; waiting 30 s'
    Start-Sleep -Seconds 30
    $recent.Clear()
  } else {
    Start-Sleep -Seconds 2
  }
}
