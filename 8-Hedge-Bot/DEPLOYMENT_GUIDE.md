# 8-Bot Hedge Strategy - Deployment Guide

This guide explains how to deploy your trading bot to a server (like VPS, Heroku, or Render).

## 1. Prerequisites
- **Node.js**: Install Node.js v18+ on your server.
- **Git**: (Optional) For cloning the code.
- **Deriv Account**: You need an active Deriv account and an API Token.

## 2. Local Setup (Verify First)
1. Copy the `8-Hedge-Bot` folder to your server.
2. Open a terminal in that folder.
3. Run `npm install` to install dependencies.
4. Update the `.env` file with your `APP_ID` and `DERIV_TOKEN`.

## 3. Running the Bot
To start the bot, run:
```bash
npm start
```
The dashboard will be available at `http://your-server-ip:8080/dashboard.html`.

## 4. Production Recommendations
### Use a Process Manager (PM2)
To keep the bot running 24/7, use PM2:
1. Install PM2: `npm install -g pm2`
2. Start the bot: `pm2 start web-server.js --name hedge-bot`
3. Check status: `pm2 list`
4. View logs: `pm2 logs hedge-bot`

### SSL/HTTPS
If you are deploying to a public server, it is highly recommended to use a reverse proxy like **Nginx** and **Certbot** to enable HTTPS.

## 5. Deployment Options
### Option A: VPS (DigitalOcean, AWS, Linode)
Best for 24/7 reliability. Install Node.js, clone your code, and run with PM2.

### Option B: Heroku / Render
1. Create a new "Web Service".
2. Link your GitHub repository.
3. Set the build command to `npm install`.
4. Set the start command to `npm start`.
5. Add your `.env` variables in the dashboard settings.

---
**Disclaimer**: Trading involves risk. Ensure you test your strategies on a demo account (VRTC) before using real funds.
