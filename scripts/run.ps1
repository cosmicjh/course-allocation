param(
  [Parameter(Position=0)][string]$Task='dev',
  [Parameter(ValueFromRemainingArguments=$true)][string[]]$TaskArguments
)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$nodeCommand=Get-Command node.exe -ErrorAction SilentlyContinue
$runtimeRoot=Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
$nodePath=if($nodeCommand){$nodeCommand.Source}else{Join-Path $runtimeRoot 'node\bin\node.exe'}
if(-not(Test-Path -LiteralPath $nodePath)){throw 'Node.js 24를 설치한 뒤 다시 실행하세요.'}
$originalPath=$env:PATH
$env:PATH=(Split-Path -Parent $nodePath)+';'+$env:PATH
Push-Location -LiteralPath $projectRoot
try {
  $pnpmCommand=Get-Command pnpm.cmd -ErrorAction SilentlyContinue
  $pnpmScript=Join-Path $runtimeRoot 'node\node_modules\pnpm\bin\pnpm.cjs'
  $commandArguments=if($Task -eq 'install'){@('install')+ $TaskArguments}else{@('run',$Task)+ $TaskArguments}
  if($pnpmCommand){& $pnpmCommand.Source @commandArguments}
  elseif(Test-Path -LiteralPath $pnpmScript){& $nodePath $pnpmScript @commandArguments}
  else{throw 'pnpm 11.25.0을 설치한 뒤 다시 실행하세요.'}
  if($LASTEXITCODE -ne 0){throw "작업 실패: $Task (종료 코드 $LASTEXITCODE)"}
} finally {Pop-Location; $env:PATH=$originalPath}
