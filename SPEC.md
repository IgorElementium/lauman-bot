# lauman-bot — Specification

> Conversational Telegram assistant for Jorn Lauman that bridges
> Telegram <> Odoo CRM via Claude tool-use, so Jorn can manage leads
> from his phone in natural Dutch without opening Odoo.

## 1. System overview

```
                          long poll              XML-RPC (poll every 2 min)
  Jorn's phone ──── Telegram API ──── lauman-bot ──── Odoo Online
       ▲                                  │               (laumanrenovatie1.odoo.com)
       │                                  │
       └──── bot replies ────────────────┘
                                          │
                                  Claude API (tool-use)
                                          │
                                  faster-whisper (voice)
                                          │
                                  SQLite (local state)
```

The bot is a single long-running Node.js process. No inbound HTTP
server needed for v1 — both Telegram (grammY long polling) and Odoo
(XML-RPC cron) are outbound.

### Deployment

- **Runtime**: Node.js + TypeScript
- **Host**: Hetzner VPS, Docker container
- **Domain**: `bot.laumanrenovatie.be` (reserved for future webhook migration)
- **Dev**: local on Igor's WSL2, push to GitHub, pull + restart on Hetzner

---

## 2. Trigger rules — what counts as a "new lead"

### Polling mechanism

A cron runs every **2 minutes**, calling `searchRead` on `crm.lead`:

```
domain: [
  ["create_date", ">", last_poll_timestamp],
  ["type", "=", "opportunity"]
]
fields: ["id", "name", "contact_name", "phone", "email_from",
         "city", "description", "source_id", "stage_id",
         "create_date"]
```

### Which leads trigger a notification

**All new leads.** Jorn is the only salesperson — every `crm.lead`
create is relevant. No filtering by assignment, source, or stage.

If a lead is created *and* already moved past stage 1 (Nieuw) by the
time we poll, we still notify — the bot has never seen it.

### Deduplication

SQLite table `seen_leads` tracks every lead ID we've notified about.
A lead is only announced once, even if polling picks it up again
after a restart.

### Notification format

```
📥 Nieuwe lead: {name}
📍 {city}
📞 {phone}
📧 {email_from}
🔗 Bron: {source_id.name}

{description (first 300 chars, HTML stripped)}
```

Sent as a Telegram message. Jorn can reply directly to this message
to start managing the lead (see §5 for threading).

---

## 3. Follow-up state machine

Tracks per-lead follow-up status to nudge Jorn when leads go stale.
State lives in SQLite, keyed by Odoo lead ID.

### States

```
                    ┌─────────────┐
    new lead ─────▶ │   FRESH     │ ◀── just notified, clock starts
                    └──────┬──────┘
                           │ few hours, no action (respect quiet hours)
                           ▼
                    ┌─────────────┐
                    │  NUDGE_1    │ ◀── "Heb je {name} al kunnen bereiken? 📞 {phone}"
                    └──────┬──────┘
                           │ 24h no action
                           ▼
                    ┌─────────────┐
                    │  NUDGE_2    │ ◀── "Nog geen update over {name}."
                    └──────┬──────┘
                           │ 24h no action
                           ▼
                    ┌─────────────┐
                    │  NUDGE_3    │ ◀── "Laatste herinnering voor {name}."
                    └──────┬──────┘
                           │ no action
                           ▼
                    ┌─────────────┐
                    │   COLD      │ ◀── bot stops nudging, logs note in Odoo
                    └─────────────┘

    Any state ──▶ RESPONDED ──▶ (timers reset, new nudge cycle if
                                 lead stays in early stage)

    Any state ──▶ CLOSED ──▶ lead reached Won/Lost/terminal stage
```

### State transitions

