// Shared PostgREST miniature for tests that exercise the REAL Supabase
// repository (the rest of the suite runs on the in-memory fake, which
// has no response cap and no scan-order instability, so it cannot
// express the defects these tests pin).
//
// Faithful semantics modelled:
//  • every response is capped at 1000 rows unless the query pages
//    with .range() (the cap that silently truncated attachItems and
//    the unpaged review/coupon lists);
//  • `count: 'exact'` reports the FILTERED row count;
//  • rows that tie on every ORDER BY key (and entire results without
//    an ORDER BY) have NO guaranteed relative order — successive
//    queries may serve ties rotated. A caller paging on a total order
//    (unique tiebreak) is immune; a caller paging on created_at alone,
//    or not ordering at all, duplicates/skips rows exactly as it
//    could against real Postgres.
//  • a non-UUID literal compared against a uuid column fails with
//    22P02 BEFORE any row logic (the sentinel id 'not-a-uuid') —
//    the repository's malformed-id translation keys on this code.
//  • insert/upsert run against registered unique constraints: a
//    duplicate non-null value fails with 23505 (the orders
//    idempotency index, coupons.code, newsletter email — see
//    migrations 0001/0006). `id` itself is the primary key, so an
//    insert colliding on it also fails with 23505.
//  • columns registered as "missing" (a migration has not run)
//    behave as PostgREST reports them: filtering/selecting one
//    fails with 42703, sending one in an insert/update payload
//    fails with PGRST204 — the two signals the repository's
//    degradation retries key on.
//  • .single() / .maybeSingle() follow postgrest-js: single with
//    ≠1 rows and maybeSingle with >1 rows fail with PGRST116;
//    maybeSingle with 0 rows is data:null, no error.
//  • beforeInsert hooks run just before an insert executes, so a
//    test can commit a "concurrent winner" row into the tables and
//    let the unique check fire naturally (the 23505 race), or force
//    an insert error (the compensating-cleanup path).

export type Row = Record<string, unknown>;
export type StubError = { code: string; message: string };
type StubResult = { data: unknown; error: StubError | null; count: number | null };

const CAP = 1000;
const PGRST116: StubError = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' };

export interface StubSupabase {
  tables: Map<string, Row[]>;
  createClient: () => unknown;
  reset: () => void;
  seed: (table: string, rows: Row[]) => void;
  addUnique: (table: string, column: string) => void;
  setMissingColumns: (table: string, columns: string[]) => void;
  beforeInsert: (table: string, hook: (tables: Map<string, Row[]>, rows: Row[]) => StubError | null) => void;
  seedAuthUsers: (users: { id: string; email?: string }[]) => void;
}

