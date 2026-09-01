$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add('http://localhost:3000/')
$listener.Start()
Write-Host "Server listening on http://localhost:3000/"

# Generate public/js/4bot-browser.js
$jsDir = Join-Path $PSScriptRoot "public\js"
if (-not (Test-Path $jsDir)) { New-Item -ItemType Directory -Force -Path $jsDir | Out-Null }
$srcFile = Join-Path $PSScriptRoot "4bot.js"
$destFile = Join-Path $jsDir "4bot-browser.js"

Write-Host "Converting 4bot.js to public/js/4bot-browser.js..."
$content = Get-Content -Path $srcFile -Raw
$content = $content -replace 'module\.exports = FourBotStrategy;', 'window.FourBotStrategy = FourBotStrategy;'
$content = $content -replace 'console\.log\(', 'window.hedgeClient.log('
$content = $content -replace 'console\.error\(', 'window.hedgeClient.error('
Set-Content -Path $destFile -Value $content
Write-Host "Conversion complete."

$mimeTypes = @{
    '.html' = 'text/html'
    '.css'  = 'text/css'
    '.js'   = 'application/javascript'
    '.json' = 'application/json'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
}

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response
    
    $localPath = $request.Url.LocalPath
    if ($localPath -eq '/') { $localPath = '/dashboard.html' }
    
    $filePath = Join-Path (Join-Path $PSScriptRoot 'public') $localPath.TrimStart('/')
    
    if (Test-Path $filePath) {
        $ext = [System.IO.Path]::GetExtension($filePath)
        $contentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { 'application/octet-stream' }
        $response.ContentType = $contentType
        $bytes = [System.IO.File]::ReadAllBytes($filePath)
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
        $response.StatusCode = 404
        $msg = [System.Text.Encoding]::UTF8.GetBytes('Not Found')
        $response.OutputStream.Write($msg, 0, $msg.Length)
    }
    $response.Close()
}
