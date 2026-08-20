#!/usr/bin/env bun
/**
 * Migration integrity check (Phase 1).
 *
 * Deterministic, read-only-with-respect-to-the-repo check that:
 *   1. Validates the migration journal (sequential idx, tag <-> file match,
 *      per-entry snapshot present, no orphaned SQL files).
 *   2. Applies repository migrations 0000..current to an EMPTY PostgreSQL
 *      database (the Drizzle migrator — the same path as `db:migrate`).
 *   3. Verifies the expected core tables exist, including `tenant_members`,
 *      the Better Auth tables (`user`, `session`, `account`, `verification`),
 *      `content_items` and `api_keys`.
 *   4. Detects schema/migration drift:
 *        a. The migrated database must match the latest committed snapshot
 *           (table set, per-table columns, enums).
 *        b. `src/db/schema.ts` must not drift from the committed migrations
 *           (verified via `drizzle-kit generate` against a throwaway copy of
 *           the migration folder under `node_modules/.migration-check` — never
 *           writes into the repository).
 *
 * Usage (from the repo root or backend/):
 *   DATABASE_URL=postgresql://user:pass@host:5432/db bun run db:check
 *   bun run db:check --reset          # drop+recreate public schema first (destructive!)
 *   bun run db:check --skip-schema-drift  # skip the drizzle-kit generate step
 *
 * Safety: the script refuses to run against a database that already contains
 * tables unless `--reset` is passed explicitly. In CI the PostgreSQL service
 * container starts empty, so no flags are needed.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(SCRIPT_DIR, "..");
const MIGRATIONS_DIR = join(BACKEND_DIR, "src", "db", "migrations");
const META_DIR = join(MIGRATIONS_DIR, "meta");

/** Tables that must exist after a full migration run (task Phase 1 contract). */
const CORE_TABLES = [
  "tenant_members",
  "user",
  "session",
  "account",
  "verification",
  "content_items",
  "api_keys",
] as const;

/** Table created by the Drizzle migrator to track applied migrations. */
const MIGRATIONS_TABLE = "__drizzle_migrations";

const args = new Set(Bun.argv.slice(2));
const RESET = args.has("--reset");
const SKIP_SCHEMA_DRIFT = args.has("--skip-schema-drift");

let failures = 0;
function ok(message: string): void {
  console.log(`  ✓ ${message}`);
}
function fail(message: string): void {
  failures += 1;
  console.error(`  ✗ ${message}`);
}
function step(title: string): void {
  console.log(`\n== ${title} ==`);
}

function errorAndExit(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

/** Parse + structurally validate the Drizzle journal. Returns journal entries. */
function loadAndValidateJournal() {
  const journalPath = join(META_DIR, "_journal.json");
  if (!existsSync(journalPath)) {
    errorAndExit(`migration journal not found at ${journalPath}`);
  }
  let journal: { entries?: unknown };
  try {
    journal = JSON.parse(readFileSync(journalPath, "utf8"));
  } catch (err) {
    errorAndExit(`cannot parse migration journal: ${err instanceof Error ? err.message : err}`);
  }
  if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
    errorAndExit("migration journal has no entries");
  }

  type Entry = { idx: number; tag: string };
  const entries = journal.entries as Entry[];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (typeof entry.idx !== "number" || typeof entry.tag !== "string") {
      errorAndExit(`journal entry ${i} is malformed (expected { idx, tag })`);
    }
    if (entry.idx !== i) {
      errorAndExit(
        `journal drift: entry ${i} has idx ${entry.idx}; idx must be sequential 0..${entries.length - 1} ` +
          "(re-run `drizzle-kit generate` and commit the regenerated journal)"
      );
    }
    if (Number.parseInt(entry.tag, 10) !== entry.idx) {
      errorAndExit(
        `journal drift: entry ${i} tag "${entry.tag}" does not start with idx ${entry.idx} ` +
          "(expected <idx>_<tag>.sql filename convention)"
      );
    }
    const sqlFile = join(MIGRATIONS_DIR, `${entry.tag}.sql`);
    if (!existsSync(sqlFile)) {
      errorAndExit(`journal drift: ${entry.tag}.sql is missing from src/db/migrations`);
    }
    const snapshotFile = join(META_DIR, `${String(entry.idx).padStart(4, "0")}_snapshot.json`);
    if (!existsSync(snapshotFile)) {
      errorAndExit(
        `journal drift: meta/${String(entry.idx).padStart(4, "0")}_snapshot.json is missing for ${entry.tag}`
      );
    }
  }

  // Every committed SQL migration must be journaled (no orphans).
  const sqlFiles = readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort();
  const journaled = new Set(entries.map((e) => `${e.tag}.sql`));
  for (const name of sqlFiles) {
    if (!journaled.has(name)) {
      errorAndExit(`journal drift: ${name} exists but has no entry in meta/_journal.json`);
    }
  }
  return entries;
}

