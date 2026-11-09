@echo off
title Vamber AI — Auto Updater
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop'; " ^
  "$dir = '%~dp0'; " ^
  "Write-Host 'Checking GitHub for the latest Vamber AI release...' -ForegroundColor Cyan; " ^
  "$rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/de4d0t/Vamber-ai/releases/latest' -Headers @{ Accept = 'application/vnd.github+json' }; " ^
  "$tag = $rel.tag_name; " ^
  "$asset = $rel.assets | Where-Object { $_.name -like '*.zip' } | Select-Object -First 1; " ^
  "$url = if ($asset) { $asset.browser_download_url } else { \"https://github.com/de4d0t/Vamber-ai/releases/download/$tag/vamber-ai-$tag.zip\" }; " ^
  "$tmp = Join-Path $env:TEMP \"vamber-ai-$tag.zip\"; " ^
  "Write-Host \"Downloading Vamber AI $tag...\" -ForegroundColor Cyan; " ^
  "Invoke-WebRequest -Uri $url -OutFile $tmp; " ^
  "Write-Host 'Extracting files into extension folder...' -ForegroundColor Cyan; " ^
  "Expand-Archive -Path $tmp -DestinationPath $dir -Force; " ^
  "Remove-Item $tmp -Force -ErrorAction SilentlyContinue; " ^
  "Write-Host \"Successfully updated to Vamber AI $tag!\" -ForegroundColor Green; " ^
  "Write-Host 'Now click the Reload icon inside the Vamber AI popup in Chrome.' -ForegroundColor Yellow; " ^
  "Start-Sleep -Seconds 3"
