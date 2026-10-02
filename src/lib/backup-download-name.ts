export function getBackupDownloadFilename(customName: string | null): string {
  const stem = (customName ?? "")
    .trim()
    .replace(/(?:\.(?:db|sqlite))+$/i, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 120);

  if (!/[a-zA-Z0-9]/.test(stem)) {
    return `xbook-backup-${new Date().toISOString().slice(0, 10)}.db`;
  }

  return `${stem}.db`;
}
