import { mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

const databasePath = process.env.DATABASE_PATH || resolve("var", "call-bridge.sqlite");
const backupDirectory = process.env.BACKUP_DIRECTORY || join(dirname(databasePath), "backups");
const retentionDays = Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS || 14));
await mkdir(backupDirectory, { recursive: true });
const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z").replaceAll(":", "-");
const target = join(backupDirectory, `bridge-${stamp}.sqlite`);
const db = new DatabaseSync(databasePath, { readOnly: true });
try {
  await backup(db, target);
} finally {
  db.close();
}
const threshold = Date.now() - retentionDays * 86400_000;
for (const entry of await readdir(backupDirectory, { withFileTypes: true })) {
  const match = /^bridge-(.+)\.sqlite$/.exec(entry.name);
  if (!entry.isFile() || !match) continue;
  const parsed = Date.parse(match[1].replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})Z$/, "$1:$2:$3Z"));
  if (Number.isFinite(parsed) && parsed < threshold) await rm(join(backupDirectory, entry.name));
}
console.log(JSON.stringify({ ok: true, target, retentionDays }));
