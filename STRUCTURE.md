# lauman-bot — Repository Structure

Maps the SPEC.md into a code directory layout.

```
lauman-bot/
├── SPEC.md                          # System specification (locked)
├── STRUCTURE.md                     # This file
├── package.json                     # Node.js dependencies
├── tsconfig.json                    # TypeScript config
├── Dockerfile                       # Container image
├── docker-compose.yml               # Local dev setup (includes Whisper sidecar)
├── .env.example                     # Environment variables template
├── .gitignore
│
├── src/
│   ├── index.ts                     # Entry point (starts bot, cron, etc.)
│   │
│   ├── odoo/
│   │   ├── client.ts                # XML-RPC low-level wrapper (copy from portal)
│   │   ├── models.ts                # TypeScript types for Odoo models
│   │   ├── leads.ts                 # crm.lead queries (searchRead, get detail, etc.)
│   │   ├── activities.ts            # mail.activity creation
│   │   ├── chatter.ts               # mail.message posting
│   │   └── stages.ts                # Stage definitions & stage_id mapping
│   │
│   ├── telegram/
│   │   ├── bot.ts                   # grammY bot setup, handlers, middleware
│   │   ├── handlers/
│   │   │   ├── message.ts           # Text message handler (routes to Claude)
│   │   │   ├── voice.ts             # Voice message handler (transcribe + route to Claude)
│   │   │   ├── callback.ts          # Inline keyboard button handler (for confirmations)
│   │   │   └── reply.ts             # Reply-to logic (map message_id → lead_id)
│   │   ├── keyboards.ts             # InlineKeyboard builders (confirmations, lead pickers)
│   │   └── session.ts               # Session state management (chat_id → active_lead, history)
│   │
│   ├── llm/
│   │   ├── client.ts                # Anthropic SDK setup
│   │   ├── tools.ts                 # Tool definitions (search_leads, create_note, etc.)
│   │   ├── system-prompt.ts         # System prompt in Dutch
│   │   ├── chat.ts                  # Main chat handler (orchestrates session + Claude + tools)
│   │   └── tool-executor.ts         # Executes tool calls (calls Odoo/DB based on tool name)
│   │
│   ├── db/
│   │   ├── sqlite.ts                # SQLite connection & migrations
│   │   ├── schema.sql               # DDL (sessions, conversation_log, seen_leads, follow_up_state)
│   │   ├── sessions.ts              # Session queries (get, upsert, update history)
│   │   ├── conversation-log.ts      # Logging queries
│   │   ├── seen-leads.ts            # Dedup queries
│   │   ├── follow-up-state.ts       # State machine queries
│   │   └── message-lead-map.ts      # Telegram message_id → lead_id mapping
│   │
│   ├── cron/
│   │   ├── odoo-poller.ts           # Poll Odoo every 2 min, send new lead notifications
│   │   ├── nudge-heartbeat.ts       # Heartbeat every 30 min, send due nudges through Claude
│   │   └── scheduler.ts             # Cron setup (schedule both)
│   │
│   ├── voice/
│   │   └── whisper.ts               # faster-whisper transcription (spawn subprocess, handle output)
│   │
│   └── utils/
│       ├── logger.ts                # Structured JSON logging
│       ├── config.ts                # Load .env, validate required vars
│       ├── types.ts                 # Shared TypeScript types
│       └── error-handler.ts         # Global error boundary
│
├── scripts/
│   └── init-db.ts                   # One-time: create SQLite schema
│
└── tests/
    └── (not in scope for v1)
```

## Key design decisions

### Odoo client
Copy `src/lib/odoo/client.ts` from lauman-portal verbatim. It has no framework
coupling and handles XML-RPC, auth, retry logic already.

### LLM orchestration
The `chat.ts` file is the heart of the system:
1. Receive message from Telegram
2. Load session state (conversation history, active_lead_id)
3. Inject lead detail if active_lead is set (as system context)
4. Call Claude API with tools
5. If tools are called: execute them via `tool-executor.ts`
6. Loop back to step 4 if Claude calls more tools
7. Send final response to Telegram
8. Save updated session state

### Tool executor
Single dispatch function that maps tool names to implementations:
```typescript
switch (toolName) {
  case "search_leads":
    return await odoo.leads.search(params.query, params.limit);
  case "create_note":
    return await odoo.chatter.post(params.lead_id, params.body);
  ...
}
```
This keeps the LLM logic separate from the Odoo/Telegram plumbing.

### Cron tasks
Two independent cron jobs:
- **Odoo poller** (every 2 min): fetch new leads, check dedup, send Telegram notifications
- **Nudge heartbeat** (every 30 min): check which leads are due for nudge, pass through Claude

Both are non-blocking async loops. The main process runs both in parallel.

### Session state
Minimal in-memory state + SQLite backup:
- `chat_id` → session record in SQLite
- `active_lead_id` → which lead Jorn is talking about
- `conversation_history` → last 30 messages
All persists across bot restarts.

## Env var mapping

| Env var | Used by | Purpose |
|---------|---------|---------|
| `TELEGRAM_BOT_TOKEN` | `telegram/bot.ts` | Telegram API auth |
| `ALLOWED_CHAT_IDS` | `telegram/bot.ts` | Whitelist (Jorn + Igor) |
| `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_API_KEY` | `odoo/client.ts` | Odoo auth |
| `ANTHROPIC_API_KEY` | `llm/client.ts` | Claude API auth |
| `LLM_MODEL`, `LLM_MODEL_UPGRADE` | `llm/client.ts` | Model selection |
| `WHISPER_MODEL`, `WHISPER_LANGUAGE` | `voice/whisper.ts` | Whisper config |
| `BOT_MODE` | `utils/config.ts` | production / test / dry-run |
| `POLL_INTERVAL_MS`, `HEARTBEAT_INTERVAL_MS` | `cron/scheduler.ts` | Timing |
| `IGOR_CHAT_ID` | `cron/odoo-poller.ts` | Alert destination |
| `LOG_RETENTION_DAYS` | `db/sqlite.ts` | Cleanup policy |

## Phase 1: Skeleton

Create the folder structure, basic `src/index.ts` entry point, `telegram/bot.ts`
with echo handler, and minimal `package.json`. The bot starts, listens for messages,
echoes them back. Proof of life.
