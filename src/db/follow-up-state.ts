import { getDb } from './sqlite.js';

export type FollowUpState = 'FRESH' | 'NUDGE_1' | 'NUDGE_2' | 'NUDGE_3' | 'COLD' | 'RESPONDED' | 'CLOSED';

export interface FollowUpRecord {
  id: number;
  odoo_lead_id: number;
  state: FollowUpState;
  state_changed_at: string;
  last_nudge_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export function getOrCreateFollowUpState(leadId: number): FollowUpRecord {
  const db = getDb();
  const now = new Date().toISOString();

  // Try to get existing state
  const existing = db
    .prepare('SELECT * FROM follow_up_state WHERE odoo_lead_id = ?')
    .get(leadId) as FollowUpRecord | undefined;

  if (existing) {
    return existing;
  }

  // Create new state (FRESH)
  db.prepare(
    `INSERT INTO follow_up_state (odoo_lead_id, state, state_changed_at, last_nudge_sent_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(leadId, 'FRESH', now, null, now, now);

  return db
    .prepare('SELECT * FROM follow_up_state WHERE odoo_lead_id = ?')
    .get(leadId) as FollowUpRecord;
}

export function getFollowUpState(leadId: number): FollowUpRecord | undefined {
  const db = getDb();
  return db
    .prepare('SELECT * FROM follow_up_state WHERE odoo_lead_id = ?')
    .get(leadId) as FollowUpRecord | undefined;
}

export function updateFollowUpState(
  leadId: number,
  newState: FollowUpState,
  lastNudgeSentAt?: string
): void {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE follow_up_state
     SET state = ?, state_changed_at = ?, last_nudge_sent_at = ?, updated_at = ?
     WHERE odoo_lead_id = ?`
  ).run(newState, now, lastNudgeSentAt || null, now, leadId);
}

export function getLeadsDueForNudge(): FollowUpRecord[] {
  const db = getDb();
  const now = new Date();

  // Find all non-COLD, non-CLOSED leads that are due for a nudge
  const records = db
    .prepare(
      `SELECT * FROM follow_up_state
       WHERE state NOT IN ('COLD', 'CLOSED', 'RESPONDED')
       ORDER BY state_changed_at ASC`
    )
    .all() as FollowUpRecord[];

  const due = [];

  for (const record of records) {
    const stateChangedAt = new Date(record.state_changed_at);

    // Determine if this lead is due for a nudge
    let minutesSinceStateChange = Math.floor((now.getTime() - stateChangedAt.getTime()) / 60000);

    let isDue = false;
    let shouldTransitionTo: FollowUpState | null = null;

    if (record.state === 'FRESH' && minutesSinceStateChange >= 4 * 60) {
      // 4 hours
      isDue = true;
      shouldTransitionTo = 'NUDGE_1';
    } else if (record.state === 'NUDGE_1' && minutesSinceStateChange >= 24 * 60) {
      // 24 hours
      isDue = true;
      shouldTransitionTo = 'NUDGE_2';
    } else if (record.state === 'NUDGE_2' && minutesSinceStateChange >= 24 * 60) {
      // 24 hours
      isDue = true;
      shouldTransitionTo = 'NUDGE_3';
    } else if (record.state === 'NUDGE_3' && minutesSinceStateChange >= 48 * 60) {
      // 48 hours
      isDue = true;
      shouldTransitionTo = 'COLD';
    }

    if (isDue) {
      due.push({ ...record, state: shouldTransitionTo || record.state });
    }
  }

  return due;
}

export function isQuietHours(): boolean {
  const now = new Date();
  const hours = now.getHours();

  // Quiet hours: 20:00 - 08:00
  return hours >= 20 || hours < 8;
}

export function nextNudgeTime(): Date {
  const now = new Date();
  const hours = now.getHours();

  if (hours >= 20 || hours < 8) {
    // During quiet hours, schedule for 08:00 tomorrow
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(8, 0, 0, 0);
    return tomorrow;
  }

  // Outside quiet hours, send in a few hours (but before 20:00)
  const inFewHours = new Date(now);
  inFewHours.setHours(inFewHours.getHours() + 3);

  if (inFewHours.getHours() >= 20) {
    // Would cross into quiet hours, defer to tomorrow morning
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(8, 0, 0, 0);
    return tomorrow;
  }

  return inFewHours;
}