| Trigger | Transition |
|---------|-----------|
| New lead polled | → `FRESH` |
| Jorn replies about this lead (any message) | → `RESPONDED`, reset timers |
| Jorn updates stage via bot tool | → `RESPONDED`, reset timers |
| Timer expires (see timing rules below) | → next `NUDGE_N` |
| After `NUDGE_3` + 48h | → `COLD` (bot posts chatter note: "Lead niet opgepakt via Telegram") |
| Lead stage reaches Won (4) or Lost (13, 14) | → `CLOSED` |
| Jorn explicitly says "laat maar" / "niet meer opvolgen" | → `CLOSED` |

### Nudge timing rules

The heartbeat cron runs **every 30 minutes** and checks all leads
that are due for a nudge. Nudges are sent through the LLM — Claude
gets the stale lead context and decides what to say (may vary the
wording, include the phone number, remind what the lead was about).

**Quiet hours: 20:00 – 08:00.** Nudges are never sent between 8pm
and 8am. If a nudge is due during quiet hours, it's deferred to
08:00 the next morning.

**NUDGE_1 timing:** A few hours after the initial notification.
If the lead came in before 20:00, nudge the same day (3–4 hours
later, but not after 20:00). If the lead came in after 17:00 or
during quiet hours, nudge at 08:00 the next morning.

**NUDGE_2:** 24 hours after NUDGE_1 (respecting quiet hours).

**NUDGE_3:** 24 hours after NUDGE_2 (respecting quiet hours).

### Re-engagement

If Jorn responds to a `COLD` lead later, it moves back to
`RESPONDED`. The bot doesn't judge — it just re-activates tracking.

---

## 4. LLM tool schema

Claude Haiku 4.5 by default, Sonnet 4.6 if quality demands it.
All tools operate on Odoo via XML-RPC.

### System prompt (summary)

> Je bent de CRM-assistent van Lauman Renovatie. Je helpt Jorn met
> het opvolgen van leads via Telegram.
>
> **Toon:** Belgisch Nederlands, kort en direct. Geen wollige zinnen.
> Stuur niet meteen een tool als je onzekerheid hebt — vraag eerst
> op natuurlijke manier door. Bijvoorbeeld:
> - "Wat zeiden ze?" in plaats van meteen een tool aan te roepen
> - "Wanneer?" als Jorn een afspraak noemt
> - "Zal ik dat inplannen?" om een actie voor te stellen
>
> **Bij onduidelijkheid:** vraag door. Jorn weet meer dan hij
> opstuurt. Je role is clarificatie, niet gokken.
>
> **Tool use:** Roep tools aan als je genoeg context hebt om een
> actie te doen (notitie plaatsen, activiteit inplannen, stage
> wijzigen). Vraag altijd bevestiging voor destructieve acties
> (stage naar Won/Lost, email versturen, notitie verwijderen).

### Tools

#### `search_leads`
Find leads by name, city, phone, stage, or free text.
```
params: {
  query: string       // free-text search (name, city, contact, phone)
  stage?: string      // stage name or "all"
  limit?: number      // default 5
}
returns: [{ id, name, contact_name, city, phone, stage, last_activity }]
```

#### `get_lead_detail`
Full context for one lead — everything Claude needs to advise Jorn.
```
params: {
  lead_id: number
}
returns: {
  id, name, contact_name, phone, email, city, street, zip,
  description, source, stage, create_date, last_activity_date,
  recent_chatter: [{ date, author, body }],  // last 10 messages
  upcoming_activities: [{ type, date, summary }],
  follow_up_state: string  // from our state machine
}
```

#### `update_lead_stage`
Move a lead to a different pipeline stage.
```
params: {
  lead_id: number
  stage: string   // stage name in Dutch, mapped to stage_id internally
}
```
Confirmation required if moving to Won or Lost.

#### `add_chatter_note`
Post an internal note on the lead's chatter in Odoo.
```
params: {
  lead_id: number
  body: string     // plain text, converted to HTML for Odoo
}
```

#### `schedule_activity`
Create a to-do / follow-up activity on the lead.
```
params: {
  lead_id: number
  activity_type: "call" | "todo" | "email" | "meeting"
  date_deadline: string   // ISO date or "today", "tomorrow", "in 3 hours"
  summary: string
}
```

