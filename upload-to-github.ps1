# PowerShell script to upload Time Clock to GitHub
# Run this after installing Git

Write-Host "=== Time Clock GitHub Upload Script ===" -ForegroundColor Cyan
Write-Host ""

# Check if Git is installed
try {
    $gitVersion = git --version
    Write-Host "Git found: $gitVersion" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Git is not installed!" -ForegroundColor Red
    Write-Host "Please install Git from: https://git-scm.com/download/win" -ForegroundColor Yellow
    Write-Host "Then run this script again." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "Step 1: Initializing Git repository..." -ForegroundColor Cyan
if (Test-Path .git) {
    Write-Host "Git repository already exists." -ForegroundColor Yellow
} else {
    git init
    Write-Host "Git repository initialized." -ForegroundColor Green
}

Write-Host ""
Write-Host "Step 2: Adding all files..." -ForegroundColor Cyan
git add .
Write-Host "Files added." -ForegroundColor Green

Write-Host ""
Write-Host "Step 3: Creating commit..." -ForegroundColor Cyan
git commit -m "Initial commit: Time Clock System with employee dashboard and manager controls"
Write-Host "Commit created." -ForegroundColor Green

Write-Host ""
Write-Host "=== Next Steps ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Go to https://github.com and create a new repository" -ForegroundColor Yellow
Write-Host "2. Name it: jackie-time-clock (or any name you prefer)" -ForegroundColor Yellow
Write-Host "3. DO NOT initialize with README, .gitignore, or license" -ForegroundColor Yellow
Write-Host "4. Copy the repository URL (e.g., https://github.com/YOUR_USERNAME/jackie-time-clock.git)" -ForegroundColor Yellow
Write-Host ""
Write-Host "5. Then run these commands (replace YOUR_USERNAME and REPO_NAME):" -ForegroundColor Yellow
Write-Host "   git remote add origin https://github.com/YOUR_USERNAME/REPO_NAME.git" -ForegroundColor White
Write-Host "   git branch -M main" -ForegroundColor White
Write-Host "   git push -u origin main" -ForegroundColor White
Write-Host ""
Write-Host "Or use GitHub Desktop for a graphical interface!" -ForegroundColor Cyan
Write-Host ""

