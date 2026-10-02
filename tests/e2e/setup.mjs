import { rmSync } from "node:fs";
import { dirname, basename } from "node:path";

export default async function setup() {
  const databaseUrl = process.env.XBOOK_E2E_DATABASE_URL;
  if (!databaseUrl?.startsWith("file:")) throw new Error("Missing disposable E2E database");
  const directory = dirname(databaseUrl.slice(5));
  if (!basename(directory).startsWith("xbook-e2e-")) {
    throw new Error("E2E database must live in a disposable xbook-e2e directory");
  }
  return async () => {
    rmSync(directory, { recursive: true, force: true });
  };
}