/** Load a snapshot JSON and return { tableNames, columnsByTable, enums } for `public`. */
function loadSnapshot(idx: number) {
  const snapshot = JSON.parse(
    readFileSync(join(META_DIR, `${String(idx).padStart(4, "0")}_snapshot.json`), "utf8")
  ) as {
    tables?: Record<string, { columns?: Record<string, unknown> }>;
    enums?: Record<string, { values?: string[] }>;
  };
  const tables = snapshot.tables ?? {};
  const stripPublic = (name: string) => name.replace(/^public\./, "");
  return {
    tableNames: new Set(Object.keys(tables).map(stripPublic)),
    columnsByTable: new Map(
      Object.entries(tables).map(([fullName, def]) => [
        stripPublic(fullName),
        new Set(Object.keys(def.columns ?? {})),
      ])
    ),
    enums: Object.fromEntries(
      Object.entries(snapshot.enums ?? {}).map(([fullName, def]) => [
        stripPublic(fullName),
        def.values ?? [],
      ])
    ),
  };
}

/** Compare the live database against the latest committed snapshot. */
async function verifyAgainstSnapshot(
  client: postgres.Sql,
  entries: Array<{ idx: number; tag: string }>
): Promise<void> {
  const latest = entries[entries.length - 1];
  const snapshot = loadSnapshot(latest.idx);
  step(`Drift check: migrated DB vs meta/${latest.idx}_snapshot.json`);

  const dbTables = (
    await client`
		SELECT table_name
		FROM information_schema.tables
		WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
	`
  )
    .map((row: { table_name: string }) => row.table_name)
    .filter((name: string) => name !== MIGRATIONS_TABLE);
  const dbTableSet = new Set(dbTables);

  const missingTables = [...snapshot.tableNames].filter((name) => !dbTableSet.has(name));
  const extraTables = dbTables.filter((name) => !snapshot.tableNames.has(name));
  if (missingTables.length > 0) {
    fail(`migrations produced a DB missing snapshot tables: ${missingTables.join(", ")}`);
  }
  if (extraTables.length > 0) {
    fail(`migrations produced unexpected tables (not in snapshot): ${extraTables.join(", ")}`);
  }
  if (missingTables.length === 0 && extraTables.length === 0) {
    ok(`${snapshot.tableNames.size} tables match the snapshot`);
  }

  // Per-table column sets.
  let columnsChecked = 0;
  let columnsDrifted = 0;
  for (const table of snapshot.tableNames) {
    const expectedColumns = snapshot.columnsByTable.get(table);
    if (!expectedColumns) continue;
    const actualColumns = (
      await client`
			SELECT column_name
			FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name = ${table}
		`
    ).map((row: { column_name: string }) => row.column_name);
    columnsChecked += 1;
    const missingCols = [...expectedColumns].filter((col) => !actualColumns.includes(col));
    const extraCols = actualColumns.filter((col) => !expectedColumns.has(col));
    if (missingCols.length > 0 || extraCols.length > 0) {
      columnsDrifted += 1;
      fail(
        `table "${table}" columns drifted` +
          (missingCols.length > 0 ? `; missing: ${missingCols.join(", ")}` : "") +
          (extraCols.length > 0 ? `; unexpected: ${extraCols.join(", ")}` : "")
      );
    }
  }
  if (columnsChecked > 0 && columnsDrifted === 0)
    ok(`${columnsChecked} tables' columns match the snapshot`);

  // Enum types.
  const dbEnums = new Map<string, string[]>();
  const enumRows = await client`
		SELECT t.typname AS name, e.enumlabel AS label
		FROM pg_type t
		JOIN pg_enum e ON e.enumtypid = t.oid
		JOIN pg_namespace n ON n.oid = t.typnamespace
		WHERE n.nspname = 'public'
		ORDER BY t.typname, e.enumsortorder
	`;
  for (const row of enumRows as Array<{ name: string; label: string }>) {
    if (!dbEnums.has(row.name)) dbEnums.set(row.name, []);
    dbEnums.get(row.name)!.push(row.label);
  }
  const snapshotEnums = Object.entries(snapshot.enums);
  let enumsDrifted = 0;
  for (const [name, values] of snapshotEnums) {
    const actual = dbEnums.get(name);
    if (!actual || JSON.stringify(actual) !== JSON.stringify(values)) {
      enumsDrifted += 1;
      fail(
        `enum "${name}" drifted: snapshot=${JSON.stringify(values)} actual=${JSON.stringify(actual ?? [])}`
      );
    }
  }
  const extraEnums = [...dbEnums.keys()].filter((name) => !(name in snapshot.enums));
  if (extraEnums.length > 0) {
    enumsDrifted += 1;
    fail(`unexpected enum types in DB (not in snapshot): ${extraEnums.join(", ")}`);
  }
  if (snapshotEnums.length > 0 && enumsDrifted === 0) {
    ok(`${snapshotEnums.length} enum types match the snapshot`);
  }
}

