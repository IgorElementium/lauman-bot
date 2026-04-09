import {
  getLeadsDueForNudge,
  updateFollowUpState,
  isQuietHours,
} from '../db/follow-up-state.js';
import { getLeadDetail } from '../odoo/leads.js';
import { bot } from '../telegram/bot.js';
import { handleMessage } from '../llm/chat.js';
import { logger } from '../utils/logger.js';
import { config } from '../utils/config.js';

export async function runNudgeHeartbeat(): Promise<void> {
  logger.info('Nudge heartbeat running');

  try {
    // Don't send nudges during quiet hours
    if (isQuietHours()) {
      logger.info('Nudge heartbeat: quiet hours active, skipping');
      return;
    }

    // Get leads that are due for a nudge
    const dueLeads = getLeadsDueForNudge();

    if (dueLeads.length === 0) {
      logger.info('Nudge heartbeat: no leads due for nudge');
      return;
    }

    logger.info('Nudge heartbeat: processing leads', {
      count: dueLeads.length,
      leadIds: dueLeads.map((l) => l.odoo_lead_id),
    });

    // Process each lead
    for (const record of dueLeads) {
      try {
        const leadDetail = await getLeadDetail(record.odoo_lead_id);

        // Generate nudge message via Claude
        let nudgePrompt = '';
        if (record.state === 'NUDGE_1') {
          nudgePrompt = `Jorn, het is tijd om ${leadDetail.name} uit ${leadDetail.city} terug te bellen.
Nummer: ${leadDetail.name} Bel hem nu terug! Je hebt al ${Math.floor(
            (Date.now() - new Date(record.state_changed_at).getTime()) / 3600000
          )} uur niets van hem gehoord.`;
        } else if (record.state === 'NUDGE_2') {
          nudgePrompt = `Nog steeds niets van ${leadDetail.name} (${leadDetail.city}) gehoord?
Het is nu 24 uur geleden dat hij belde. Nummer: ${leadDetail.phone}`;
        } else if (record.state === 'NUDGE_3') {
          nudgePrompt = `LAATSTE HERINNERING: ${leadDetail.name} (${leadDetail.city}) wacht nog steeds.
${leadDetail.phone} — probeer het nu nog een keer!`;
        } else if (record.state === 'COLD') {
          nudgePrompt = `${leadDetail.name} is nu COLD (geen contact 48h+). Ik stop met nudgen.`;
        }

        // Send nudge via LLM (so it sounds natural)
        const nudgeMessage = `(Automatische herinnering) ${nudgePrompt}`;

        // Send to all allowed chat IDs
        for (const chatId of config.telegram.allowedChatIds) {
          try {
            await bot.api.sendMessage(chatId, nudgeMessage);

            logger.info('Sent nudge message', {
              leadId: record.odoo_lead_id,
              state: record.state,
              chatId,
            });
          } catch (error) {
            logger.error('Failed to send nudge', {
              leadId: record.odoo_lead_id,
              chatId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Update state
        const now = new Date().toISOString();
        if (record.state === 'COLD') {
          updateFollowUpState(record.odoo_lead_id, 'COLD', now);
          logger.info('Lead moved to COLD', { leadId: record.odoo_lead_id });
        } else {
          // Transition to next state
          const stateMap: Record<string, string> = {
            FRESH: 'NUDGE_1',
            NUDGE_1: 'NUDGE_2',
            NUDGE_2: 'NUDGE_3',
            NUDGE_3: 'COLD',
          };
          const nextState = stateMap[record.state] || 'COLD';
          updateFollowUpState(
            record.odoo_lead_id,
            nextState as any,
            now
          );
          logger.info('Lead state transitioned', {
            leadId: record.odoo_lead_id,
            from: record.state,
            to: nextState,
          });
        }
      } catch (error) {
        logger.error('Error processing nudge', {
          leadId: record.odoo_lead_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    logger.error('Nudge heartbeat failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function startNudgeHeartbeat(): NodeJS.Timeout {
  logger.info('Starting nudge heartbeat', { intervalMs: 30 * 60 * 1000 });

  // Run every 30 minutes
  return setInterval(() => {
    runNudgeHeartbeat().catch((error) => {
      logger.error('Nudge heartbeat error', { error });
    });
  }, 30 * 60 * 1000); // 30 minutes
}