export function createStubSupabase(): StubSupabase {
  const tables = new Map<string, Row[]>();
  const querySeq = new Map<string, number>();
  const uniques = new Map<string, Set<string>>();
  const missing = new Map<string, Set<string>>();
  const insertHooks = new Map<string, ((tables: Map<string, Row[]>, rows: Row[]) => StubError | null)[]>();
  let authUsers: { id: string; email?: string }[] = [];
  let idSeq = 0;
  let clockSeq = 0;

  const nextTimestamp = () => new Date(Date.UTC(2026, 0, 1) + ++clockSeq * 1000).toISOString();

  function resolveSingular(rows: Row[], mode: 'single' | 'maybeSingle' | null): StubResult {
    if (!mode) return { data: rows, error: null, count: null };
    if (rows.length === 1) return { data: rows[0], error: null, count: null };
    if (rows.length === 0 && mode === 'maybeSingle') return { data: null, error: null, count: null };
    return { data: null, error: PGRST116, count: null };
  }

  class StubQuery {
    private filters: ((r: Row) => boolean)[] = [];
    private eqValues: unknown[] = [];
    private filterCols: string[] = [];
    private orders: { col: string; asc: boolean }[] = [];
    private rangeSlice: [number, number] | null = null;
    private limitN: number | null = null;
    private singleMode: 'single' | 'maybeSingle' | null = null;
    private cols: string | null = null;
    private wantCount = false;
    private op: 'select' | 'update' | 'delete' | 'insert' | 'upsert' = 'select';
    private patch: Row = {};
    private insertRows: Row[] = [];
    private conflictCol: string | null = null;
    private returnCols: string | null = null;

    constructor(private table: string) {}

    select(cols: string, opts?: { count?: string }) {
      // After update()/delete()/insert()/upsert(), .select() names the
      // RETURNING columns.
      if (this.op === 'select') {
        this.cols = cols;
        this.wantCount = opts?.count === 'exact';
      } else {
        this.returnCols = cols;
      }
      return this;
    }
    insert(rows: Row | Row[]) { this.op = 'insert'; this.insertRows = Array.isArray(rows) ? rows : [rows]; return this; }
    upsert(row: Row, opts?: { onConflict?: string }) {
      this.op = 'upsert'; this.insertRows = [row]; this.conflictCol = opts?.onConflict ?? 'id'; return this;
    }
    update(patch: Row) { this.op = 'update'; this.patch = patch; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(col: string, v: unknown) { this.filters.push((r) => r[col] === v); this.eqValues.push(v); this.filterCols.push(col); return this; }
    neq(col: string, v: unknown) { this.filters.push((r) => r[col] !== v); this.filterCols.push(col); return this; }
    in(col: string, vs: unknown[]) { const s = new Set(vs); this.filters.push((r) => s.has(r[col])); this.filterCols.push(col); return this; }
    gte(col: string, v: unknown) {
      this.filters.push((r) => (r[col] as string | number) >= (v as string | number));
      this.filterCols.push(col);
      return this;
    }
    order(col: string, opts?: { ascending?: boolean }) { this.orders.push({ col, asc: opts?.ascending !== false }); return this; }
    range(from: number, to: number) { this.rangeSlice = [from, to]; return this; }
    limit(n: number) { this.limitN = n; return this; }
    maybeSingle() { this.singleMode = 'maybeSingle'; return this; }
    single() { this.singleMode = 'single'; return this; }

    then<TResult1 = StubResult, TResult2 = never>(
      onfulfilled?: ((value: StubResult) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
    }

    private execute(): StubResult {
      const seq = (querySeq.get(this.table) ?? 0) + 1;
      querySeq.set(this.table, seq);
      const missingCols = missing.get(this.table) ?? new Set<string>();
      // Column existence is resolved before row logic (Postgres parse
      // analysis): a missing column fails the whole statement.
      const payloadCols = this.op === 'update' ? Object.keys(this.patch)
        : (this.op === 'insert' || this.op === 'upsert') ? this.insertRows.flatMap((r) => Object.keys(r))
        : [];
      const payloadMissing = payloadCols.find((c) => missingCols.has(c));
      if (payloadMissing) {
        return {
          data: null, count: null,
          error: { code: 'PGRST204', message: `Could not find the '${payloadMissing}' column of '${this.table}' in the schema cache` },
        };
      }
      const selectCols = this.cols && this.cols !== '*' ? this.cols.split(',').map((c) => c.trim()) : [];
      const referencedMissing = [...this.filterCols, ...selectCols].find((c) => missingCols.has(c));
      if (referencedMissing) {
        return {
          data: null, count: null,
          error: { code: '42703', message: `column ${this.table}.${referencedMissing} does not exist` },
        };
      }
      // Postgres rejects a non-UUID literal compared against a uuid
      // column with 22P02 — BEFORE any row logic. The repository's
      // malformed-id translation (fix 8) keys on exactly this code;
      // without it, the calls below would throw like the old code.
      if (this.eqValues.some((v) => v === 'not-a-uuid')) {
        return { data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid: "not-a-uuid"' }, count: null };
      }

      if (this.op === 'insert' || this.op === 'upsert') return this.executeWrite();
      const tableRows = tables.get(this.table) ?? [];
      const matched = tableRows.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === 'update') {
        // A unique column written by the patch may not collide with a
        // row OUTSIDE the matched set (the coupon-rename 23505).
        const uniqueCols = uniques.get(this.table) ?? new Set<string>();
        for (const col of uniqueCols) {
          if (!(col in this.patch)) continue;
          const value = this.patch[col];
          if (value === null || value === undefined) continue;
          if (tableRows.some((r) => !matched.includes(r) && r[col] === value)) {
            return {
              data: null, count: null,
              error: { code: '23505', message: `duplicate key value violates unique constraint "${this.table}_${col}_key"` },
            };
          }
        }
        for (const r of matched) Object.assign(r, this.patch);
        const out = matched.map((r) => this.projectWith(this.returnCols, r));
        if (this.singleMode) return resolveSingular(out, this.singleMode);
        return { data: this.returnCols ? out : null, error: null, count: null };
      }
      if (this.op === 'delete') {
        tables.set(this.table, tableRows.filter((r) => !matched.includes(r)));
        const out = matched.map((r) => this.projectWith(this.returnCols, r));
        if (this.singleMode) return resolveSingular(out, this.singleMode);
        return { data: this.returnCols ? out : null, error: null, count: null };
      }
      let rows = matched;
      const total = rows.length;
      rows = this.applyOrder(rows, seq);
      if (this.singleMode) {
        return resolveSingular(rows.map((r) => this.project(r)), this.singleMode);
      }
      if (this.rangeSlice) {
        const [from, to] = this.rangeSlice;
        rows = rows.slice(from, from + Math.min(to - from + 1, CAP));
      } else if (this.limitN != null) {
        rows = rows.slice(0, this.limitN);
      } else {
        rows = rows.slice(0, CAP); // PostgREST max-rows on an unbounded response
      }
      const projected = rows.map((r) => this.project(r));
      return { data: projected, error: null, count: this.wantCount ? total : null };
    }

    private executeWrite(): StubResult {
      // Hooks first: a concurrent transaction may commit (or the
      // write may be forced to fail) before this statement lands —
      // the table is read only afterwards, so hook-seeded rows are
      // visible to the unique checks below.
      for (const hook of insertHooks.get(this.table) ?? []) {
        const err = hook(tables, this.insertRows);
        if (err) return { data: null, error: err, count: null };
      }
      const tableRows = tables.get(this.table) ?? [];
      // Validate BEFORE mutating: a constraint violation aborts the
      // whole statement in Postgres — no partial rows land.
      const planned: { row: Row; conflictTarget: Row | null }[] = [];
      for (const payload of this.insertRows) {
        const row: Row = { ...payload };
        let conflictTarget: Row | null = null;
        if (this.op === 'upsert' && this.conflictCol) {
          conflictTarget = tableRows.find((r) => r[this.conflictCol as string] === row[this.conflictCol as string]) ?? null;
        }
        if (!conflictTarget) {
          // Unique constraints (registered + the id primary key). NULL
          // values never conflict, as in Postgres.
          const uniqueCols = new Set([...(uniques.get(this.table) ?? []), 'id']);
          for (const col of uniqueCols) {
            if (this.op === 'upsert' && col === this.conflictCol) continue;
            const value = row[col];
            if (value === null || value === undefined) continue;
            const clash = tableRows.some((r) => r[col] === value) ||
              planned.some((p) => !p.conflictTarget && p.row[col] === value);
            if (clash) {
              return {
                data: null, count: null,
                error: { code: '23505', message: `duplicate key value violates unique constraint "${this.table}_${col}_key"` },
              };
            }
          }
        }
        planned.push({ row, conflictTarget });
      }
      const stored: Row[] = [];
      for (const { row, conflictTarget } of planned) {
        if (conflictTarget) {
          // ON CONFLICT DO UPDATE touches only the sent columns.
          Object.assign(conflictTarget, row);
          stored.push(conflictTarget);
          continue;
        }
        // Column defaults from migration 0001 that inserts rely on
        // the RETURNING row carrying (profiles.role, reservations.status).
        const COLUMN_DEFAULTS: Record<string, Row> = {
          profiles: { role: 'customer' },
          reservations: { status: 'pending' },
        };
        for (const [col, value] of Object.entries(COLUMN_DEFAULTS[this.table] ?? {})) {
          if (row[col] === undefined) row[col] = value;
        }
        // Database defaults the repository relies on: a generated id
        // and creation timestamps.
        if (row.id === undefined || row.id === null) row.id = `stub-${this.table}-${++idSeq}`;
        if (row.created_at === undefined) row.created_at = nextTimestamp();
        if (row.updated_at === undefined && this.table === 'orders') row.updated_at = row.created_at;
        tableRows.push(row);
        stored.push(row);
      }
      tables.set(this.table, tableRows);
      const out = stored.map((r) => this.projectWith(this.returnCols, r));
      if (this.singleMode) return resolveSingular(out, this.singleMode);
      return { data: this.returnCols ? out : null, error: null, count: null };
    }

    private applyOrder(rows: Row[], seq: number): Row[] {
      const keys = this.orders;
      const sorted = [...rows].sort((a, b) => {
        for (const { col, asc } of keys) {
          const av = a[col] as string | number;
          const bv = b[col] as string | number;
          if (av === bv) continue;
          const cmp = av < bv ? -1 : 1;
          return asc ? cmp : -cmp;
        }
        return 0;
      });
      // Rotate each tie group by the query sequence number: ties have
      // no stable order across queries unless a unique key breaks them.
      const out: Row[] = [];
      let i = 0;
      while (i < sorted.length) {
        let j = i + 1;
        while (j < sorted.length && keys.every(({ col }) => sorted[j][col] === sorted[i][col])) j++;
        const group = sorted.slice(i, j);
        if (group.length > 1) {
          const shift = seq % group.length;
          out.push(...group.slice(shift), ...group.slice(0, shift));
        } else {
          out.push(...group);
        }
        i = j;
      }
      return out;
    }

    private project(r: Row): Row {
      return this.projectWith(this.cols, r);
    }

    private projectWith(cols: string | null, r: Row): Row {
      if (!cols || cols === '*') return { ...r };
      const keep = cols.split(',').map((c) => c.trim());
      const out: Row = {};
      for (const k of keep) out[k] = r[k];
      return out;
    }
  }

  const client = {
    from: (table: string) => new StubQuery(table),
    auth: {
      admin: {
        listUsers: async (opts?: { page?: number; perPage?: number }) => {
          const page = opts?.page ?? 1;
          const perPage = opts?.perPage ?? authUsers.length;
          const start = (page - 1) * perPage;
          return { data: { users: authUsers.slice(start, start + perPage) }, error: null };
        },
      },
    },
  };

  return {
    tables,
    createClient: () => client,
    reset() {
      tables.clear(); querySeq.clear(); uniques.clear(); missing.clear(); insertHooks.clear();
      authUsers = []; idSeq = 0; clockSeq = 0;
    },
    seed(table: string, rows: Row[]) { tables.set(table, rows); },
    addUnique(table: string, column: string) {
      const set = uniques.get(table) ?? new Set<string>();
      set.add(column);
      uniques.set(table, set);
    },
    setMissingColumns(table: string, columns: string[]) { missing.set(table, new Set(columns)); },
    beforeInsert(table: string, hook) {
      const list = insertHooks.get(table) ?? [];
      list.push(hook);
      insertHooks.set(table, list);
    },
    seedAuthUsers(users) { authUsers = users; },
  };
}

/** The singleton both repository test files mock `@supabase/supabase-js` to. */
export const stubSupabase: StubSupabase = createStubSupabase();
