import { PrismaClient } from "@prisma/client";

function buildRuntimeDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;

  try {
    const url = new URL(raw);
    if (!url.searchParams.has("pgbouncer")) {
      url.searchParams.set("pgbouncer", "true");
    }
    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", "10");
    }
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", "30");
    }
    return url.toString();
  } catch {
    return raw;
  }
}

const runtimeDatabaseUrl = buildRuntimeDatabaseUrl();

export const prisma = new PrismaClient({
  ...(runtimeDatabaseUrl
    ? {
        datasources: {
          db: {
            url: runtimeDatabaseUrl,
          },
        },
      }
    : {}),
});

