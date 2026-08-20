/**
 * In-memory fake for the drizzle `db` object, used by service unit tests and
 * HTTP integration tests to exercise tenant-scoped queries without a real
 * database.
 *
 * Supports the chain shapes the product-foundation services and the auth /
 * tenant / rbac middleware use:
 *   select([proj]).from(t).where(pred)[.orderBy(...)].limit(n)[.offset(m)]
 *   select([proj]).from(t).where(pred).groupBy(col)
 *   select([proj]).from(t).where(pred)            (thenable — resolves rows)
 *   insert(t).values(v).returning()
 *   update(t).set(s).where(pred).returning()
 *   delete(t).where(pred).returning([proj])
 *   transaction(fn)                    → fn(db)  (tx === db)
 *
 * `where` predicates are decoded via the compiled SQL queryChunks: raw text
 * before each bound `{ value }` is scanned for the last `"table"."column"`
 * reference, mapped back to the camelCase row key through the table
 * definition. Rows are stored with camelCase keys (what `values()` /
 * `returning()` use in Drizzle).
 */
import { createHash } from "node:crypto";

type Row = Record<string, any>;

export interface FakeDb {
  _tables: Record<string, Row[]>;
  _snapshot: () => Record<string, Row[]>;
  select: (projection?: unknown) => {
    from: (table: unknown) => { where: (p: unknown) => WhereStep };
  };
  insert: (table: unknown) => { values: (v: Row) => { returning: () => Promise<Row[]> } };
  update: (table: unknown) => {
    set: (s: Row) => { where: (p: unknown) => { returning: () => Promise<Row[]> } };
  };
  delete: (table: unknown) => {
    where: (p: unknown) => { returning: (proj?: unknown) => Promise<Row[]> };
  };
  transaction: (fn: (tx: FakeDb) => Promise<any>) => Promise<any>;
}

export interface WhereStep {
  orderBy: (...args: unknown[]) => {
    limit: (n: number) => { offset: (m: number) => Promise<Row[]> };
  };
  groupBy: (...cols: unknown[]) => Promise<Row[]>;
  limit: (n: number) => Promise<Row[]>;
  then: (resolve: (v: Row[]) => void, reject?: (e: unknown) => void) => Promise<Row[]>;
}

function tableName(table: unknown): string {
  const name = (table as any)?.[Symbol.for("drizzle:Name")];
  return typeof name === "string" ? name : "unknown";
}

/** snake_case DB column name → camelCase row key, from the table definition. */
function columnMap(table: unknown): Record<string, string> {
  const map: Record<string, string> = {};
  for (const key of Object.keys(table as Record<string, unknown>)) {
    const col = (table as any)[key];
    if (col && typeof col === "object" && typeof col.name === "string") {
      map[col.name] = key;
    }
  }
  return map;
}

/**
 * Extract `column = value` pairs from a drizzle where predicate by walking
 * the compiled SQL queryChunks (nested for `and(...)`). Chunk shapes
 * (drizzle-orm 0.45): raw SQL text chunks carry `{ value: string[] }`,
 * bound parameters carry `{ value: <primitive> }`, and column references
 * appear as the column object itself (has `.name` + `.tableName`). A bound
 * param is paired with the last column seen before it.
 */
function extractEquals(predicate: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const sql =
    typeof (predicate as any)?.getSQL === "function" ? (predicate as any).getSQL() : predicate;
  let lastColumn: string | null = null;

  const walk = (list: unknown[]) => {
    for (const c of list) {
      if (c === null || c === undefined) continue;
      if (typeof c === "object" && Array.isArray((c as any).queryChunks)) {
        walk((c as any).queryChunks);
        continue;
      }
      if (typeof c === "object" && "value" in (c as Record<string, unknown>)) {
        const value = (c as { value: unknown }).value;
        if (Array.isArray(value)) continue; // raw SQL text fragment
        // Bound parameter — pair with the last column reference seen.
        if (lastColumn) {
          out[lastColumn] = value;
          lastColumn = null;
        }
        continue;
      }
      if (
        typeof c === "object" &&
        typeof (c as any).name === "string" &&
        typeof (c as any).dataType === "string"
      ) {
        lastColumn = (c as any).name;
      }
    }
  };
  walk((sql as any)?.queryChunks ?? []);
  return out;
}

