param([int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 3210 }), [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskUrl = "http://127.0.0.1:$Port"
if ($Port -lt 1 -or $Port -gt 65535) { throw '端口须在 1–65535 之间' }
$taskNode = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'node_modules/marked/package.json')) -or -not (Test-Path -LiteralPath (Join-Path $taskRoot 'node_modules/@tiptap/core/package.json')) -or -not (Test-Path -LiteralPath (Join-Path $taskRoot 'node_modules/pdfjs-dist/package.json'))) {
    Push-Location -LiteralPath $taskRoot
    try { & npm.cmd ci --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw '依赖安装失败' } }
    finally { Pop-Location }
}
$taskLocal = Join-Path $taskRoot '.local'
New-Item -ItemType Directory -Path $taskLocal -Force | Out-Null
$taskHealth = $null
try { $taskHealth = Invoke-RestMethod "$taskUrl/api/health" -TimeoutSec 2 } catch {}
if ($taskHealth) {
    if ($taskHealth.app -ne 'resume-cn-webui' -or $taskHealth.root -ne $taskRoot) { throw "端口 $Port 正被另一个服务占用。用 -Port 指定其他端口。" }
    Write-Host "简历工作台已在运行：$taskUrl"
} else {
    $env:PORT = [string]$Port
    $taskServer = Join-Path $taskRoot 'src/server.mjs'
    $taskProcess = Start-Process -FilePath $taskNode -ArgumentList @('"' + $taskServer + '"') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskLocal 'server.log') -RedirectStandardError (Join-Path $taskLocal 'server-error.log') -PassThru
    for ($taskAttempt = 0; $taskAttempt -lt 50; $taskAttempt++) {
        Start-Sleep -Milliseconds 200
        try { $taskHealth = Invoke-RestMethod "$taskUrl/api/health" -TimeoutSec 1 } catch {}
        if ($taskHealth -and $taskHealth.app -eq 'resume-cn-webui' -and $taskHealth.root -eq $taskRoot) { break }
        if ($taskProcess.HasExited) { throw "启动失败，请查看 $taskLocal/server-error.log" }
    }
    if (-not $taskHealth -or $taskHealth.root -ne $taskRoot) { throw "服务未就绪，请查看 $taskLocal/server-error.log" }
    @{ pid = $taskProcess.Id; port = $Port; root = $taskRoot } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskLocal 'runtime.json') -Encoding UTF8
    Write-Host "简历工作台已启动：$taskUrl"
}
if (-not $NoBrowser) { Start-Process $taskUrl }
