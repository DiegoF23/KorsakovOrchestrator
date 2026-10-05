param(
  [Parameter(Mandatory)] [string] $Track,
  [Parameter(Mandatory)] [string] $Workdir,
  [Parameter(Mandatory)] [string] $Model,
  [Parameter(Mandatory)] [string] $Prompt,
  [Parameter(Mandatory)] [string] $StatusDir,
  [string] $Variant = "",
  [string] $Agent = "plan",
  [string] $Server = "http://127.0.0.1:4096",
  [string] $ReportFile = ""
)
# Runs one headless OpenCode turn attached to the shared server (so the fleet
# monitor can read the session by directory) and keeps status-<track>.json fresh.
$ErrorActionPreference = "Stop"
$statusFile = Join-Path $StatusDir "status-$Track.json"
$enc = New-Object System.Text.UTF8Encoding($false)

function Write-Status([hashtable] $s) {
  $s.track = $Track; $s.engine = "opencode"; $s.time = (Get-Date).ToString("s")
  [IO.File]::WriteAllText($statusFile, ($s | ConvertTo-Json -Compress), $enc)
}

$ocArgs = @("run", "--attach", $Server, "--dir", $Workdir, "--agent", $Agent, "-m", $Model, "--title", $Track)
if ($Variant) { $ocArgs += @("--variant", $Variant) }
$quoted = ($ocArgs | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "$env:ComSpec"
$psi.WorkingDirectory = $Workdir
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.RedirectStandardInput = $true
$psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
$psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
$psi.Arguments = "/c opencode $quoted `"$($Prompt -replace '"', "'")`""
$proc = [System.Diagnostics.Process]::Start($psi)
$proc.StandardInput.Close()
Write-Status @{ state = "running"; pid = $proc.Id; message = "opencode $Model" }

$outTask = $proc.StandardOutput.ReadToEndAsync()
$errTask = $proc.StandardError.ReadToEndAsync()
while (-not $proc.WaitForExit(30000)) {
  Write-Status @{ state = "running"; pid = $proc.Id; message = "opencode $Model" }
}
Write-Status @{ state = "running"; pid = $proc.Id; message = "opencode $Model" }
$out = $outTask.Result
[IO.File]::WriteAllText((Join-Path $StatusDir "$Track.err"), $errTask.Result, $enc)
$ok = $proc.ExitCode -eq 0 -and $out.Trim() -ne ""
if ($ReportFile -and $out.Trim()) { [IO.File]::WriteAllText($ReportFile, $out, $enc) }
Write-Status @{ state = "finished"; exitCode = $(if ($ok) { 0 } else { [Math]::Max(1, $proc.ExitCode) }); message = $(if ($ok) { "DONE" } else { "FAILED" }) }
"STATUS: $(if ($ok) { 'OK' } else { 'FAILED' }) exit=$($proc.ExitCode)"
