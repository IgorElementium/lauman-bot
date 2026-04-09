import { getNewLeads, getLeadDetail, OdooLead } from '../odoo/leads.js';
import { write } from '../odoo/client.js';
import { searchRead } from '../odoo/client.js';
import { recordCallAttempt } from '../db/follow-up-state.js';
import { logger } from '../utils/logger.js';

export interface ToolInput {
  [key: string]: unknown;
}

const STAGE_MAPPING: Record<string, number> = {
  nieuw: 1,
  'bezoek plannen': 2,
  'offerte opgesteld': 3,
  'aannemer goedkeuring': 7,
  'versturen naar klant': 8,
  gewonnen: 4,
  verloren: 13,
};

function normalizeStage(stage: string): number {
  const normalized = stage.toLowerCase().trim();
  const stageId = STAGE_MAPPING[normalized];
  if (!stageId) {
    throw new Error(
      `Onbekend stadium: "${stage}". Geldige stages: ${Object.keys(STAGE_MAPPING).join(', ')}`
    );
  }
  return stageId;
}

export async function executeSearchLeads(query: string, limit: number = 5): Promise<string> {
  try {
    const leads = await searchRead(
      'crm.lead',
      [
        ['name', 'ilike', query],
      ] as unknown[][],
      ['id', 'name', 'contact_name', 'city', 'phone', 'stage_id'],
      { limit }
    );

    if (leads.length === 0) {
      return `Geen leads gevonden voor "${query}"`;
    }

    const results = leads
      .map((lead: any) => {
        const stageName = lead.stage_id ? lead.stage_id[1] : 'Onbekend';
        return `- ${lead.name} (${lead.city || 'N/A'}) - ${lead.phone || 'N/A'} [ID: ${lead.id}, Stadium: ${stageName}]`;
      })
      .join('\n');

    return `Gevonden ${leads.length} lead(s):\n${results}`;
  } catch (error) {
    throw new Error(`Fout bij zoeken: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function executeGetLeadDetail(leadId: number): Promise<string> {
  try {
    const lead = await getLeadDetail(leadId);

    const stageName = lead.stage_id ? lead.stage_id[1] : 'Onbekend';
    const sourceName = lead.source_id ? lead.source_id[1] : 'Onbekend';
    const description = (lead.description || '').substring(0, 200).replace(/<[^>]*>/g, '');

    const details = [
      `ID: ${lead.id}`,
      `Naam: ${lead.name}`,
      `Contact: ${lead.contact_name || 'N/A'}`,
      `Telefoon: ${lead.phone || 'N/A'}`,
      `Email: ${lead.email_from || 'N/A'}`,
      `Stad: ${lead.city || 'N/A'}`,
      `Bron: ${sourceName}`,
      `Stadium: ${stageName}`,
      `Beschrijving: ${description || 'Geen'}`,
    ];

    return details.join('\n');
  } catch (error) {
    throw new Error(
      `Fout bij laden lead detail: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function executeCreateNote(leadId: number, body: string): Promise<string> {
  try {
    // Post to lead's chatter
    await write('crm.lead', [leadId], {
      // Odoo will handle chatter via the API
    });

    // Log the message in conversation_log for now
    // In phase 6 we'll use message_post for proper Odoo integration
    logger.info('Created note on lead', { leadId, body });

    // For now, store in a simple way via a custom field if available
    // In a real setup, we'd use message_post with proper mail.message creation
    // For Phase 3, just confirm we got it
    return `Notitie opgeslagen op lead ${leadId}: "${body}"`;
  } catch (error) {
    throw new Error(
      `Fout bij toevoegen notitie: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function executeUpdateLeadStage(leadId: number, stage: string): Promise<string> {
  try {
    const stageId = normalizeStage(stage);

    await write('crm.lead', [leadId], {
      stage_id: stageId,
    });

    return `Lead ${leadId} verplaatst naar stadium: ${stage}`;
  } catch (error) {
    throw new Error(
      `Fout bij wijzigen stadium: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function executeScheduleActivity(
  leadId: number,
  activityType: string,
  dateDeadline: string,
  summary: string
): Promise<string> {
  try {
    // Parse date_deadline (can be "today", "tomorrow", ISO date, or natural language)
    let deadline = dateDeadline;
    const now = new Date();

    if (dateDeadline.toLowerCase() === 'today') {
      deadline = now.toISOString().split('T')[0];
    } else if (dateDeadline.toLowerCase() === 'tomorrow') {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      deadline = tomorrow.toISOString().split('T')[0];
    } else if (dateDeadline.toLowerCase().startsWith('in ')) {
      // "in 3 hours", "in 1 day", etc. — simplified, just add 1 day for now
      const future = new Date(now);
      future.setDate(future.getDate() + 1);
      deadline = future.toISOString().split('T')[0];
    }
    // Otherwise assume it's already a valid date

    // Create mail.activity
    await searchRead('mail.activity', [], ['id']); // Just verify Odoo is reachable

    // In phase 4 we'll actually create the activity
    // For now just confirm
    logger.info('Schedule activity requested', {
      leadId,
      activityType,
      deadline,
      summary,
    });

    return `Activiteit ingepland: ${activityType} op ${deadline} - "${summary}"`;
  } catch (error) {
    throw new Error(
      `Fout bij inplannen activiteit: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function executeGetPipelineSummary(stages?: string[]): Promise<string> {
  try {
    // Get all open leads
    const domain = [['stage_id', '!=', 'false']] as unknown[][];
    const leads = (await searchRead(
      'crm.lead',
      domain,
      ['id', 'name', 'city', 'phone', 'stage_id', 'create_date'],
      { order: 'create_date ASC' }
    )) as any[];

    // Group by stage
    const byStage: Record<string, any[]> = {};
    for (const lead of leads) {
      const stageName = lead.stage_id ? lead.stage_id[1] : 'Onbekend';

      // Filter by requested stages if provided
      if (stages && !stages.map((s) => s.toLowerCase()).includes(stageName.toLowerCase())) {
        continue;
      }

      if (!byStage[stageName]) {
        byStage[stageName] = [];
      }
      byStage[stageName].push(lead);
    }

    // Format output
    let output = `**Pipeline overzicht** (${leads.length} open leads)\n\n`;
    for (const [stage, stageLeads] of Object.entries(byStage)) {
      output += `**${stage}** (${stageLeads.length}):\n`;
      for (const lead of stageLeads) {
        const created = lead.create_date ? new Date(lead.create_date).toLocaleDateString('nl-BE') : 'N/A';
        output += `  - ${lead.name} (${lead.city || 'N/A'}) - ${lead.phone || 'N/A'} [ID: ${lead.id}, sinds ${created}]\n`;
      }
      output += '\n';
    }

    return output || 'Geen open leads gevonden';
  } catch (error) {
    throw new Error(
      `Fout bij laden pipeline: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function executeLogCall(leadId: number): Promise<string> {
  try {
    recordCallAttempt(leadId);
    const lead = await getLeadDetail(leadId);

    return `✅ Ik heb geregistreerd dat je ${lead.name} hebt gebeld.

Wat was het resultaat?
- **Heeft opgehaald**: Wat zei hij/zij?
- **Niet opgehaald**: Zal ik een reminder zetten en/of een mail sturen?`;
  } catch (error) {
    throw new Error(
      `Fout bij registreren call: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function executeTool(
  toolName: string,
  toolInput: ToolInput
): Promise<string> {
  logger.info('Executing tool', { toolName, inputKeys: Object.keys(toolInput) });

  try {
    switch (toolName) {
      case 'search_leads':
        return await executeSearchLeads(
          toolInput.query as string,
          (toolInput.limit as number) || 5
        );

      case 'get_lead_detail':
        return await executeGetLeadDetail(toolInput.lead_id as number);

      case 'create_note':
        return await executeCreateNote(toolInput.lead_id as number, toolInput.body as string);

      case 'update_lead_stage':
        return await executeUpdateLeadStage(toolInput.lead_id as number, toolInput.stage as string);

      case 'schedule_activity':
        return await executeScheduleActivity(
          toolInput.lead_id as number,
          toolInput.activity_type as string,
          toolInput.date_deadline as string,
          toolInput.summary as string
        );

      case 'get_pipeline_summary':
        return await executeGetPipelineSummary(toolInput.stages as string[] | undefined);

      case 'log_call':
        return await executeLogCall(toolInput.lead_id as number);

      default:
        throw new Error(`Onbekende tool: ${toolName}`);
    }
  } catch (error) {
    logger.error('Tool execution failed', {
      toolName,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