#### `create_note`
Post an internal note on the lead's chatter in Odoo (alias for
`add_chatter_note`, kept for clarity in Claude's reasoning).
```
params: {
  lead_id: number
  body: string     // plain text, converted to HTML for Odoo
}
```

#### `draft_email`
Generate an email draft for Jorn to review before sending.
Does NOT send — returns the draft for approval via inline keyboard.
```
params: {
  lead_id: number
  intent: string    // what the email should accomplish
  language?: string // default "nl", can be "fr" or "en"
}
returns: {
  subject: string
  body: string
  recipient: string
}
```

#### `send_email`
Send a previously approved draft via Odoo `message_post`.
Only called after Jorn approves a draft.
```
params: {
  lead_id: number
  subject: string
  body: string
  recipient_email: string
}
```
Uses `message_post` with `subtype_xmlid: 'mail.mt_comment'` and
`email_from` set to Jorn's configured email. Requires Odoo outgoing
mail server configured with Jorn's SMTP.

#### `get_pipeline_summary`
Dashboard view — how many leads in each stage.
```
returns: {
  stages: [{ name, count, leads: [{ id, name, city, days_since_activity }] }]
  total_open: number
  oldest_untouched: { id, name, days }
}
```

### Tool design principles

- **Simple, composable tools.** Claude can chain multiple tools in
  one turn: ask for clarification, then act. E.g., `create_note`
  + `schedule_activity` + `update_lead_stage` in one response.
- **Return Dutch stage names**, not IDs. Claude reasons better
  with "Nieuw" than with `stage_id: 1`.
- **Tool descriptions are long and specific.** Describe what the
  tool does, what it returns, and side effects. Claude will ask for
  clarification if parameters are missing.
- **Confirmation for destructive actions.** `send_email` and
  `update_lead_stage` to Won/Lost require Jorn to approve via
  inline keyboard before executing.
- **No compound tools.** Tools do one thing well. Claude chains them
  conversationally (ask for clarification, then execute multiple
  tools if needed).

---

## 5. Conversation model

### Interaction style

The bot is conversational, not a command-line interface. When Jorn
reports on a lead, Claude asks clarifying questions naturally:

```
Jorn: "Gebeld met die van Antwerpen"
Claude: "Met wie sprak je? En wat zeiden ze?"
Jorn: "Met Jan. Hij zei dat hij volgende week beschikbaar is."
Claude: "Prima! Zal ik dat inplannen voor volgende week maandag? 
        En moet ik in Odoo noteren wat jullie hebben besproken?"
Jorn: "Ja, donderdag. Zeg maar: "Eerste gesprek, wil offerte zien""
Claude: [schedules activity, updates note, confirms]
```

Claude asks for clarification when needed:
- "Wat was het resultaat van je gesprek?" (if Jorn is vague)
- "Wanneer moet hij je terugbellen?" (if callback mentioned)
- "Zal ik een reminder zetten dat je hem moet mailen?" (suggesting an action)
- "Welk stadium zal ik kiezen in Odoo?" (if multiple are possible)

### How the bot knows which lead Jorn is talking about

**Priority order:**

1. **Telegram reply-to.** If Jorn replies to a bot message, look up
   which lead that message was about (SQLite: `message_lead_map`
   table, keyed by `telegram_message_id → lead_id`).

2. **Active lead in session.** If the last interaction was about lead
   X and less than 5 minutes ago, assume continued context. Claude
   can assume the same lead unless Jorn switches topics.

3. **Claude searches from message content.** If Jorn mentions a name,
   city, or phone, Claude calls `search_leads` to find a match. If
   ambiguous (multiple results), Claude shows options and asks Jorn
   to pick.

4. **No context at all.** Claude asks: "Over welke lead gaat het?"

### Session state (per Telegram chat)

Stored in SQLite, updated on every message:

```
{
  chat_id: number,
  active_lead_id: number | null,
  active_lead_set_at: timestamp,
  conversation_history: Message[]  // last 30 messages, for Claude context
}
```

