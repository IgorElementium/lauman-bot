import { searchRead } from './client.js';
import { logger } from '../utils/logger.js';

export interface OdooLead {
  id: number;
  name: string;
  contact_name?: string;
  phone?: string;
  email_from?: string;
  city?: string;
  description?: string;
  source_id?: [number, string]; // [id, name]
  stage_id?: [number, string]; // [id, name]
  create_date?: string;
}

export async function getNewLeads(
  sinceTimestamp: string
): Promise<OdooLead[]> {
  logger.info('Fetching new leads from Odoo', { sinceTimestamp });

  try {
    const leads = (await searchRead(
      'crm.lead',
      [
        ['create_date', '>', sinceTimestamp],
        ['type', '=', 'opportunity'],
      ],
      [
        'id',
        'name',
        'contact_name',
        'phone',
        'email_from',
        'city',
        'description',
        'source_id',
        'stage_id',
        'create_date',
      ],
      { order: 'create_date ASC' }
    )) as unknown as OdooLead[];

    logger.info('Fetched leads from Odoo', {
      count: leads.length,
      leadIds: leads.map((l) => l.id),
    });

    return leads;
  } catch (error) {
    logger.error('Failed to fetch new leads from Odoo', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function getLeadDetail(leadId: number): Promise<OdooLead> {
  logger.debug('Fetching lead detail from Odoo', { leadId });

  try {
    const [lead] = (await searchRead(
      'crm.lead',
      [['id', '=', leadId]],
      [
        'id',
        'name',
        'contact_name',
        'phone',
        'email_from',
        'city',
        'description',
        'source_id',
        'stage_id',
        'create_date',
      ]
    )) as unknown as OdooLead[];

    if (!lead) {
      throw new Error(`Lead ${leadId} not found in Odoo`);
    }

    return lead;
  } catch (error) {
    logger.error('Failed to fetch lead detail from Odoo', {
      leadId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
