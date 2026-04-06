import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

export function createNeonDrizzle(connectionString: string) {
  const httpSql = neon(connectionString);
  return drizzle(httpSql, { schema });
}

export type NeonDrizzle = ReturnType<typeof createNeonDrizzle>;

export async function pingDatabase(db: NeonDrizzle): Promise<void> {
  await db.execute(sql`select 1`);
}
