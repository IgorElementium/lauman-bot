import { getNewLeads } from '../odoo/leads.js';
import { isLeadSeen, markLeadSeen } from '../db/seen-leads.js';
import { bot } from '../telegram/bot.js';
import { logger } from '../utils/logger.js';
import { config } from '../utils/config.js';

let lastPollTimestamp = new Date().toISOString();

function formatLeadMessage(lead: any): string {
  const name = lead.name || 'Onbekend';
  const city = lead.city || 'Onbekend';
  const phone = lead.phone || 'N/A';
  const email = lead.email_from || 'N/A';
  const source = lead.source_id ? lead.source_id[1] : 'Onbekend';
  const description = (lead.description || '')
    .substring(0, 300)
    .replace(/<[^>]*>/g, '') // strip HTML
    .trim();

  return `📥 Nieuwe lead: ${name}
📍 ${city}
📞 ${phone}
📧 ${email}
🔗 Bron: ${source}

${description}`;
}

export async function runOdooPoller(): Promise<void> {
  logger.info('Odoo poller starting', { lastPoll: lastPollTimestamp });

  try {
    // Fetch new leads (strip 'Z' timezone because Odoo doesn't like it)
    const odooTimestamp = lastPollTimestamp.replace('Z', '');
    const leads = await getNewLeads(odooTimestamp);
    logger.info('Odoo poller: fetched leads', { count: leads.length });

    // Update poll timestamp for next run
    lastPollTimestamp = new Date().toISOString();

    // Process each lead
    for (const lead of leads) {
      try {
        // Check dedup
        if (isLeadSeen(lead.id)) {
          logger.info('Lead already seen, skipping', { leadId: lead.id });
          continue;
        }

        // Format and send message
        const message = formatLeadMessage(lead);
        for (const chatId of config.telegram.allowedChatIds) {
          try {
            const sentMessage = await bot.api.sendMessage(chatId, message);
            logger.info('Sent lead notification', {
              leadId: lead.id,
              chatId,
              messageId: sentMessage.message_id,
            });

            // Mark as seen
            markLeadSeen(lead.id);
          } catch (error) {
            logger.error('Failed to send lead notification', {
              leadId: lead.id,
              chatId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } catch (error) {
        logger.error('Error processing lead', {
          leadId: lead.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    logger.error('Odoo poller failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function startOdooPoller(): NodeJS.Timeout {
  logger.info('Starting Odoo poller', {
    intervalMs: config.bot.pollIntervalMs,
  });

  // Run immediately on startup
  runOdooPoller().catch((error) => {
    logger.error('Initial Odoo poll failed', { error });
  });

  // Then run every N milliseconds
  return setInterval(() => {
    runOdooPoller().catch((error) => {
      logger.error('Scheduled Odoo poll failed', { error });
    });
  }, config.bot.pollIntervalMs);
}
