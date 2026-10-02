import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { activeDatabasePath, DatabaseMaintenance } from "@/lib/database-maintenance";

export const databaseMaintenance = new DatabaseMaintenance(activeDatabasePath());
databaseMaintenance.initialize();

declare global {
  var prisma: PrismaClient | undefined;
}

const client = global.prisma ?? new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: activeDatabasePath() }),
});
if (process.env.NODE_ENV !== "production") global.prisma = client;
let connectedGeneration = -1;

async function reconnectIfChanged(ownership?: Parameters<typeof databaseMaintenance.generation>[0]) {
  if (!ownership) return;
  const generation = databaseMaintenance.generation(ownership);
  if (generation !== connectedGeneration) {
    await client.$disconnect();
    await client.$connect();
    connectedGeneration = generation;
  }
}

const guarded = client.$extends({
  query: {
    $allOperations: async ({ args, query }) => databaseMaintenance.query(async (ownership) => {
      await reconnectIfChanged(ownership);
      return query(args);
    }),
  },
});

// Prisma promises are lazy. The outer transaction lease covers startup, every
// statement, and commit; query hooks inside it reuse AsyncLocalStorage ownership.
export const prisma = new Proxy(client, {
  get(target, property) {
    if (property === "$transaction") {
      return (...args: unknown[]) => databaseMaintenance.query(async (ownership) => {
        await reconnectIfChanged(ownership);
        return Reflect.apply(guarded.$transaction, guarded, args);
      });
    }
    return property in guarded ? Reflect.get(guarded, property) : Reflect.get(target, property);
  },
});

export async function disconnectDatabase() { await client.$disconnect(); }
export async function reconnectDatabase() {
  await client.$connect();
  // Query the base client while restore owns the lease, before committing it.
  await client.$queryRawUnsafe("SELECT 1");
  connectedGeneration = -1;
}
