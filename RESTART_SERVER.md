# IMPORTANT: Restart Your Server!

The error "Server returned non-JSON response" means the server is still running old code.

## Steps to Fix:

1. **Stop the server:**
   - Find the terminal/PowerShell window where `npm start` is running
   - Press `Ctrl+C` to stop it
   - Wait for it to fully stop

2. **Start it again:**
   ```bash
   npm start
   ```

3. **Clear browser cache:**
   - Press `F12` to open developer tools
   - Right-click the refresh button
   - Select "Empty Cache and Hard Reload"

4. **Log out and log back in:**
   - This ensures your session is fresh
   - Select your employee name from the dropdown
   - Enter your password

5. **Try submitting a note again**

## If It Still Doesn't Work:

Check the server terminal for error messages. You should see:
- "Note submission - employee_id: [number]"
- "Note submission - session user: [object]"
- "Note submission - note_text: [your note]"

If you don't see these messages, the request isn't reaching the server.

## Check Browser Console:

1. Press `F12`
2. Go to "Console" tab
3. Try submitting a note
4. Look for any red error messages
5. Share those errors if you need help