### Conversation history for Claude

Each Claude API call includes:
- System prompt (see §4)
- Last 30 messages from the session (user + assistant + tool results)
- If an active lead is set: the lead's detail (injected as a system
  message so Claude has context without a tool call)

The 30-message window ensures Claude sees Jorn's working style
(he may bounce between 3 leads, handle one fully, then come back
to another). This helps Claude predict what Jorn might want to do
next with a given lead.

---

## 6. Voice note handling

### Flow

1. Jorn sends voice note on Telegram (`.ogg` / Opus)
2. Bot downloads via Telegram `getFile` API
3. Pipe to local **faster-whisper** (small or medium model, Dutch)
4. Transcribed text replaces the voice note in the conversation —
   treated as if Jorn typed it
5. Bot replies with the transcription first ("Ik verstond: ..."),
   then processes the content through Claude

### faster-whisper setup

Same stack as the WhatsApp transcription project. Runs as a sidecar
process or Python subprocess called from Node. Model: `small` for
speed, `medium` if Dutch accuracy needs it.

### Error handling

- If transcription fails, reply: "Ik kon je spraakbericht niet
  verstaan. Kan je het typen?"
- If transcription confidence is low, show the text and ask for
  confirmation before acting on it.

---

## 7. Email drafting flow

### Sequence

```
Jorn: "stuur een mail naar die klant dat ik volgende week kan langskomen"
  │
  ▼
Claude calls draft_email(lead_id, intent="bezoek volgende week")
  │
  ▼
Bot shows draft in Telegram:
  ┌──────────────────────────────────────┐
  │ 📧 Concept email aan {contact_name}  │
  │                                       │
  │ Onderwerp: {subject}                  │
  │                                       │
  │ {body}                                │
  │                                       │
  │ [✅ Versturen]  [✏️ Aanpassen]  [❌]  │
  └──────────────────────────────────────┘
  │
  ├── "Versturen" → Claude calls send_email → Odoo message_post
  ├── "Aanpassen" → bot asks "Wat wil je aanpassen?" → new draft
  └── "❌" → discard, confirm
```

### Odoo email mechanics

- `message_post` on `crm.lead` with `message_type: 'comment'`,
  `subtype_xmlid: 'mail.mt_comment'`
- `partner_ids` includes the lead's partner (ensures email is sent)
- `email_from` must resolve to Jorn's email address
- **Prerequisite:** Odoo outgoing mail server configured with Jorn's
  SMTP credentials (e.g. `jorn@laumanrenovatie.be` via their mail
  provider). This is an Odoo admin setup task, not a bot task.

### Reply handling

When a client replies to an email sent via Odoo, the reply
automatically threads into the lead's chatter (Odoo's mail gateway
handles this). The bot can detect new chatter messages during its
Odoo poll and optionally notify Jorn: "Klant {name} heeft
geantwoord op je mail."

---

## 8. Quiet hours & rate limiting

### Quiet hours

**None.** Bot is always on. Jorn decides when he works.

### Rate limiting

- **Telegram:** grammY `auto-retry` plugin handles 429s
  automatically.
- **Odoo XML-RPC:** max 1 request/second (self-imposed). Queue
  concurrent tool calls sequentially.
- **Claude API:** standard rate limits apply. At a few leads/day
  this is nowhere near limits.
- **Nudge batching:** if multiple leads are due for a nudge at the
  same cron tick, send them as separate messages with 2-second
  spacing (not one giant wall of text).

---

## 9. Edge cases

### LLM gets it wrong

- **Wrong lead identified:** Jorn says "nee, niet die" → Claude
  clears active lead, asks for clarification.
- **Wrong action taken (note posted, stage changed):** Implement an
  `undo_last_action` tool that reverts the last write (within 5
  minutes). For notes: delete the `mail.message`. For stage changes:
  revert to previous `stage_id` (stored before the change).
- **Hallucinated lead:** Claude invents a lead that doesn't exist.
  Tool calls will fail (lead not found), Claude should say "Ik kan
  die lead niet vinden" and offer to search.

