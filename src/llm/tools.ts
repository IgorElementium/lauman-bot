import { ToolDefinition } from './client.js';

export const TOOLS: ToolDefinition[] = [
  {
    name: 'search_leads',
    description:
      'Zoek naar leads op naam, stad, telefoonnummer of vrije tekst. Gebruik dit als Jorn een lead noemt maar je weet niet welk ID het is, of als je meerdere matches nodig hebt.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Zoekopdracht: naam, stad, telefoon, of vrije tekst. Bijv. "die van Mortsel", "Jan", "+32 1 234 5678"',
        },
        limit: {
          type: 'number',
          description: 'Maximaal aantal resultaten (default 5)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_lead_detail',
    description:
      'Haal volledige informatie van een lead op uit Odoo. Gebruik dit als je meer context nodig hebt over een specifieke lead (telefoonnummer, email, beschrijving, huidige stage, etc.)',
    input_schema: {
      type: 'object',
      properties: {
        lead_id: {
          type: 'number',
          description: 'Odoo lead ID',
        },
      },
      required: ['lead_id'],
    },
  },
  {
    name: 'create_note',
    description:
      'Plaats een interne notitie op een lead in Odoo. Gebruik dit om wat Jorn vertelt vast te leggen (bijv. "Gebeld, voicemail ingesproken" of "Heeft gezegd volgende week beschikbaar").',
    input_schema: {
      type: 'object',
      properties: {
        lead_id: {
          type: 'number',
          description: 'Odoo lead ID',
        },
        body: {
          type: 'string',
          description: 'De notitie (vrije tekst, wordt in Odoo chatter geplaatst)',
        },
      },
      required: ['lead_id', 'body'],
    },
  },
  {
    name: 'update_lead_stage',
    description:
      'Verplaats een lead naar een ander stadium in de pipeline. Stages: Nieuw, Bezoek plannen, Offerte opgesteld, Aannemer goedkeuring, Versturen naar klant, Gewonnen, Verloren. Vraag bevestiging voor Gewonnen of Verloren.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id: {
          type: 'number',
          description: 'Odoo lead ID',
        },
        stage: {
          type: 'string',
          description:
            'Doelstadium in Nederlands (bijv. "Bezoek plannen", "Offerte opgesteld")',
        },
      },
      required: ['lead_id', 'stage'],
    },
  },
  {
    name: 'schedule_activity',
    description:
      'Plan een vervolgactiviteit in (call, todo, email, meeting). Gebruik dit als Jorn wil dat je iets inplant ("herinnering zetten", "taak aanmaken", etc.)',
    input_schema: {
      type: 'object',
      properties: {
        lead_id: {
          type: 'number',
          description: 'Odoo lead ID',
        },
        activity_type: {
          type: 'string',
          enum: ['call', 'todo', 'email', 'meeting'],
          description: 'Type activiteit',
        },
        date_deadline: {
          type: 'string',
          description:
            'Deadline: "today", "tomorrow", "in 3 hours", "donderdag", of ISO date "2026-04-10"',
        },
        summary: {
          type: 'string',
          description: 'Korte beschrijving van wat er moet gebeuren',
        },
      },
      required: ['lead_id', 'activity_type', 'date_deadline', 'summary'],
    },
  },
  {
    name: 'get_pipeline_summary',
    description:
      'Haal een overzicht van alle open leads op, gegroepeerd per stadium. Gebruik dit als Jorn wil weten welke leads nog open staan, welke moet terugbellen, etc.',
    input_schema: {
      type: 'object',
      properties: {
        stages: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optioneel: filter op specifieke stages (bijv. ["Nieuw", "Bezoek plannen"]). Als leeg, alle stages.',
        },
      },
      required: [],
    },
  },
];

export function getToolByName(name: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.name === name);
}
