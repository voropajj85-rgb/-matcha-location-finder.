[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)][int]$Port = 4173,
    [switch]$Tunnel
)
$ErrorActionPreference = 'Stop'
$previewRoot = Split-Path -Parent $PSScriptRoot
$serverScript = Join-Path $PSScriptRoot 'preview-server.py'
if (-not (Test-Path -LiteralPath (Join-Path $previewRoot 'index.html'))) {
    throw 'Run this helper from a complete Matcha Location Finder checkout.'
}
$python = Get-Command python -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$pythonArgs = @()
if (-not $python) {
    $python = Get-Command py -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    $pythonArgs = @('-3')
}
if (-not $python) { throw 'Python 3 is required. Nothing was installed automatically.' }
$cloudflared = Get-Command cloudflared -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($Tunnel -and -not $cloudflared) {
    Write-Warning 'cloudflared is not installed/on PATH. Starting LAN preview only.'
    Write-Host 'Optional free installation: winget install --id Cloudflare.cloudflared --exact --source winget'
    Write-Host 'Then open a new terminal and run this helper with -Tunnel.'
}

# Refuse occupied ports rather than reusing another project's server/tunnel.
$probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)
try { $probe.Start() }
catch { throw "Port $Port is unavailable. Choose another port with -Port; no existing process was stopped." }
finally { $probe.Stop() }

$previewLogs = Join-Path ([System.IO.Path]::GetTempPath()) ('matcha-preview-' + [guid]::NewGuid().ToString('N'))
[void][System.IO.Directory]::CreateDirectory($previewLogs)
$server = $null
$tunnelProcess = $null
try {
    $server = Start-Process -FilePath $python.Source -ArgumentList ($pythonArgs + @('-u', ('"' + $serverScript + '"'), '--port', $Port)) -WorkingDirectory $previewRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $previewLogs 'server.out') -RedirectStandardError (Join-Path $previewLogs 'server.err')
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if ($server.HasExited) { throw ('Static server failed: ' + [System.IO.File]::ReadAllText((Join-Path $previewLogs 'server.err'))) }
        try {
            # Probe IPv4 explicitly: .NET can stall on localhost's IPv6 address
            # when the requested server is intentionally bound to 0.0.0.0.
            $request = [System.Net.HttpWebRequest]::Create(('http://{0}:{1}/index.html' -f [System.Net.IPAddress]::Loopback, $Port))
            $request.Proxy = $null
            $request.Timeout = 1000
            $response = $request.GetResponse()
            $ready = [int]$response.StatusCode -eq 200
            $response.Close()
            if ($ready) { break }
        } catch { Start-Sleep -Milliseconds 200 }
    }
    if (-not $ready) { throw 'The static server did not become ready.' }
    Write-Host "Document root: $previewRoot"
    Write-Host 'Binding: 0.0.0.0 (all IPv4 interfaces)'
    Write-Host "PC-only check: http://localhost:$Port/"
    $lanAddresses = @([System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
        Where-Object { $_.OperationalStatus -eq 'Up' -and $_.NetworkInterfaceType -ne 'Loopback' } |
        ForEach-Object { $_.GetIPProperties().UnicastAddresses } |
        Where-Object { $_.Address.AddressFamily -eq 'InterNetwork' -and -not $_.Address.ToString().StartsWith('169.254.') } |
        ForEach-Object { $_.Address.ToString() } | Sort-Object -Unique)
    foreach ($address in $lanAddresses) { Write-Host "Same-WiFi/LAN only: http://${address}:$Port/" }
    if (-not $lanAddresses.Count) { Write-Warning 'No LAN IPv4 address detected. Check ipconfig on the PC.' }
    Write-Host 'Mobile internet / stable main preview: https://voropajj85-rgb.github.io/-matcha-location-finder./'
    Write-Host 'Keep this terminal open. Ctrl+C stops this helper and its child processes.'
    if ($Tunnel -and $cloudflared) {
        Write-Host "Starting temporary tunnel: cloudflared tunnel --url http://localhost:$Port"
        $tunnelProcess = Start-Process -FilePath $cloudflared.Source -ArgumentList @('tunnel', '--url', "http://localhost:$Port") -WorkingDirectory $previewRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $previewLogs 'tunnel.out') -RedirectStandardError (Join-Path $previewLogs 'tunnel.err')
    }
    $publicUrl = $null
    $tunnelExitReported = $false
    while (-not $server.HasExited) {
        if ($tunnelProcess -and -not $publicUrl) {
            $output = [System.IO.File]::ReadAllText((Join-Path $previewLogs 'tunnel.out')) + [System.IO.File]::ReadAllText((Join-Path $previewLogs 'tunnel.err'))
            if ($output -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
                $publicUrl = $Matches[0]
                Write-Host "PUBLIC TUNNEL URL (iPhone/mobile internet): $publicUrl"
                Write-Host 'Temporary URL: available only while the PC, server and tunnel remain running.'
            }
        }
        if ($tunnelProcess -and $tunnelProcess.HasExited -and -not $tunnelExitReported) {
            Write-Warning "Tunnel exited (code $($tunnelProcess.ExitCode)); the public tunnel URL is unavailable. LAN preview remains running."
            Write-Host "Diagnostic logs: $previewLogs (temporary; not in the repository)"
            $tunnelExitReported = $true
        }
        Start-Sleep -Milliseconds 300
    }
    throw 'The static server stopped unexpectedly.'
} finally {
    foreach ($ownedProcess in @($tunnelProcess, $server)) {
        if ($ownedProcess) {
            if (-not $ownedProcess.HasExited) { Stop-Process -Id $ownedProcess.Id -ErrorAction SilentlyContinue }
            $ownedProcess.Dispose()
        }
    }
    # Logs remain in the OS temporary directory for diagnostics, never in Git.
}
