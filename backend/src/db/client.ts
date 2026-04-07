import { neon } from '@neondatabase/serverless';
import { sql } from 'drizzle-orm';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';

import * as schema from './schema';

export type NeonDrizzle = NeonHttpDatabase<typeof schema>;

export function createNeonDrizzle(connectionString: string): NeonDrizzle {
  const httpSql = neon(connectionString);
  return drizzle(httpSql, { schema });
}

export async function pingDatabase(db: NeonDrizzle): Promise<void> {
  await db.execute(sql`select 1`);
}