/**
 * Verify `src/db/schema.ts` has not drifted from the committed migrations by
 * running `drizzle-kit generate` against a throwaway copy of the migration
 * folder inside `node_modules/.migration-check` (gitignored). The folder is
 * removed afterwards, so nothing unreviewed is left in the repository.
 */
async function verifySchemaDrift(): Promise<void> {
  step("Schema drift check: src/db/schema.ts vs committed migrations (drizzle-kit generate)");

  const drizzleKitEntry = [
    join(BACKEND_DIR, "node_modules", "drizzle-kit"),
    join(BACKEND_DIR, "..", "node_modules", "drizzle-kit"),
  ].find((p) => existsSync(p));
  if (!drizzleKitEntry) {
    console.log("  - drizzle-kit not installed; skipping schema drift check");
    return;
  }

  const tmpDir = join(BACKEND_DIR, "node_modules", ".migration-check");
  const tmpOut = join(tmpDir, "out");
  const tmpMeta = join(tmpOut, "meta");
  const tmpConfig = join(tmpDir, "drizzle.config.ts");
  try {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpMeta, { recursive: true });
    for (const file of readdirSync(META_DIR)) {
      writeFileSync(join(tmpMeta, file), readFileSync(join(META_DIR, file)));
    }
    writeFileSync(
      tmpConfig,
      [
        "import { defineConfig } from 'drizzle-kit';",
        "export default defineConfig({",
        "  dialect: 'postgresql',",
        "  schema: './src/db/schema.ts',",
        "  out: 'node_modules/.migration-check/out',",
        `  dbCredentials: { url: ${JSON.stringify(Bun.env.DATABASE_URL ?? "")} },`,
        "  verbose: true,",
        "  strict: true,",
        "});",
        "",
      ].join("\n")
    );

    const result = Bun.spawnSync(["bunx", "drizzle-kit", "generate", "--config", tmpConfig], {
      cwd: BACKEND_DIR,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = `${result.stdout?.toString() ?? ""}${result.stderr?.toString() ?? ""}`;

    // Anchor on the COMMITTED snapshot count: when drizzle-kit creates a
    // migration it also writes the new snapshot into the temp folder, so a
    // `lastIdx` read from the temp folder would mask the drift.
    const committedLastIdx =
      readdirSync(META_DIR)
        .filter((f) => /^\d+_snapshot\.json$/.test(f))
        .map((f) => Number.parseInt(f, 10))
        .sort((a, b) => a - b)
        .at(-1) ?? -1;
    const newMigration = readdirSync(tmpOut)
      .filter((f) => /^\d+_.*\.sql$/.test(f))
      .map((f) => Number.parseInt(f, 10))
      .some((idx) => idx > committedLastIdx);

    if (newMigration) {
      fail(
        "schema drift: src/db/schema.ts is out of sync with src/db/migrations — " +
          "run `bun run db:generate`, review, and commit the new migration"
      );
    } else if (result.exitCode !== 0) {
      fail(`drizzle-kit generate failed (exit ${result.exitCode}): ${output.trim()}`);
    } else {
      ok("no schema changes detected by drizzle-kit generate");
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  console.log("Migration integrity check (Phase 1)");
  console.log(`migrations: ${MIGRATIONS_DIR}`);

  // 1. Journal integrity (repo-only, no DB required).
  step("Journal integrity");
  const entries = loadAndValidateJournal();
  for (const entry of entries) {
    ok(`${entry.tag}.sql`);
  }

  // 2. Connect to the target database.
  const databaseUrl = Bun.env.DATABASE_URL;
  if (!databaseUrl) {
    errorAndExit(
      "DATABASE_URL is not set. Point it at an EMPTY PostgreSQL database, e.g. " +
        "postgresql://hipost:changeme@localhost:5432/hiai_post_check"
    );
  }
  step("Database connection");
  const client = postgres(databaseUrl, { max: 1, connect_timeout: 10, onnotice: () => {} });
  try {
    await client`SELECT 1`;
    ok("connected");
  } catch (err) {
    errorAndExit(`cannot connect to database: ${err instanceof Error ? err.message : err}`);
  }

  // 3. Emptiness guard: never run migrations over existing data unintentionally.
  step("Database state");
  try {
    if (RESET) {
      console.log("  ! --reset: dropping and recreating the public schema (destructive)");
      // The Drizzle migrator keeps its tracking table in the `drizzle`
      // schema; drop it too or the migrator would skip already-recorded
      // migrations.
      await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
      await client.unsafe("DROP SCHEMA public CASCADE");
      await client.unsafe("CREATE SCHEMA public");
      ok("public schema reset");
    } else {
      const existing = await client`
				SELECT table_name FROM information_schema.tables
				WHERE table_schema IN ('public', 'drizzle') AND table_type = 'BASE TABLE'
			`;
      if (existing.length > 0) {
        errorAndExit(
          `target database is not empty (${existing.length} table(s) found). ` +
            "Point DATABASE_URL at a disposable/empty database, or pass --reset " +
            "(destructive: drops the public schema)."
        );
      }
      ok("database is empty");
    }

    // 4. Apply migrations 0000..current via the Drizzle migrator (production path).
    step("Applying migrations 0000..current");
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
    const applied = (
      await client`
			SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations
		`
    )[0].n as number;
    if (applied !== entries.length) {
      fail(
        `migrator recorded ${applied}/${entries.length} migrations; expected all ${entries.length} ` +
          "(stale drizzle.__drizzle_migrations rows would cause a silent skip)"
      );
    } else {
      ok(
        `${entries.length} migration(s) applied (${entries[0].tag} .. ${entries[entries.length - 1].tag})`
      );
    }

    // 5. Core tables must exist.
    step("Core tables");
    const dbTables = (
      await client`
			SELECT table_name FROM information_schema.tables
			WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
		`
    ).map((row: { table_name: string }) => row.table_name);
    const missingCore = CORE_TABLES.filter((table) => !dbTables.includes(table));
    if (missingCore.length > 0) {
      fail(`missing core tables: ${missingCore.join(", ")}`);
    } else {
      ok(`${CORE_TABLES.join(", ")}`);
    }

    // 6. Drift: DB vs committed snapshot, then schema.ts vs migrations.
    await verifyAgainstSnapshot(client, entries);
    if (!SKIP_SCHEMA_DRIFT) {
      await verifySchemaDrift();
    }
  } finally {
    await client.end({ timeout: 5 });
  }

  console.log(
    "\n" +
      (failures === 0
        ? "PASS: migration integrity check succeeded"
        : `FAIL: ${failures} problem(s) detected`)
  );
  process.exit(failures === 0 ? 0 : 1);
}

await main();
