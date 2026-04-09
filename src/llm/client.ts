import Anthropic from '@anthropic-ai/sdk';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

let client: Anthropic | null = null;

export function getLlmClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      apiKey: config.claude.apiKey,
    });
  }
  return client;
}

export type MessageParam = Anthropic.Messages.MessageParam;
export type ToolUseBlock = Anthropic.Messages.ToolUseBlock;
export type TextBlock = Anthropic.Messages.TextBlock;

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

export async function callClaude(
  messages: MessageParam[],
  tools: ToolDefinition[],
  systemPrompt: string,
  modelOverride?: string
): Promise<Anthropic.Messages.Message> {
  const model = modelOverride || config.claude.model;

  logger.debug('Calling Claude API', {
    model,
    messageCount: messages.length,
    toolCount: tools.length,
  });

  try {
    const response = await getLlmClient().messages.create({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      tools: tools as Anthropic.Messages.Tool[],
      messages,
    });

    logger.debug('Claude response received', {
      stopReason: response.stop_reason,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    return response;
  } catch (error) {
    logger.error('Claude API call failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