/** Apply DB-level defaults a service relies on (status, timestamps, id). */
function applyDefaults(table: unknown, v: Row): Row {
  const row = { ...v };
  for (const key of Object.keys(table as Record<string, unknown>)) {
    const col = (table as any)[key];
    if (!col || typeof col !== "object" || typeof col.name !== "string") continue;
    if (row[key] !== undefined) continue;
    if (!col.hasDefault) continue;
    const def = col.default;
    if (typeof def === "string" || typeof def === "number" || typeof def === "boolean") {
      row[key] = def;
    } else if (col.name === "created_at" || col.name === "updated_at") {
      row[key] = new Date();
    }
  }
  return row;
}

function matches(row: Row, equals: Record<string, unknown>, map: Record<string, string>): boolean {
  return Object.entries(equals).every(([snake, value]) => row[map[snake] ?? snake] === value);
}

function filterRows(
  tables: Record<string, Row[]>,
  name: string,
  table: unknown,
  predicate: unknown
): Row[] {
  const map = columnMap(table);
  const equals = extractEquals(predicate);
  return (tables[name] ?? []).filter((r) => matches(r, equals, map));
}

function sortRows(rows: Row[]): Row[] {
  const copy = [...rows];
  if (copy.length === 0) return copy;
  if ("revisionNumber" in copy[0]) {
    return copy.sort((a, b) => (b.revisionNumber ?? 0) - (a.revisionNumber ?? 0));
  }
  if ("updatedAt" in copy[0]) {
    return copy.sort(
      (a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
    );
  }
  if ("createdAt" in copy[0]) {
    return copy.sort(
      (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
    );
  }
  return copy.reverse();
}

function isColumn(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as any).name === "string" &&
    typeof (value as any).dataType === "string"
  );
}

function isCountProjection(projection: any): boolean {
  return (
    projection &&
    typeof projection === "object" &&
    Object.keys(projection).length === 1 &&
    "total" in projection &&
    !isColumn(projection.total)
  );
}

function isGroupProjection(projection: any): boolean {
  return (
    projection &&
    typeof projection === "object" &&
    "total" in projection &&
    !isColumn(projection.total) &&
    Object.keys(projection).some((k) => k !== "total" && isColumn(projection[k]))
  );
}

function isColumnProjection(projection: any): boolean {
  return (
    projection &&
    typeof projection === "object" &&
    Object.keys(projection).length > 0 &&
    Object.values(projection).every(isColumn)
  );
}

function projectRows(table: unknown, projection: unknown, rows: Row[]): Row[] {
  if (isGroupProjection(projection)) return rows; // handled by groupBy step
  if (isCountProjection(projection)) return [{ total: rows.length }];
  if (isColumnProjection(projection)) {
    const map = columnMap(table);
    const proj = projection as Record<string, any>;
    return rows.map((r) => {
      const out: Row = {};
      for (const key of Object.keys(proj)) {
        const col = proj[key];
        out[key] = r[map[col.name] ?? col.name];
      }
      return out;
    });
  }
  return rows.map((r) => ({ ...r }));
}

