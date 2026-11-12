#!/usr/bin/env node
/**
 * Copies everything GoMambo could not recreate onto a disk you control:
 * every table in the public schema, the account list, and every file in
 * Storage — car photos, OC policies, driving-licence scans and selfies.
 *
 * Supabase's own daily backups (Pro plan) cover the database only; they
 * "do not include objects you store via the Storage API". On the Free plan
 * there are no backups at all. This is the copy that survives both.
 *
 * Usage:
 *   node scripts/backup.mjs --dry-run            what would be copied, writes nothing
 *   node scripts/backup.mjs /Volumes/Kopia       copy into a new dated folder there
 *
 * The output holds identity documents and selfies. Keep it only on an
 * encrypted disk (FileVault, or an encrypted external drive), never in a
 * synced folder. Password hashes are NOT exported: after a restore, people
 * set a new password through "Zapomniałem hasła".
 *
 * Read-only against production: SELECTs and Storage downloads, nothing else.
 * Keys come from .env.local and are never printed.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Dates and timestamps exactly as Postgres prints them. The default parsers
// turn a `date` into local midnight, which JSON then writes in UTC — on a
// Polish machine 2026-07-16 became "2026-07-15T22:00:00.000Z" — and drop the
// microseconds of a timestamptz. A backup must restore to the same values.
for (const oid of [pg.types.builtins.DATE, pg.types.builtins.TIMESTAMP, pg.types.builtins.TIMESTAMPTZ]) {
  pg.types.setTypeParser(oid, (value) => value);
}

function loadEnv() {
  const env = {};
  try {
    for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // reported below as missing variables
  }
  return { ...env, ...process.env };
}

const env = loadEnv();
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const target = args.find((a) => !a.startsWith("--"));

for (const name of ["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!env[name]) {
    console.error(`Brak ${name} w .env.local — przerywam.`);
    process.exit(1);
  }
}
if (!dryRun && !target) {
  console.error("Podaj katalog docelowy, np.: node scripts/backup.mjs /Volumes/Kopia  (albo --dry-run)");
  process.exit(1);
}

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
// --dry-run wins over a target: it must never write, whatever else is given.
const outDir = !dryRun && target ? join(target, `gomambo-kopia-${stamp}`) : null;
if (outDir && existsSync(outDir) && readdirSync(outDir).length > 0) {
  console.error(`${outDir} już istnieje i nie jest pusty — przerywam, żeby niczego nie nadpisać.`);
  process.exit(1);
}

const db = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const write = (path, data) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
};

// A dropped connection (Wi-Fi, a sleeping laptop, the pooler) must end the
// run with a message, not an unhandled exception halfway through.
db.on("error", (error) => console.error("Połączenie z bazą przerwane:", error.message));
await db.connect();
const manifest = { createdAt: new Date().toISOString(), tables: {}, storage: {} };
// One snapshot for every query, so a car deleted mid-backup cannot leave its
// photos in the copy without the car — and READ ONLY makes the database itself
// refuse any write, whatever this script ever turns into.
await db.query("begin isolation level repeatable read read only");
try {
  // 1. Tables — the schema itself is in supabase/migrations, in git.
  const { rows: tables } = await db.query(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`
  );
  for (const { table_name: table } of tables) {
    const { rows } = await db.query(`select * from public."${table}"`);
    manifest.tables[table] = rows.length;
    if (outDir) write(join(outDir, "db", `${table}.json`), JSON.stringify(rows, null, 1));
  }

  // 2. Accounts — who can log in, without the password hashes.
  const { rows: users } = await db.query(
    `select id, email, phone, email_confirmed_at, created_at, last_sign_in_at, raw_user_meta_data
     from auth.users order by created_at`
  );
  manifest.tables["auth.users (bez haseł)"] = users.length;
  if (outDir) write(join(outDir, "db", "auth_users.json"), JSON.stringify(users, null, 1));

  // 3. Storage — the object list from the database, the bytes from the API.
  const { rows: objects } = await db.query(
    `select bucket_id, name, coalesce((metadata->>'size')::bigint, 0) as size
     from storage.objects order by bucket_id, name`
  );
  // Everything is read: let go of the snapshot (and the connection) before
  // the downloads, which can take minutes and go over HTTP anyway.
  await db.query("rollback");
  await db.end();
  for (const object of objects) {
    const entry = (manifest.storage[object.bucket_id] ??= { files: 0, bytes: 0, failed: [] });
    entry.files += 1;
    entry.bytes += Number(object.size);
    if (!outDir) continue;
    const { data, error } = await supabase.storage.from(object.bucket_id).download(object.name);
    if (error || !data) {
      entry.failed.push(object.name);
      continue;
    }
    write(join(outDir, "storage", object.bucket_id, object.name), Buffer.from(await data.arrayBuffer()));
  }
} finally {
  await db.query("rollback").catch(() => {});
  await db.end().catch(() => {});
}

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
console.log(dryRun ? "Próba (nic nie zapisano):" : `Kopia zapisana w: ${outDir}`);
for (const [table, count] of Object.entries(manifest.tables)) console.log(`  tabela ${table}: ${count}`);
let failedTotal = 0;
for (const [bucket, { files, bytes, failed }] of Object.entries(manifest.storage)) {
  failedTotal += failed.length;
  console.log(`  pliki ${bucket}: ${files} (${mb(bytes)})${failed.length ? ` — NIE POBRANO ${failed.length}` : ""}`);
}
if (outDir) write(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
if (failedTotal > 0) {
  console.error(`Uwaga: ${failedTotal} plików się nie pobrało — lista w manifest.json. Uruchom kopię jeszcze raz.`);
  process.exit(2);
}
