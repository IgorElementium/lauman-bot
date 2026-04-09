# lauman-bot — Deployment Guide

## Prerequisites

- Node.js 20+ (on Hetzner)
- Docker + docker-compose (on Hetzner)
- faster-whisper installed locally (for voice transcription, phase 5)
- Telegram bot token (from @BotFather)
- Claude API key (from Anthropic console)
- Odoo credentials (igor@elementium.be + API key)

## Local Development

```bash
# Install dependencies
npm install

# Create .env from .env.example
cp .env.example .env
# Fill in: TELEGRAM_BOT_TOKEN, ALLOWED_CHAT_IDS, ODOO_* vars, ANTHROPIC_API_KEY

# Run locally
npm run dev

# Or with Docker
docker compose up
```

The bot will start:
- Telegram polling (long polling)
- Odoo poller every 30 seconds
- Nudge heartbeat every 30 minutes

## Hetzner Deployment

### 1. SSH into Hetzner box

```bash
ssh root@<hetzner-ip>
```

### 2. Clone repo

```bash
cd /home/lauman
git clone <repo-url> bot
cd bot
```

### 3. Set up environment

```bash
cp .env.example .env
# Edit .env with production values
nano .env
```

### 4. Build & start with Docker

```bash
docker compose up -d
```

Monitor logs:
```bash
docker compose logs -f bot
```

### 5. (Phase 5+) Set up faster-whisper sidecar

When you add voice notes, deploy faster-whisper as a sidecar container in docker-compose.yml.

## Monitoring

Bot logs are JSON-formatted to stdout. In Docker, they go to:
```bash
docker compose logs bot
```

Key log patterns to watch:
- `"message":"Bot started successfully"` — bot is up
- `"message":"Fetched leads from Odoo"` — poller working
- `"message":"Sent lead notification"` — new leads arriving
- `"error"` — something went wrong

## Restart

```bash
docker compose restart bot
```

## Updates

When you push new code:

```bash
cd /home/lauman/bot
git pull
npm run build
docker compose restart bot
```

(Or set up auto-deploy via webhook if you prefer.)

## Port & Networking

Currently, the bot doesn't expose any HTTP ports (long polling mode).

Future phases may expose:
- Health check endpoint (HTTP)
- Webhook endpoint for Telegram (if you switch to webhooks)

For now, the bot communicates outbound only:
- → Telegram API
- → Odoo XML-RPC

No firewall rules needed except outbound HTTPS.

## Backups

SQLite database lives at:
```
/home/lauman/bot/lauman-bot.db
```

Consider backing it up daily:
```bash
docker compose exec bot cp lauman-bot.db /backup/lauman-bot-$(date +%Y%m%d).db
```

## Troubleshooting

### Bot not responding to messages

1. Check Telegram bot is running:
   ```bash
   docker compose logs bot | grep "Bot started"
   ```

2. Check Telegram token is correct in `.env`

3. Check chat ID is in `ALLOWED_CHAT_IDS`

### No lead notifications arriving

1. Check Odoo poller is running:
   ```bash
   docker compose logs bot | grep "Odoo poller"
   ```

2. Check Odoo credentials are correct

3. Check for errors:
   ```bash
   docker compose logs bot | grep error
   ```

### Claude not responding

1. Check API key is correct

2. Check account has credits

3. Check logs for Claude errors:
   ```bash
   docker compose logs bot | grep "Claude API"
   ```

## Next Steps

See SPEC.md for Phase 5 (voice notes) and Phase 6 (email drafting).
