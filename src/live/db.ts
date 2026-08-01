import "server-only";

import postgres, { type Sql } from "postgres";

import { getLiveEnvironment } from "./env";
import { LIVE_SCHEMA_SQL } from "./schema-sql";

const globalDatabase = globalThis as typeof globalThis & {
  relayBuyLiveMigration?: Promise<void>;
  relayBuyLiveSql?: Sql;
};

export function getLiveSql(): Sql {
  if (!globalDatabase.relayBuyLiveSql) {
    const { DATABASE_SSL, DATABASE_URL } = getLiveEnvironment();
    globalDatabase.relayBuyLiveSql = postgres(DATABASE_URL, {
      connect_timeout: 10,
      idle_timeout: 20,
      max: 3,
      prepare: false,
      ssl: DATABASE_SSL === "disable" ? false : DATABASE_SSL,
      transform: postgres.camel,
    });
  }
  return globalDatabase.relayBuyLiveSql;
}

export async function ensureLiveSchema(): Promise<void> {
  globalDatabase.relayBuyLiveMigration ??= (async () => {
    const sql = getLiveSql();
    await sql.unsafe(LIVE_SCHEMA_SQL);
  })();
  await globalDatabase.relayBuyLiveMigration;
}
