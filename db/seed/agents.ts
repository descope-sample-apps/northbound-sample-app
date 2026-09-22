import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '@/db/schema';

export const AGENT_IDS = {
  shoppingAssistant: 'agent_shopping_assistant',
  pantryBot: 'agent_pantry_bot',
} as const;

/**
 * The agent registry's demo contents.
 *
 * `agent_shopping_assistant` is the one the parent specification's example
 * token names, and the one the consent screen is designed around.
 *
 * These are actors, not accounts. Nothing here grants access by itself — an
 * agent only ever acts for a customer who authorized it, and the authorization
 * lives in the tokens table.
 */
export async function seedAgents(db: LibSQLDatabase<typeof schema>): Promise<void> {
  const now = new Date('2026-01-15T09:00:00Z');

  await db.insert(schema.agents).values([
    {
      id: AGENT_IDS.shoppingAssistant,
      displayName: 'Shopping Assistant',
      owner: 'Northbound Labs',
      logoPath: '/agents/shopping-assistant.svg',
      description: 'Reorders the things you buy often and watches for restocks.',
      createdAt: now,
    },
    {
      id: AGENT_IDS.pantryBot,
      displayName: 'Pantry Bot',
      owner: 'Example Automations',
      logoPath: '/agents/pantry-bot.svg',
      description: 'Keeps a running list and fills it on a schedule.',
      createdAt: now,
    },
  ]);
}
