# Máy chủ tĩnh tối giản (không cần Node/Python) để chạy thử app trong trình duyệt: http://localhost:8080/
param([int]$Port = 8080)
$root = Split-Path -Parent $PSScriptRoot
$mime = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.mjs'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8';
  '.json'='application/json; charset=utf-8'; '.png'='image/png'; '.jpg'='image/jpeg'; '.svg'='image/svg+xml'; '.ico'='image/x-icon'; '.webmanifest'='application/manifest+json'; '.txt'='text/plain; charset=utf-8' }
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Host "Phục vụ $root tại http://localhost:$Port/"
while ($l.IsListening) {
  $ctx = $l.GetContext()
  try {
    $p = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($p -eq '/') { $ctx.Response.Redirect('/www/index.html'); $ctx.Response.Close(); continue }
    if ($p -eq '/www/') { $p = '/www/index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $p.TrimStart('/')))
    if (-not $file.StartsWith($root) -or -not (Test-Path $file -PathType Leaf)) { $ctx.Response.StatusCode = 404; $bytes = [Text.Encoding]::UTF8.GetBytes('404'); }
    else {
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $ctx.Response.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $ctx.Response.Headers.Add('Cache-Control', 'no-store')
      $bytes = [IO.File]::ReadAllBytes($file)
    }
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch { Write-Host $_ } finally { $ctx.Response.Close() }
}
