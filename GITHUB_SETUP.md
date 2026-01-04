# How to Upload to GitHub

## Step 1: Install Git (if not already installed)

1. Download Git from: https://git-scm.com/download/win
2. Run the installer with default settings
3. Restart your terminal/PowerShell after installation

## Step 2: Configure Git (First Time Only)

Open PowerShell and run:
```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

## Step 3: Initialize Git Repository

Navigate to your project folder and run:
```bash
cd "D:\Jackie Time Clock"
git init
```

## Step 4: Add All Files

```bash
git add .
```

## Step 5: Create Initial Commit

```bash
git commit -m "Initial commit: Time Clock System with employee dashboard"
```

## Step 6: Create GitHub Repository

1. Go to https://github.com and sign in (or create an account)
2. Click the "+" icon in the top right
3. Select "New repository"
4. Name it: `jackie-time-clock` (or any name you prefer)
5. **DO NOT** initialize with README, .gitignore, or license (we already have these)
6. Click "Create repository"

## Step 7: Connect and Push to GitHub

GitHub will show you commands. Use these (replace YOUR_USERNAME with your GitHub username):

```bash
git remote add origin https://github.com/YOUR_USERNAME/jackie-time-clock.git
git branch -M main
git push -u origin main
```

You'll be prompted for your GitHub username and password (use a Personal Access Token if 2FA is enabled).

## Alternative: Using GitHub Desktop

If you prefer a graphical interface:

1. Download GitHub Desktop: https://desktop.github.com/
2. Install and sign in with your GitHub account
3. Click "File" > "Add Local Repository"
4. Select "D:\Jackie Time Clock"
5. Click "Publish repository" to create it on GitHub

## Future Updates

After making changes, use these commands to update GitHub:

```bash
git add .
git commit -m "Description of your changes"
git push
```

## Important Notes

- The `.gitignore` file ensures `node_modules/` and `timeclock.db` are NOT uploaded (these are too large and should be local only)
- Never commit passwords or sensitive data
- The database file (`timeclock.db`) is excluded - each user will create their own locally

