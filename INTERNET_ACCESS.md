# How to Access Your Time Clock from the Internet

Your server is now configured to accept connections from any network interface. Here's how to make it accessible from the internet:

## Quick Start

1. **Start your server:**
   ```bash
   npm start
   ```
   The server will show your local IP address in the console.

2. **Access on your local network:**
   - Other devices on your WiFi/network can access it using the IP address shown (e.g., `http://192.168.1.100:3000`)

## Making it Internet-Accessible

### Option 1: Port Forwarding (For Home/Office Network)

1. **Find your computer's local IP:**
   - Windows: Open Command Prompt and type `ipconfig`
   - Look for "IPv4 Address" (e.g., 192.168.1.100)

2. **Configure your router:**
   - Log into your router's admin panel (usually `http://192.168.1.1` or `http://192.168.0.1`)
   - Find "Port Forwarding" or "Virtual Server" settings
   - Add a new rule:
     - External Port: `3000`
     - Internal IP: Your computer's IP (from step 1)
     - Internal Port: `3000`
     - Protocol: TCP
     - Save the rule

3. **Find your public IP:**
   - Visit https://whatismyipaddress.com/
   - Note your public IP address

4. **Access from anywhere:**
   - Use: `http://YOUR_PUBLIC_IP:3000`
   - Note: Your public IP may change if you don't have a static IP

### Option 2: Use a Cloud Service (Recommended for Production)

For a more reliable and secure solution, deploy to:
- **Heroku** (Free tier available)
- **DigitalOcean** ($5/month)
- **AWS** (Pay as you go)
- **Railway** (Free tier available)

### Option 3: Use a Tunneling Service (Easiest for Testing)

1. **Install ngrok:**
   - Download from https://ngrok.com/
   - Sign up for a free account

2. **Start your server:**
   ```bash
   npm start
   ```

3. **In another terminal, run ngrok:**
   ```bash
   ngrok http 3000
   ```

4. **Use the ngrok URL:**
   - ngrok will give you a public URL like `https://abc123.ngrok.io`
   - Share this URL to access your time clock from anywhere

## Security Warnings

⚠️ **IMPORTANT:** Before exposing to the internet:

1. **Change default passwords:**
   - Default admin: `admin` / `admin123`
   - Default employees: `password123`
   - These are insecure for internet access!

2. **Consider adding HTTPS:**
   - Use a reverse proxy like nginx with Let's Encrypt
   - Or deploy to a service that provides HTTPS

3. **Firewall:**
   - Make sure your computer's firewall allows port 3000
   - Windows: Allow Node.js through Windows Firewall

4. **Update session secret:**
   - Change the session secret in `server.js` to a random string

## Testing

1. Start the server
2. Check the console output for your network IP
3. Try accessing from another device on the same network
4. If that works, proceed with port forwarding for internet access

## Troubleshooting

- **Can't access from other devices on network:**
  - Check Windows Firewall settings
  - Make sure both devices are on the same network
  - Try disabling firewall temporarily to test

- **Can't access from internet:**
  - Verify port forwarding is configured correctly
  - Check if your ISP blocks incoming connections
  - Some ISPs require business accounts for port forwarding

- **Port already in use:**
  - Change PORT in server.js or set environment variable: `set PORT=8080` (Windows) or `export PORT=8080` (Mac/Linux)

