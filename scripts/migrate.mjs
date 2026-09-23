#!/usr/bin/env node
/**
 * Applies the SQL files in supabase/migrations that the database has not seen
 * yet, in filename order, each inside its own transaction.
 *
 * Until now every migration was pasted into the Supabase SQL editor by hand,
 * which meant nobody could tell from the code which ones had actually run —
 * the only way to check was a PostgREST probe per table. This records it.
 *
 * Usage:
 *   node scripts/migrate.mjs --status              what is applied, what is pending
 *   node scripts/migrate.mjs --baseline 0041       mark 0001..0041 as already applied
 *   node scripts/migrate.mjs                       apply everything pending
 *   node scripts/migrate.mjs --only 0042           apply exactly one
 *
 * DATABASE_URL comes from .env.local and is never printed.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

function loadEnv() {
  const env = {};
  try {
    for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // falls through to the missing-DATABASE_URL message below
  }
  return env;
}

const env = loadEnv();
const DATABASE_URL = process.env.DATABASE_URL || env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error(
    [
      "Brak DATABASE_URL.",
      "",
      "Supabase → Project Settings → Database → Connection string → URI",
      "Wklej do .env.local jako jedną linię:",
      "",
      "  DATABASE_URL=postgresql://postgres.<ref>:<hasło>@<host>:5432/postgres",
      "",
      "Nie wklejaj go do czatu ani do repozytorium — .env.local jest ignorowany przez git.",
    ].join("\n")
  );
  process.exit(1);
}

// Guard against running migrations against the wrong project: both the direct
// (db.<ref>.supabase.co) and the pooler (user postgres.<ref>) forms carry the
// project ref, and NEXT_PUBLIC_SUPABASE_URL is the ref this app talks to.
const expectedRef = (env.NEXT_PUBLIC_SUPABASE_URL || "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
const urlRef =
  DATABASE_URL.match(/@db\.([a-z0-9]+)\.supabase\.co/)?.[1] ||
  DATABASE_URL.match(/postgres\.([a-z0-9]+):/)?.[1];
if (expectedRef && urlRef && expectedRef !== urlRef) {
  console.error(
    `DATABASE_URL wskazuje na projekt "${urlRef}", a aplikacja używa "${expectedRef}". Przerywam.`
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] ?? true;
};

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const client = new pg.Client({
  connectionString: DATABASE_URL,
  // Supabase terminates TLS with its own chain; this is the same setting the
  // Supabase CLI uses for a direct connection.
  ssl: { rejectUnauthorized: false },
});

function versionOf(file) {
  return file.split("_")[0];
}

async function main() {
  await client.connect();

  await client.query(`
    create table if not exists public.schema_migrations (
      version text primary key,
      filename text not null,
      applied_at timestamptz not null default now()
    );
  `);

  const { rows } = await client.query("select version from public.schema_migrations");
  const applied = new Set(rows.map((r) => r.version));

  const baseline = flag("--baseline");
  if (baseline) {
    const upTo = String(baseline);
    const toMark = files.filter((f) => versionOf(f) <= upTo && !applied.has(versionOf(f)));
    for (const file of toMark) {
      await client.query(
        "insert into public.schema_migrations (version, filename) values ($1, $2) on conflict do nothing",
        [versionOf(file), file]
      );
    }
    console.log(`Oznaczono jako już wykonane: ${toMark.length} migracji (do ${upTo} włącznie).`);
    toMark.forEach((f) => console.log(`  · ${f}`));
    await client.end();
    return;
  }

  const only = flag("--only");
  const pending = files.filter(
    (f) => !applied.has(versionOf(f)) && (!only || versionOf(f) === String(only))
  );

  if (args.includes("--status")) {
    console.log(`Wykonane: ${applied.size}`);
    console.log(`Oczekujące: ${pending.length}`);
    pending.forEach((f) => console.log(`  · ${f}`));
    await client.end();
    return;
  }

  if (pending.length === 0) {
    console.log("Nic do zrobienia — baza jest aktualna.");
    await client.end();
    return;
  }

  for (const file of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    process.stdout.write(`→ ${file} … `);
    try {
      // One transaction per migration: a file that fails halfway leaves
      // nothing behind, and the version is only recorded if it committed.
      await client.query("begin");
      await client.query(sql);
      await client.query(
        "insert into public.schema_migrations (version, filename) values ($1, $2)",
        [versionOf(file), file]
      );
      await client.query("commit");
      console.log("OK");
    } catch (error) {
      await client.query("rollback");
      console.log("BŁĄD");
      console.error(`\n${error.message}\n`);
      console.error("Wycofane. Żadna późniejsza migracja nie została uruchomiona.");
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  console.log(`\nGotowe — wykonano ${pending.length}.`);
}

main().catch(async (error) => {
  console.error(error.message);
  try {
    await client.end();
  } catch {
    // connection may never have opened
  }
  process.exit(1);
});