### Destructive action confirmation

Always require inline keyboard approval for:
- Sending email to a client
- Moving to Won or Lost
- Marking a lead as wrong number
- Any action Claude is uncertain about

### Lead goes permanently cold

After `COLD` state + 7 days with no interaction, the bot stops
tracking the lead entirely. It stays in Odoo in whatever state it's
in. No data is deleted.

### Odoo becomes unreachable

- XML-RPC calls have a 30-second timeout (same as portal).
- On failure: retry once after 5 seconds.
- On second failure: log the error, tell Jorn "Ik kan Odoo niet
  bereiken. Probeer het later opnieuw."
- Odoo poll cron: if a poll fails, retry next cycle (2 min). After
  5 consecutive failures, send Jorn a one-time alert: "Odoo is al
  10 minuten onbereikbaar."

### Bot crashes / restarts

- SQLite persists all state. On restart, the bot resumes from
  `last_poll_timestamp` — may re-fetch some leads but deduplication
  prevents double notifications.
- Conversation history survives restart (stored in SQLite, not
  in-memory).
- Follow-up timers are based on absolute timestamps, not in-memory
  timers. The heartbeat cron recalculates what's due on every tick.

### Jorn ignores bot for days

- Nudge sequence plays out (4h → 24h → 48h → cold).
- Bot does NOT escalate or panic. It just stops nudging per lead.
- When Jorn comes back, all leads are still there. He can ask
  "toon openstaande leads" and get a summary.

---

## 10. Observability

### What gets logged per conversation turn

```
{
  timestamp: ISO 8601,
  chat_id: number,
  direction: "in" | "out",
  message_type: "text" | "voice" | "callback" | "system",
  lead_id: number | null,
  user_text: string,            // Jorn's message (or voice transcription)
  assistant_text: string,       // bot's reply
  tool_calls: [{
    tool: string,
    params: object,
    result_summary: string,     // truncated, no PII in logs
    duration_ms: number
  }],
  llm_model: string,            // "claude-haiku-4-5" or "claude-sonnet-4-6"
  llm_input_tokens: number,
  llm_output_tokens: number,
  voice_transcription?: {
    duration_s: number,
    confidence: number,
    text: string
  },
  error?: string
}
```

### Storage

- **Conversation logs:** SQLite `conversation_log` table. Retained
  for 90 days, then pruned.
- **Odoo poll logs:** timestamp + leads found + any errors. SQLite.
- **Application logs:** stdout (Docker captures). Structured JSON.

### Alerting (v1: minimal)

- Odoo unreachable for 10+ minutes → Telegram message to Igor
- Bot process crashes → Docker restart policy (`unless-stopped`) +
  Igor gets notified via uptime monitor (separate from bot)
- LLM API error → logged, Jorn sees "Er ging iets mis, probeer
  opnieuw"

---

## 11. Dry-run / test mode

### Modes

| Mode | Telegram | Odoo | Claude | Purpose |
|------|----------|------|--------|---------|
| `production` | Jorn's chat | Real Odoo | Real calls | Live |
| `test` | Igor's chat | Real Odoo (read-only) | Real calls | Test LLM + UI without writes |
| `dry-run` | Igor's chat | Mocked responses | Real calls | Test without any Odoo access |

### Implementation

- **`BOT_MODE` env var:** `production` / `test` / `dry-run`
- **`test` mode:** All Odoo write operations (`write`, `message_post`,
  `create`) are intercepted — logged but not executed. Reads work
  normally. Bot prefixes replies with `[TEST]`.
- **`dry-run` mode:** Odoo client returns canned data. Useful for
  developing Claude prompts and testing conversation flows without
  needing Odoo access at all.
- **Chat ID whitelist:** `ALLOWED_CHAT_IDS` env var. In production:
  Jorn's chat ID. In test/dry-run: Igor's chat ID (or both).

---

## 12. Environment variables

