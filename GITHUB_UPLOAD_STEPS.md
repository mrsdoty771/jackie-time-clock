# Steps to Upload to GitHub

## Step 1: Configure Git (First Time Only)

Run these commands in PowerShell (replace with your info):

```powershell
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

Or for this repository only:

```powershell
git config user.name "Your Name"
git config user.email "your.email@example.com"
```

## Step 2: Commit Your Changes

```powershell
git add .
git commit -m "Time Clock System - Complete application with employee dashboard and manager controls"
```

## Step 3: Create GitHub Repository

1. Go to https://github.com and sign in
2. Click the "+" icon → "New repository"
3. Name it: `jackie-time-clock` (or any name)
4. **DO NOT** check "Initialize with README"
5. Click "Create repository"

## Step 4: Connect and Push

After creating the repository, GitHub will show you commands. Use these (replace YOUR_USERNAME):

```powershell
git remote add origin https://github.com/YOUR_USERNAME/jackie-time-clock.git
git branch -M main
git push -u origin main
```

You'll be prompted for your GitHub username and password (use a Personal Access Token if you have 2FA enabled).

## Alternative: Use GitHub Desktop

1. Download: https://desktop.github.com/
2. Sign in with your GitHub account
3. Click "File" → "Add Local Repository"
4. Select: `D:\Jackie Time Clock`
5. Click "Publish repository"

## Files Being Uploaded

- ✅ All source code (server.js, app.js, index.html, styles.css)
- ✅ Configuration files (package.json, .gitignore)
- ✅ Documentation (README.md, etc.)
- ❌ node_modules/ (excluded - too large)
- ❌ timeclock.db (excluded - local database)

