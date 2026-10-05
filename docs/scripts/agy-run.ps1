param(
  [Parameter(Mandatory)] [string] $Track,
  [Parameter(Mandatory)] [string] $Workdir,
  [Parameter(Mandatory)] [string] $Model,
  [Parameter(Mandatory)] [string] $Prompt,
  [Parameter(Mandatory)] [string] $ActivityFile,
  [Parameter(Mandatory)] [string] $StatusDir,
  [string] $Mode = "plan",
  [string] $ReportFile = "",
  [string] $Timeout = "30m"
)
# Runs one headless agy turn and keeps status-<track>.json fresh so the
# fleet monitor shows the track as working, then done or error.
$ErrorActionPreference = "Stop"
$agy = Join-Path $env:LOCALAPPDATA "agy\bin\agy.exe"
$statusFile = Join-Path $StatusDir "status-$Track.json"
$enc = New-Object System.Text.UTF8Encoding($false)

function Write-Status([hashtable] $s) {
  $s.track = $Track; $s.engine = "antigravity"; $s.time = (Get-Date).ToString("s")
  [IO.File]::WriteAllText($statusFile, ($s | ConvertTo-Json -Compress), $enc)
}

$errFile = "$ActivityFile.err"
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $agy
$psi.WorkingDirectory = $Workdir
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
$psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
$quoted = '"' + ($Prompt -replace '"', '\"') + '"'
$psi.Arguments = "-p $quoted --model `"$Model`" --mode $Mode --output-format stream-json --print-timeout $Timeout"
$proc = [System.Diagnostics.Process]::Start($psi)

$out = [IO.StreamWriter]::new($ActivityFile, $false, $enc)
$out.AutoFlush = $true
$errTask = $proc.StandardError.ReadToEndAsync()
Write-Status @{ state = "running"; pid = $proc.Id; message = "agy $Model" }
$last = Get-Date
while ($null -ne ($line = $proc.StandardOutput.ReadLine())) {
  $out.WriteLine($line)
  if (((Get-Date) - $last).TotalSeconds -ge 30) {
    Write-Status @{ state = "running"; pid = $proc.Id; message = "agy $Model" }
    $last = Get-Date
  }
}
$proc.WaitForExit()
$out.Close()
[IO.File]::WriteAllText($errFile, $errTask.Result, $enc)

# A soft-denied permission ends the turn as SUCCESS with an empty response:
# treat that as a failure, not as done.
$result = Get-Content $ActivityFile -Encoding UTF8 | Where-Object { $_ -match '"event":"result"' } | Select-Object -Last 1 | ConvertFrom-Json
# PowerShell 5.1: @($null).Count is 1, so count only real entries.
$denied = @($result.result.denied_actions | Where-Object { $_ }).Count
$ok = $proc.ExitCode -eq 0 -and $result -and $result.result.status -eq "SUCCESS" -and
      "$($result.result.response)".Trim() -ne "" -and $denied -eq 0
$exit = if ($ok) { 0 } elseif ($proc.ExitCode -ne 0) { $proc.ExitCode } else { 1 }
$tokens = if ($result) { $result.result.usage.total_tokens } else { 0 }
if ($ok -and $ReportFile) { [IO.File]::WriteAllText($ReportFile, $result.result.response, $enc) }
Write-Status @{ state = "finished"; exitCode = $exit; message = $(if ($ok) { "DONE - tokens $tokens" } else { "FAILED - tokens $tokens" }) }
"STATUS: $(if ($ok) { 'OK' } else { 'FAILED' }) exit=$exit tokens=$tokens"
