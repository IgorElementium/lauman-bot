import { getDb } from './sqlite.js';

export interface SeenLead {
  id: number;
  odoo_lead_id: number;
  notified_at: string;
  created_at: string;
}

export function isLeadSeen(leadId: number): boolean {
  const db = getDb();
  const result = db
    .prepare('SELECT id FROM seen_leads WHERE odoo_lead_id = ?')
    .get(leadId);
  return !!result;
}

export function markLeadSeen(leadId: number): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO seen_leads (odoo_lead_id, notified_at, created_at)
     VALUES (?, ?, ?)`
  ).run(leadId, now, now);
}

export function getSeenLeads(): SeenLead[] {
  const db = getDb();
  return db.prepare('SELECT * FROM seen_leads ORDER BY created_at DESC').all() as SeenLead[];
}
