# Packages the Vamber AI Chrome Extension into a distribution ZIP ready for GitHub Release
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir

Set-Location $rootDir

if (-not (Test-Path "manifest.json")) {
    Write-Error "manifest.json not found in $rootDir"
}

$manifest = Get-Content -Raw -Path "manifest.json" | ConvertFrom-Json
$version = $manifest.version
$outputZip = Join-Path $rootDir "vamber-ai-v$version.zip"

Write-Host "Packaging Vamber AI v$version..." -ForegroundColor Cyan

$filesToInclude = @(
    "manifest.json",
    "background.js",
    "content.js",
    "popup.html",
    "popup.css",
    "popup.js",
    "icons"
)

Compress-Archive -Path $filesToInclude -DestinationPath $outputZip -Force

Write-Host "Package created: $outputZip" -ForegroundColor Green
