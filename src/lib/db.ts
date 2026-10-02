import path from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { recoverRestoreJournal } from "@/lib/restore-safety";

const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
const sqlitePath = path.resolve(
  databaseUrl.startsWith("file:") ? databaseUrl.slice("file:".length) : databaseUrl,
);
try {
  recoverRestoreJournal(sqlitePath);
} catch (error) {
  console.error("Database restore recovery failed:", error);
}
const adapter = new PrismaBetterSqlite3({ url: sqlitePath });

declare global {
  var prisma: PrismaClient | undefined;
}

export const prisma = global.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}
