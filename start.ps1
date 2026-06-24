# ViralCut — start the whole local stack after a reboot.
# Run via the one-click start.bat, or:  powershell -ExecutionPolicy Bypass -File start.ps1
$proj = "E:\Social Media Video"
$cf   = "C:\Users\Idrees Malik\.cloudflared\config.yml"
Set-Location $proj

function Step($n, $msg) { Write-Host ("[{0}] {1}" -f $n, $msg) -ForegroundColor Cyan }

# 1. Docker Desktop + PostgreSQL/Redis ---------------------------------------
Step 1 "Checking Docker..."
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "    Docker isn't running - launching Docker Desktop (can take a minute)..." -ForegroundColor Yellow
  Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  do { Start-Sleep -Seconds 3; docker info *> $null } until ($LASTEXITCODE -eq 0)
}
Step 1 "Starting PostgreSQL + Redis containers..."
docker compose up -d

# 2. Ollama (local AI) -------------------------------------------------------
Step 2 "Checking Ollama..."
try { ollama list *> $null; if ($LASTEXITCODE -ne 0) { throw } Write-Host "    Ollama OK." -ForegroundColor Green }
catch { Write-Host "    Ollama not detected - open the Ollama app from the Start menu, then re-run." -ForegroundColor Yellow }

# 3. Web app (new window) ----------------------------------------------------
Step 3 "Launching the web app..."
Start-Process powershell -ArgumentList "-NoExit","-Command","Set-Location '$proj'; npm run dev"

# 4. Worker (new window) -----------------------------------------------------
Step 4 "Launching the publish/processing worker..."
Start-Process powershell -ArgumentList "-NoExit","-Command","Set-Location '$proj'; npm run worker"

# 5. Cloudflare tunnel (new window) ------------------------------------------
Step 5 "Launching the Cloudflare tunnel (public domain)..."
Start-Process powershell -ArgumentList "-NoExit","-Command","& '$proj\cloudflared.exe' tunnel --config '$cf' run"

Write-Host ""
Write-Host "Done - three windows opened (app, worker, tunnel). Leave them running." -ForegroundColor Green
Write-Host "  Local:  http://localhost:3000"
Write-Host "  Public: https://viralcut.idreesmalik.com  (use this one for publishing/OAuth)"
Write-Host "Give it ~15 seconds to warm up, then open the public URL."
