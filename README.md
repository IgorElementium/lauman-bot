# lauman-bot

Conversational Telegram assistant for Jorn Lauman that bridges Telegram ↔ Odoo CRM
via Claude tool-use.

See [SPEC.md](SPEC.md) for the complete specification.
See [STRUCTURE.md](STRUCTURE.md) for repository layout and design decisions.

## Phase 1: Skeleton + Echo Bot

The bot starts and echoes messages back. Proof of life.

### Setup

1. **Get a Telegram bot token** from @BotFather on Telegram.

2. **Copy `.env.example` to `.env`** and fill in:
   ```bash
   cp .env.example .env
   ```

   Minimum for phase 1:
   - `TELEGRAM_BOT_TOKEN=` → paste your token from @BotFather
   - `ALLOWED_CHAT_IDS=` → your Telegram chat ID (get it from @userinfobot)

3. **Install dependencies**:
   ```bash
   npm install
   ```

### Running locally

**Option A: Direct Node.js**
```bash
npm run dev
```

**Option B: Docker Compose**
```bash
docker compose up
```

The bot will start with long polling. Send a message to your bot on Telegram
and it will echo it back.

### Testing the bot

1. Find your Telegram chat ID: send any message to @userinfobot on Telegram
2. Update `.env`: `ALLOWED_CHAT_IDS=123456789` (your ID)
3. Start the bot
4. Open Telegram and send a message to your bot
5. The bot should echo the message back

### Commands

- `/start` — bot introduction
- `/ping` — health check

### Logs

Logs are JSON-formatted to stdout. In production on Hetzner, Docker captures them.

```json
{"timestamp":"2026-04-09T10:30:45.123Z","level":"info","message":"Incoming message","data":{"chatId":123456789,"userId":987654321,"messageType":"text"}}
```

## Next phases

See SPEC.md §14 for the full 7-phase plan.
