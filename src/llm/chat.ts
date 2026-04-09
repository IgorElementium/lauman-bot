import { callClaude, MessageParam, ToolUseBlock, TextBlock } from './client.js';
import { SYSTEM_PROMPT } from './system-prompt.js';
import { TOOLS } from './tools.js';
import { executeTool } from './tool-executor.js';
import {
  getOrCreateSession,
  updateSession,
  getConversationHistory,
  addToConversationHistory,
} from '../db/sessions.js';
import { getLeadDetail } from '../odoo/leads.js';
import { logger } from '../utils/logger.js';

const MAX_TOOL_LOOPS = 5; // Prevent infinite loops

export interface ChatResponse {
  text: string;
  updatedLeadId?: number;
}

export async function handleMessage(
  chatId: number,
  userMessage: string
): Promise<ChatResponse> {
  logger.info('Handling chat message', { chatId, messageLength: userMessage.length });

  try {
    // Get or create session
    const session = getOrCreateSession(chatId);
    updateSession(chatId, {
      last_message_at: new Date().toISOString(),
    });

    // Add user message to history
    addToConversationHistory(chatId, 'user', userMessage);

    // Get conversation history (last 30 messages)
    const history = getConversationHistory(chatId, 30);

    // If there's an active lead, inject its details as context
    let systemPrompt = SYSTEM_PROMPT;
    if (session.active_lead_id) {
      try {
        const lead = await getLeadDetail(session.active_lead_id);
        const leadContext = `
**Actieve lead:** ${lead.name} (ID ${lead.id})
- Stadt: ${lead.city}
- Telefoonnummer: ${lead.phone}
- Stadium: ${lead.stage_id ? lead.stage_id[1] : 'Onbekend'}

Gebruik deze lead als context tenzij Jorn expliciet naar een ander lead verwijst.`;
        systemPrompt = SYSTEM_PROMPT + '\n' + leadContext;
      } catch (error) {
        logger.warn('Failed to load active lead context', { leadId: session.active_lead_id });
      }
    }

    // Call Claude with conversation history
    const messages: MessageParam[] = [...history, { role: 'user', content: userMessage }];

    let response = await callClaude(messages, TOOLS, systemPrompt);
    let assistantText = '';
    let toolLoopCount = 0;

    // Loop: handle tool calls until Claude stops calling tools or gives final text
    while (response.stop_reason === 'tool_use' && toolLoopCount < MAX_TOOL_LOOPS) {
      toolLoopCount++;
      logger.info('Processing tool calls', { loopCount: toolLoopCount });

      // Extract text and tool calls from response
      for (const block of response.content) {
        if ((block as TextBlock).type === 'text') {
          assistantText += (block as TextBlock).text;
        }
      }

      // Collect tool results
      const toolResults: MessageParam = {
        role: 'user',
        content: [],
      };

      for (const block of response.content) {
        if ((block as ToolUseBlock).type === 'tool_use') {
          const toolUse = block as ToolUseBlock;
          logger.info('Executing tool call', { toolName: toolUse.name });

          try {
            const result = await executeTool(toolUse.name, toolUse.input as Record<string, unknown>);
            logger.info('Tool result', { toolName: toolUse.name, resultLength: result.length });

            // Add tool result to messages
            if (Array.isArray(toolResults.content)) {
              toolResults.content.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: result,
              });
            }

            // Log to conversation history
            addToConversationHistory(chatId, 'tool_result', result, {
              tool_name: toolUse.name,
            });
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : 'Onbekende fout bij tool uitvoering';
            logger.error('Tool execution failed', { toolName: toolUse.name, error: errorMessage });

            if (Array.isArray(toolResults.content)) {
              toolResults.content.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: `Fout: ${errorMessage}`,
                is_error: true,
              });
            }
          }
        }
      }

      // Call Claude again with tool results
      const nextMessages: MessageParam[] = [
        ...history,
        { role: 'user', content: userMessage },
        { role: 'assistant', content: response.content },
        toolResults,
      ];

      response = await callClaude(nextMessages, TOOLS, systemPrompt);
    }

    // Extract final text response
    for (const block of response.content) {
      if ((block as TextBlock).type === 'text') {
        assistantText += (block as TextBlock).text;
      }
    }

    // Add assistant response to history
    addToConversationHistory(chatId, 'assistant', assistantText);

    // Try to detect if Claude set a new active lead
    // (Look for patterns like "lead 123" or "de lead van [city]" in tools called)
    let updatedLeadId: number | undefined = undefined;
    for (const block of response.content) {
      if ((block as ToolUseBlock).type === 'tool_use') {
        const toolUse = block as ToolUseBlock;
        if (toolUse.input && typeof toolUse.input === 'object' && 'lead_id' in toolUse.input) {
          updatedLeadId = (toolUse.input as { lead_id?: number }).lead_id;
          if (updatedLeadId) {
            updateSession(chatId, {
              active_lead_id: updatedLeadId,
              active_lead_set_at: new Date().toISOString(),
            });
          }
        }
      }
    }

    return {
      text: assistantText,
      updatedLeadId,
    };
  } catch (error) {
    logger.error('Chat handling failed', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });

    const errorMessage = 'Oops, er ging iets mis. Probeer opnieuw.';
    addToConversationHistory(chatId, 'assistant', errorMessage);
    return { text: errorMessage };
  }
}
