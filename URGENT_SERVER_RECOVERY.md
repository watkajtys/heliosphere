# 🚨 URGENT: Server Recovery Instructions - LOCKED OUT

**Date:** September 11, 2025  
**Server:** 65.109.0.112 (Hetzner VPS)  
**Status:** COMPLETELY LOCKED OUT - No SSH Access

## What Happened

### September 11, 2025 - Initial Lockout
During server hardening on Sep 11, 2025, the following changes resulted in complete lockout:

1. **UFW Firewall** was enabled with `ufw --force enable`
2. **SSH was hardened** with:
   - Root login disabled (`PermitRootLogin no`)
   - Password auth disabled (`PasswordAuthentication no`) 
   - Only heliolens user allowed (`AllowUsers heliolens`)
3. **Result:** ALL incoming TCP connections were blocked by firewall

### September 15, 2025 - Complete Server Failure
During recovery attempt:

1. **Server lost SSH completely** - SSH service wasn't installed after mounting system disk
2. **Production hadn't run for 4 days** - Cloudflare proxy URL was broken
3. **API calls failing** - Square brackets in URLs weren't URL-encoded
4. **Server had to be rebuilt** - Complete reinstall was faster than troubleshooting

## Current Server State

- ✅ Server is online (responds to ping)
- ❌ SSH port 22 - BLOCKED
- ❌ HTTP port 80 - BLOCKED  
- ❌ Monitor ports (3001, 3002, 3003) - BLOCKED
- ❌ ALL TCP ports - BLOCKED by UFW firewall

## How to Regain Access

### Method 1: Hetzner Cloud Console (RECOMMENDED)

1. **Login to Hetzner Cloud Console**
   - Go to: https://console.hetzner.cloud/
   - Login with your Hetzner account

2. **Access VNC Console**
   - Select your server (65.109.0.112)
   - Click the "Console" button (opens VNC console in browser)
   - This gives you direct console access like a physical keyboard

3. **Login to Console**
   ```
   Username: root
   Password: AJtha7MkUjkFxV9c7qWC!
   ```
   (Password is from your .env file - VPS_PASSWORD)

4. **Fix the Server** - Run these commands:
   ```bash
   # IMMEDIATELY disable the firewall that's blocking everything
   ufw disable
   
   # Remove the SSH config that locked out root
   rm /etc/ssh/sshd_config.d/99-hardening.conf
   
   # Restart SSH service
   systemctl restart ssh
   
   # Verify SSH is running
   systemctl status ssh
   ```

5. **Test SSH Access** from your local machine:
   ```bash
   ssh root@65.109.0.112
   ```

### Method 2: Hetzner Rescue System

If console doesn't work:

1. Login to Hetzner Robot panel
2. Go to "Rescue" tab
3. Activate rescue system
4. Reboot server
5. SSH into rescue system
6. Mount your disk and fix configs

### Method 3: Support Ticket

If neither method works:
- Open urgent support ticket with Hetzner
- Request emergency console access
- Mention firewall lockout

## What Went Wrong

### Firewall Issues
The UFW firewall was enabled with `--force` flag, which:
- May have ignored our allow rules (22, 80, 443)
- Applied default DENY ALL policy
- Blocked all incoming connections including SSH

Additionally, SSH config changes blocked root access completely, leaving no fallback.

### Production Issues (Sep 15, 2025)
1. **Broken Cloudflare Proxy**: The proxy URL `heliosphere-proxy.matty-f7e.workers.dev` didn't exist
2. **API URL Encoding**: Square brackets in API URLs must be URL-encoded (`%5B` and `%5D`)
3. **Node.js Version**: Server had Node v12, but app requires v20+
4. **Missing SSH**: After recovery mode, SSH wasn't installed on the mounted system

## Once You're Back In

After regaining access, here's what to do:

1. **Keep firewall disabled initially**
   ```bash
   ufw disable
   ```

2. **Test SSH thoroughly** before re-enabling security

3. **Fix production issues:**
   ```bash
   # Install Node.js v20
   curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
   apt-get install -y nodejs
   
   # Fix API URLs - encode square brackets
   # Change: &layers=[4,1,100]
   # To: &layers=%5B4,1,100%5D
   
   # Disable broken Cloudflare proxy
   # Set USE_CLOUDFLARE: false in production script
   ```

4. **Safer approach for next time:**
   - Keep console open while making changes
   - Test each change incrementally
   - Keep root access with key-only auth
   - Add firewall rules BEFORE enabling firewall
   - Never use `--force` with ufw
   - Always add your SSH key during server rebuild
   - Test API connectivity before starting production

## Important Files/Locations

- SSH config that locked us out: `/etc/ssh/sshd_config.d/99-hardening.conf`
- UFW firewall status: `ufw status`
- Application location: `/opt/heliosphere/`
- Application user: `heliolens`
- Cron jobs: Run by heliolens user at 3 AM UTC

## Your Credentials

From your .env file:
- VPS Host: 65.109.0.112
- VPS User: root  
- VPS Password: AJtha7MkUjkFxV9c7qWC!
- SSH Key: ~/.ssh/id_ed25519_hetzner

## Application Status

The Heliolens application should still be running (if it was before), but we can't verify because:
- Can't SSH in to check
- Web monitors are blocked by firewall
- No way to access logs

The daily cron job (3 AM UTC) will likely fail if it needs network access.

## Contact Information

- Hetzner Support: https://www.hetzner.com/support
- Hetzner Cloud Console: https://console.hetzner.cloud/
- Hetzner Robot (dedicated): https://robot.hetzner.com/

---

**Priority: GET CONSOLE ACCESS ASAP**

The server is still running, just completely firewalled off. Console access through Hetzner's web panel is the only way to fix this.