function deterministicId(seed: string): string {
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function makeFakeDb(initial: Record<string, Row[]> = {}): FakeDb {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(initial)) {
    tables[name] = rows.map((r) => ({ ...r }));
  }

  const queryFrom = (name: string, table: unknown, projection: unknown, predicate: unknown) => {
    const filtered = (): Row[] => filterRows(tables, name, table, predicate);
    const project = (rows: Row[]): Row[] => projectRows(table, projection, rows);

    const step: WhereStep = {
      orderBy: () => {
        const ordered = {
          limit: (n: number) => ({
            offset: async (m: number) => project(sortRows(filtered()).slice(m, m + n)),
          }),
          // Drizzle select builders are thenable after .orderBy() too.
          then: (resolve: (v: Row[]) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(project(sortRows(filtered()))).then(resolve, reject) as Promise<Row[]>,
        };
        return ordered;
      },
      groupBy: async (...cols: unknown[]): Promise<Row[]> => {
        const groupCol = cols[0] && isColumn(cols[0]) ? (cols[0] as any).name : null;
        const map = columnMap(table);
        const key = groupCol ? (map[groupCol] ?? groupCol) : null;
        const grouped = new Map<string, Row[]>();
        for (const r of filtered()) {
          const k = key ? String(r[key] ?? "unknown") : "all";
          if (!grouped.has(k)) grouped.set(k, []);
          grouped.get(k)!.push(r);
        }
        return [...grouped.entries()].map(([k, group]) => ({ status: k, total: group.length }));
      },
      limit: async (n: number): Promise<Row[]> => project(sortRows(filtered()).slice(0, n)),
      then: (resolve, reject) =>
        Promise.resolve(project(filtered())).then(resolve, reject) as unknown as Promise<Row[]>,
    };
    return step;
  };

  const db: FakeDb = {
    _tables: tables,
    _snapshot: () => {
      const out: Record<string, Row[]> = {};
      for (const [k, v] of Object.entries(tables)) out[k] = v.map((r) => ({ ...r }));
      return out;
    },
    select: (projection?: unknown) => ({
      from: (table: unknown) => ({
        where: (predicate: unknown) => queryFrom(tableName(table), table, projection, predicate),
      }),
    }),
    insert: (table: unknown) => {
      const doInsert = (v: Row): Row[] => {
        const name = tableName(table);
        const row: Row = applyDefaults(table, v);
        if (!row.id) {
          row.id = deterministicId(`${name}:${JSON.stringify(v)}:${tables[name]?.length ?? 0}`);
        }
        if (!(name in tables)) tables[name] = [];
        tables[name].push(row);
        return [{ ...row }];
      };
      return {
        values: (v: Row) => ({
          // Drizzle insert builders are thenable — `await insert().values()` executes.
          returning: async (): Promise<Row[]> => doInsert(v),
          then: (resolve: (v: Row[]) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(doInsert(v)).then(resolve, reject) as Promise<Row[]>,
        }),
      };
    },
    update: (table: unknown) => {
      const doUpdate = (s: Row, predicate: unknown): Row[] => {
        const name = tableName(table);
        const updated: Row[] = [];
        for (const r of filterRows(tables, name, table, predicate)) {
          Object.assign(r, s);
          updated.push({ ...r });
        }
        return updated;
      };
      return {
        set: (s: Row) => ({
          where: (predicate: unknown) => ({
            returning: async (): Promise<Row[]> => doUpdate(s, predicate),
            then: (resolve: (v: Row[]) => unknown, reject?: (e: unknown) => unknown) =>
              Promise.resolve(doUpdate(s, predicate)).then(resolve, reject) as Promise<Row[]>,
          }),
        }),
      };
    },
    delete: (table: unknown) => ({
      where: (predicate: unknown) => ({
        returning: async (proj?: unknown): Promise<Row[]> => {
          const name = tableName(table);
          const toDelete = new Set(filterRows(tables, name, table, predicate));
          const deleted: Row[] = [];
          tables[name] = (tables[name] ?? []).filter((r) => {
            if (toDelete.has(r)) {
              deleted.push({ ...r });
              return false;
            }
            return true;
          });
          return projectRows(table, proj ?? {}, deleted);
        },
      }),
    }),
    transaction: async (fn: (tx: FakeDb) => Promise<any>) => fn(db),
  };
  return db;
}
