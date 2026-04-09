# lauman-bot

Conversational Telegram assistant for Jorn Lauman that bridges Telegram ↔ Odoo CRM via Claude tool-use. Jorn manages leads from his phone in natural Dutch without opening Odoo.

## Features (Phases 1-4 complete)

✅ **Odoo polling** — checks for new leads every 30 seconds
✅ **Telegram notifications** — formatted lead alerts with details
✅ **Conversational Claude** — Jorn talks naturally in Dutch, Claude understands
✅ **CRM tools** — search leads, get details, create notes, update stages, schedule activities, view pipeline
✅ **Follow-up automation** — nudges Jorn about stale leads (4h → 24h → 24h → cold)
✅ **Call tracking** — logs when Jorn called, shows history in nudges ("Je hebt al 2x gebeld, sinds 8h geleden")
✅ **Quiet hours** — respects 20:00-08:00 (no nudges, deferred to 08:00)
✅ **SQLite persistence** — conversation history, lead state, call logs all persisted

## Quick Start

### Local Development

```bash
npm install
cp .env.example .env
# Fill in: TELEGRAM_BOT_TOKEN, ALLOWED_CHAT_IDS, Odoo credentials, Claude API key
npm run dev
```

### Docker

```bash
docker compose up
```

Bot will start:
- Telegram bot listening (long polling)
- Odoo poller every 30s
- Nudge heartbeat every 30min

Send a message to your bot on Telegram and Claude will respond.

## Deployment to Hetzner

See [DEPLOYMENT.md](DEPLOYMENT.md) for full instructions.

TL;DR:
```bash
ssh root@<hetzner-ip>
cd /home/lauman
git clone <repo> bot && cd bot
cp .env.example .env
# Edit .env with production values
docker compose up -d
```

## Usage

**Jorn says**: "Hallo, welke leads moet ik nog terugbellen?"
**Bot responds**: Shows pipeline overview with all open leads by stage

**Jorn says**: "Gebeld met die van Mortsel, niet opgehaald"
**Bot responds**: Logs the call, asks if he wants to schedule a reminder or send email

**After 4 hours** of no activity: Bot nudges "Je hebt al 1x gebeld met Peters van Antwerpen, sinds 4h geleden. Nummer: +32..."

## Architecture

- **Telegram**: grammY library, long polling
- **Odoo**: XML-RPC, polling every 30s
- **LLM**: Claude Haiku 4.5 with tool-use, Sonnet 4.6 for complex tasks
- **Persistence**: SQLite (conversation history, lead state, call tracking)
- **Voice** (Phase 5): faster-whisper for Dutch transcription
- **Email** (Phase 6): Odoo mail.message integration

## Documentation

- [SPEC.md](SPEC.md) — complete system specification & requirements
- [STRUCTURE.md](STRUCTURE.md) — code organization & design decisions
- [DEPLOYMENT.md](DEPLOYMENT.md) — how to deploy to Hetzner
- [.env.example](.env.example) — environment variable reference

## Roadmap

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Skeleton + echo | ✅ |
| 2 | Odoo poller + notifications | ✅ |
| 3 | Claude + tools | ✅ |
| 4 | Follow-up state machine + nudges | ✅ |
| 5 | Voice notes (faster-whisper) | ⏳ |
| 6 | Email drafting (Odoo integration) | ⏳ |
| 7 | Polish & hardening | ⏳ |

## Commands

- `/start` — bot introduction
- `/ping` — health check

## Logs

JSON-formatted to stdout. Watch with:
```bash
docker compose logs -f bot | grep -E "error|Claude|Fetched leads"
```

## Support

For issues or questions, check logs first:
```bash
docker compose logs bot
```

Common issues: wrong Telegram token, Odoo credentials, API key.
