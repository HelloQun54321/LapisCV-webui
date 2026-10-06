$ErrorActionPreference = 'Stop'
$taskRuntimeFile = Join-Path $PSScriptRoot '.local/runtime.json'
if (-not (Test-Path -LiteralPath $taskRuntimeFile)) { Write-Host '没有由启动脚本创建的服务。npm start 启动的服务请用 Ctrl+C 停止。'; exit }
$taskRuntime = Get-Content -LiteralPath $taskRuntimeFile -Raw | ConvertFrom-Json
$taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskRuntime.pid)"
if ($taskProcess) {
    $taskServer = Join-Path $PSScriptRoot 'src/server.mjs'
    if ($taskProcess.Name -ne 'node.exe' -or -not $taskProcess.CommandLine.Contains($taskServer)) { throw 'PID 已被其他程序复用，停止操作已取消。' }
    Stop-Process -Id $taskRuntime.pid
    Write-Host '简历工作台已停止。'
} else { Write-Host '服务已经停止。' }
Remove-Item -LiteralPath $taskRuntimeFile
