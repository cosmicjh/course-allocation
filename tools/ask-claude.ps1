# Windows PowerShell 5.1 native Claude CLI wrapper. ASCII source. UTF-8 file I/O.
# NO hooks, scheduled tasks, services, auto deployment, or unattended retries.
$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$req = Join-Path $root 'docs\advice\request.md'
$rules = Join-Path $root 'docs\advice\ADVISOR_PROMPT.md'
$res = Join-Path $root 'docs\advice\response.md'
$tag = [guid]::NewGuid().ToString('N')
$stdin = Join-Path $env:TEMP ('claude-advice-' + $tag + '.in')
$stdout = Join-Path $env:TEMP ('claude-advice-' + $tag + '.out')
$stderr = Join-Path $env:TEMP ('claude-advice-' + $tag + '.err')
$utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)
$utf8 = New-Object System.Text.UTF8Encoding($false)

function ShortDiagnostic([string]$value) {
    if ([string]::IsNullOrWhiteSpace($value)) { return '(empty)' }
    $clean = $value.Trim() -replace 'sk-ant-[a-zA-Z0-9_-]+', '[REDACTED]'
    $clean = $clean -replace '(?i)(bearer\s+)[a-zA-Z0-9._-]+', '${1}[REDACTED]'
    if ($clean.Length -gt 1400) { $clean = $clean.Substring(0, 1400) + ' [truncated]' }
    return $clean
}

try {
    $cmd = Get-Command claude.exe -CommandType Application -ErrorAction SilentlyContinue
    if (-not $cmd) { throw 'Native claude.exe not found. Install the official native CLI and restart the terminal.' }
    if ($env:ANTHROPIC_API_KEY -or $env:ANTHROPIC_AUTH_TOKEN) {
        throw 'Anthropic API/auth environment variable detected. Confirm subscription billing before running.'
    }
    if (-not (Test-Path -LiteralPath $req -PathType Leaf)) { throw 'request.md is missing.' }
    if (-not (Test-Path -LiteralPath $rules -PathType Leaf)) { throw 'ADVISOR_PROMPT.md is missing.' }
    $request = [System.IO.File]::ReadAllText($req, $utf8Strict)
    if ([string]::IsNullOrWhiteSpace($request)) { throw 'request.md is empty.' }

    # Empty stdin avoids waiting for interactive input from the Codex host.
    [System.IO.File]::WriteAllText($stdin, '', $utf8)
    if (Test-Path -LiteralPath $res) { Remove-Item -LiteralPath $res -Force }

    # Static ASCII CLI args; `--safe-mode` preserves subscription auth (unlike `--bare`).
    # The quoted prompt itself contains no double quotes.
    $cliArgs = '--safe-mode --restricted --tools "Read,Grep,Glob" --allowedTools "Read,Grep,Glob" --model opus --effort high --max-turns 30 --no-session-persistence --output-format json -p "Read docs/advice/ADVISOR_PROMPT.md and docs/advice/request.md. Analyze related repository files. Do not edit files or execute commands. Answer in Korean."'
    $p = Start-Process -FilePath $cmd.Source -WorkingDirectory $root `
        -ArgumentList $cliArgs -RedirectStandardInput $stdin `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr `
        -NoNewWindow -PassThru

    # Prevent an indefinite wait. Do not leave the main Claude process running.
    if (-not $p.WaitForExit(600000)) {
        if (-not $p.HasExited) {
            try { $p.Kill(); $p.WaitForExit() } catch { }
        }
        throw 'Claude timed out after 10 minutes; no advice was saved.'
    }
    $p.Refresh()

    $raw = if (Test-Path -LiteralPath $stdout) {
        [System.IO.File]::ReadAllText($stdout, $utf8Strict)
    } else { '' }
    $err = if (Test-Path -LiteralPath $stderr) {
        [System.IO.File]::ReadAllText($stderr, $utf8Strict)
    } else { '' }
    $obj = $null
    if (-not [string]::IsNullOrWhiteSpace($raw)) {
        try { $obj = ConvertFrom-Json -InputObject $raw } catch { }
    }
    if ($p.ExitCode -ne 0) {
        $details = if ($obj -and $obj.result) { [string]$obj.result }
                   elseif ($obj -and $obj.errors) { [string]($obj.errors -join '; ') }
                   elseif (-not [string]::IsNullOrWhiteSpace($err)) { $err }
                   else { $raw }
        throw ('Claude failed (exit=' + $p.ExitCode + '): ' + (ShortDiagnostic $details))
    }
    if (-not $obj) {
        throw ('Claude returned invalid or empty JSON: ' + (ShortDiagnostic $raw))
    }
    if ($obj.is_error -eq $true -or ($obj.subtype -and $obj.subtype -ne 'success')) {
        throw ('Claude reported an error (' + [string]$obj.subtype + '): ' + (ShortDiagnostic ([string]$obj.result)))
    }
    $answer = [string]$obj.result
    if ([string]::IsNullOrWhiteSpace($answer)) { throw 'Claude result is empty.' }

    # Do not attach a fresh answer to a request that changed during analysis.
    if ($request -ne [System.IO.File]::ReadAllText($req, $utf8Strict)) {
        throw 'request.md changed during the Claude invocation. No response was saved.'
    }
    [System.IO.File]::WriteAllText($res, ($answer.Trim() + "`n"), $utf8)
    Write-Host ('OK: ' + $res)
}
finally {
    Remove-Item -LiteralPath $stdin, $stdout, $stderr -Force -ErrorAction SilentlyContinue
}
