# ViralCut — stop the local stack. (Your data is NOT deleted.)
# Run via stop.bat, or:  powershell -ExecutionPolicy Bypass -File stop.ps1
$proj = "E:\Social Media Video"
Set-Location $proj

Write-Host "Stopping web app + worker (node)..." -ForegroundColor Cyan
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host "Stopping Cloudflare tunnel..." -ForegroundColor Cyan
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host "Stopping PostgreSQL + Redis containers..." -ForegroundColor Cyan
docker compose stop

Write-Host ""
Write-Host "Stopped. Your data is safe - DB volumes and the storage/ folder persist." -ForegroundColor Green
Write-Host "Ollama + Docker Desktop are left running; quit them from the system tray if you want."
