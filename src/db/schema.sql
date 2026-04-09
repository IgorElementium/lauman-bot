-- SQLite schema for lauman-bot

-- Deduplication: track which Odoo leads we've already notified about
CREATE TABLE IF NOT EXISTS seen_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  odoo_lead_id INTEGER NOT NULL UNIQUE,
  notified_at TEXT NOT NULL,  -- ISO 8601 timestamp
  created_at TEXT NOT NULL    -- ISO 8601 timestamp
);

-- Follow-up state machine
CREATE TABLE IF NOT EXISTS follow_up_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  odoo_lead_id INTEGER NOT NULL UNIQUE,
  state TEXT NOT NULL,  -- FRESH, NUDGE_1, NUDGE_2, NUDGE_3, COLD, RESPONDED, CLOSED
  state_changed_at TEXT NOT NULL,  -- ISO 8601 timestamp
  last_nudge_sent_at TEXT,  -- ISO 8601 timestamp
  call_count INTEGER DEFAULT 0,  -- How many times Jorn called
  first_call_at TEXT,  -- When first call was made
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Telegram message -> Odoo lead mapping (for reply-to threading)
CREATE TABLE IF NOT EXISTS message_lead_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_message_id INTEGER NOT NULL UNIQUE,
  odoo_lead_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- Conversation history per Telegram chat
CREATE TABLE IF NOT EXISTS conversation_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  message_type TEXT NOT NULL,  -- 'user' or 'assistant' or 'tool_result'
  content TEXT NOT NULL,
  metadata TEXT,  -- JSON: {lead_id?, tool_name?, result_summary?}
  created_at TEXT NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES sessions(chat_id)
);

-- Session state per Telegram chat
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL UNIQUE,
  active_lead_id INTEGER,
  active_lead_set_at TEXT,  -- ISO 8601 timestamp
  last_message_at TEXT,  -- ISO 8601 timestamp
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Conversation log (all interactions, for observability)
CREATE TABLE IF NOT EXISTS conversation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  chat_id INTEGER NOT NULL,
  direction TEXT NOT NULL,  -- 'in' or 'out'
  message_type TEXT NOT NULL,  -- 'text', 'voice', 'callback', 'system'
  odoo_lead_id INTEGER,
  user_text TEXT,
  assistant_text TEXT,
  tool_calls TEXT,  -- JSON array
  llm_model TEXT,
  llm_input_tokens INTEGER,
  llm_output_tokens INTEGER,
  voice_duration_s REAL,
  error TEXT,
  created_at TEXT NOT NULL
);

-- Migrations for existing tables
-- Add call_count and first_call_at if they don't exist
PRAGMA table_info(follow_up_state);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_seen_leads_odoo_lead_id ON seen_leads(odoo_lead_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_state_odoo_lead_id ON follow_up_state(odoo_lead_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_state_state ON follow_up_state(state);
CREATE INDEX IF NOT EXISTS idx_message_lead_map_lead_id ON message_lead_map(odoo_lead_id);
CREATE INDEX IF NOT EXISTS idx_message_lead_map_chat_id ON message_lead_map(chat_id);
CREATE INDEX IF NOT EXISTS idx_conversation_history_chat_id ON conversation_history(chat_id);
CREATE INDEX IF NOT EXISTS idx_sessions_chat_id ON sessions(chat_id);
CREATE INDEX IF NOT EXISTS idx_conversation_log_chat_id ON conversation_log(chat_id);
CREATE INDEX IF NOT EXISTS idx_conversation_log_timestamp ON conversation_log(timestamp);
