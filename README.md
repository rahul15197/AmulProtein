# Amul Protein Stock Tracker 🛒

A Playwright-based Telegram bot that monitors Amul protein product availability at **shop.amul.com/en/browse/protein** for your delivery pincode. Get daily automated reports and on-demand checks straight to your Telegram.

---

## Features

- ✅ **Automated daily stock check** — runs at a time you configure
- 📱 **Telegram bot commands** — check availability anytime by sending `/check`
- 📍 **Pincode-aware** — checks availability for your specific delivery location
- ⚙️ **Configurable via Telegram** — change pincode and schedule time without editing code
- 🤖 **Anti-detection** — stealth browser fingerprinting to avoid blocks

---

## Quick Start

### 1. Create a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the **Bot Token** (looks like `123456789:AAbbCC...`)
4. Get your **Chat ID** by messaging [@userinfobot](https://t.me/userinfobot)

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```
TELEGRAM_BOT_TOKEN=your_token_here
TELEGRAM_CHAT_ID=your_chat_id_here
DEFAULT_PINCODE=400001
DEFAULT_CHECK_TIME=09:00
```

### 3. Install & Run

```bash
npm install
npx playwright install chromium
npm start
```

---

## Telegram Commands

| Command | Description |
|---|---|
| `/check` | Check stock availability right now |
| `/setpincode 400001` | Change the delivery pincode |
| `/settime 09:00` | Change daily report time (24h IST) |
| `/status` | View current settings |
| `/help` | Show all commands |

---

## Running Tests (Scraper Only)

To test the scraper without Telegram:

```bash
# Check availability for a pincode
node src/scraper.js 400001
```

---

## Hosting Options

### Option A: GitHub Actions (Free, Best for daily reports)

> The scheduled workflow (`.github/workflows/daily-check.yml`) will run the check daily. **Telegram on-demand commands (`/check`) won't work with this option** since there's no always-on server.

**Setup:**
1. Push this repo to GitHub (can be private)
2. Go to **Settings → Secrets and Variables → Actions**
3. Add these secrets:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `DEFAULT_PINCODE`
4. The workflow runs at 09:00 IST by default (03:30 UTC in cron)
5. To change the time: edit the `cron:` line in `.github/workflows/daily-check.yml`

**Manual trigger:** Go to **Actions → Daily Amul Protein Stock Check → Run workflow**

---

### Option B: Oracle Cloud Free Tier (Best — full features, always-on, free forever)

Oracle gives you **2 free VM instances forever**. This lets the bot run 24/7 with all commands working.

1. Sign up at [cloud.oracle.com](https://cloud.oracle.com) (free, requires credit card for verification only)
2. Create a free **Ampere A1 Compute** VM (Always Free)
3. SSH into the VM and run:

```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Playwright browser dependencies
sudo npx playwright install-deps chromium

# Clone your repo
git clone https://github.com/yourusername/amul-protein-tracker.git
cd amul-protein-tracker

# Setup
npm install
npx playwright install chromium
cp .env.example .env
nano .env   # Fill in your credentials

# Install pm2 for persistent process management
sudo npm install -g pm2
pm2 start src/index.js --name "amul-bot"
pm2 startup   # Auto-start on reboot
pm2 save
```

---

### Option C: Local Machine / Raspberry Pi

```bash
# Run with pm2 for auto-restart
npm install -g pm2
pm2 start src/index.js --name "amul-bot"
pm2 startup   # Set up autostart
pm2 save
```

---

## Project Structure

```
AmulProtein/
├── src/
│   ├── index.js        # Entry point
│   ├── bot.js          # Telegram bot + commands
│   ├── scraper.js      # Playwright scraper
│   ├── scheduler.js    # Cron-based daily scheduler
│   └── store.js        # Config persistence
├── data/
│   └── config.json     # Auto-created on first run
├── .github/
│   └── workflows/
│       └── daily-check.yml  # GitHub Actions workflow
├── .env.example
└── package.json
```

---

## Notes

- The scraper uses multiple CSS selector fallbacks since Amul's website may change
- If the bot gets blocked, try increasing delays in `scraper.js` or using a VPN/proxy
- Config (pincode, time) is stored in `data/config.json` and persists across restarts