```env
# Telegram
TELEGRAM_BOT_TOKEN=           # from @BotFather
ALLOWED_CHAT_IDS=             # comma-separated Telegram chat IDs

# Odoo
ODOO_URL=https://laumanrenovatie1.odoo.com
ODOO_DB=laumanrenovatie1
ODOO_USERNAME=                # Odoo user email
ODOO_API_KEY=                 # Odoo API key

# Claude
ANTHROPIC_API_KEY=            # Anthropic API key
LLM_MODEL=claude-haiku-4-5-20251001  # default model
LLM_MODEL_UPGRADE=claude-sonnet-4-6-20250131  # for complex tasks

# Whisper
WHISPER_MODEL=small           # faster-whisper model size
WHISPER_LANGUAGE=nl           # force Dutch

# Bot behavior
BOT_MODE=production           # production | test | dry-run
POLL_INTERVAL_MS=120000       # Odoo poll interval (2 min)
HEARTBEAT_INTERVAL_MS=1800000 # nudge check interval (30 min)
LOG_RETENTION_DAYS=90

# Igor alerts
IGOR_CHAT_ID=                 # Igor's Telegram chat ID for alerts
```

---

## 13. Future (v2, not in scope now)

- **Query mode:** "toon openstaande leads", "wanneer moest ik die
  van Mortsel terugbellen?", "hoeveel leads deze week?"
- **Webhook migration:** Telegram webhook + Caddy reverse proxy for
  lower latency. Odoo stays polling (Online limitation).
- **Multi-language emails:** draft in French for Brussels leads.
- **Lead scoring:** Claude rates lead quality based on description,
  suggests priority.
- **Portal integration:** deep link from bot message to portal for
  complex quote work.
- **WhatsApp channel:** port to WhatsApp Business API if Jorn prefers
  (Telegram is v1 because no Meta approval needed).

---

## 14. Build phases

Smallest useful slice first. Each phase is a working increment.

### Phase 1: Skeleton + Telegram echo
- grammY bot with long polling
- Chat ID whitelist
- Echo messages back (proof of life)
- Docker container that runs on Hetzner
- **Ship when:** bot responds to Jorn on Telegram

### Phase 2: Odoo poller + lead notifications
- XML-RPC client (copied from portal's `client.ts`)
- Cron polls `crm.lead` every 2 minutes
- New leads → formatted Telegram message to Jorn
- `seen_leads` dedup in SQLite
- **Ship when:** Jorn gets a notification when a new lead appears

### Phase 3: Claude + basic tools
- Claude API integration with tool-use
- Tools: `search_leads`, `get_lead_detail`, `create_note`,
  `update_lead_stage`, `schedule_activity`
- Conversation threading (reply-to + active lead)
- Conversational interaction: Jorn tells Claude what happened, Claude
  asks clarifying questions, then acts
- Session state persists conversation history (last 30 messages)
- **Ship when:** Jorn says "gebeld met Jan, zei volgende week" and
  Claude asks for clarification, then schedules an activity + posts note

### Phase 4: Follow-up state machine + nudges
- Follow-up state machine in SQLite (FRESH → NUDGE_1 → NUDGE_2 →
  NUDGE_3 → COLD)
- Heartbeat cron for nudges (every 30 min, respects quiet hours)
- Nudges sent through Claude (not hardcoded messages)
- **Ship when:** bot nudges Jorn about a lead he hasn't touched,
  Claude varies the wording

### Phase 5: Voice notes
- faster-whisper sidecar on Hetzner
- Voice → transcription → Claude pipeline
- **Ship when:** Jorn sends a voice note and bot acts on it

### Phase 6: Email drafting
- `draft_email` + `send_email` tools
- Inline keyboard for approval
- Odoo SMTP configuration (manual setup task)
- **Ship when:** Jorn says "mail hem" and client receives email
  from jorn@laumanrenovatie.be

### Phase 7: Polish
- `get_pipeline_summary` tool
- `undo_last_action` tool
- Odoo reply detection (new chatter → notify Jorn)
- Error handling hardening
- Observability / log cleanup
