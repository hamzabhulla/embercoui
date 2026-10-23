import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Migration 0016 — profile authority-column guard (mega-audit blocker
// B1). There is no live Postgres in this suite, so the migration's
// SHAPE is pinned here exactly the way src/lib/geo.test.ts pins
// index.html: read the shipped .sql and assert the statements that
// close the hole are present, correctly targeted and idempotent.
// If anyone edits the migration, these pins are the tripwire.
//
// The hole: profiles.permissions (0012) and profiles.mfa_required
// (0013) were writable by any signed-in user through PostgREST —
// 0001's own-row UPDATE policy restricts rows, not columns, and only
// `role` ever got 0001's column revoke + guard trigger. 0016 mirrors
// that treatment for the two authority columns.
// (The backend compiles to CommonJS, so the path is resolved from
// __dirname rather than import.meta.url.)
const migrationPath = join(__dirname, '../../supabase/migrations/0016_profile_authority_guard.sql');
const raw = readFileSync(migrationPath, 'utf8');
// Assertions run on the executable SQL only: the header comment
// legitimately DISCUSSES grants, revokes and other columns, and must
// not trip the negative pins below.
const sql = raw
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');
const lower = sql.toLowerCase();
// Audit follow-up: the pins below also need INLINE comments gone —
// mutation M5b replaced the raise with `return new` and left the
// raise text in a trailing `--` comment, which the full-line filter
// above does not remove. stripInlineComments cuts `--` to end-of-line
// only OUTSIDE single-quoted literals (a '' pair inside one is an
// escaped quote, not its end), so a literal containing `--` would
// survive intact and no executable text can hide in a comment.
function stripInlineComments(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "'") {
        if (text[i + 1] === "'") {
          out += text[i + 1];
          i += 1;
        } else {
          inString = false;
        }
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '-' && text[i + 1] === '-') {
      while (i < text.length && text[i] !== '\n') i += 1;
      if (i < text.length) out += '\n';
      continue;
    }
    out += ch;
  }
  return out;
}
const execSql = stripInlineComments(sql);
const normalisedExec = execSql.replace(/\s+/g, ' ');
const firingCondition =
  'new.permissions is distinct from old.permissions or new.mfa_required is distinct from old.mfa_required';
const raiseStatement =
  "raise exception 'Only an admin can change profile permissions or the two-factor requirement';";

describe('migration 0016 — profile authority guard', () => {
  it('revokes UPDATE on exactly the two authority columns from anon and authenticated', () => {
    expect(sql).toContain(
      'revoke update (permissions, mfa_required) on public.profiles from anon, authenticated;',
    );
  });

  it('grants and revokes nothing at table level, so other profile columns stay writable as before', () => {
    // A table-level revoke would break full_name/phone/addresses/
    // favorites self-service; the fix is column-level only, mirroring
    // 0001's `revoke update (role)`.
    expect(lower).not.toContain('revoke update on public.profiles');
    expect(lower).not.toMatch(/revoke[^;]*\b(full_name|phone|addresses|favorites)\b/);
    expect(lower).not.toContain('grant');
  });

  it('installs a BEFORE UPDATE guard function (create-or-replace, security definer)', () => {
    expect(sql).toContain('create or replace function public.guard_profile_authority()');
    expect(sql).toContain('security definer');
    expect(sql).toContain('drop trigger if exists profiles_guard_authority on public.profiles;');
    expect(sql).toContain('create trigger profiles_guard_authority before update on public.profiles');
  });

  it('the guard fires when EITHER authority column changes', () => {
    expect(sql).toContain('new.permissions is distinct from old.permissions');
    expect(sql).toContain('new.mfa_required is distinct from old.mfa_required');
  });

  it('the guard mirrors guard_profile_role\'s caller branches: service role / direct DB pass, admin profiles pass, everyone else raises', () => {
    expect(sql).toContain("if coalesce(auth.role(), '') not in ('anon', 'authenticated') then");
    expect(sql).toContain("exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')");
    expect(sql).toContain(
      "raise exception 'Only an admin can change profile permissions or the two-factor requirement';",
    );
  });

  it('leaves the original role guard alone — it is a sibling, not a replacement', () => {
    expect(lower).not.toContain('drop trigger if exists profiles_guard_role');
    expect(lower).not.toContain('create or replace function public.guard_profile_role');
  });

  it('is idempotent and refreshes the PostgREST schema cache, like 0012–0015', () => {
    // Re-running must be safe: revoke is naturally idempotent, the
    // function is create-or-replace, the trigger is dropped first.
    expect(sql).toContain('create or replace function');
    expect(sql).toContain('drop trigger if exists');
    expect(sql).toContain("notify pgrst, 'reload schema';");
  });

  it('changes no data and creates no schema objects beyond the guard', () => {
    expect(lower).not.toMatch(/\b(insert into|update public|delete from|alter table|create table)\b/);
  });

  it('pins the full firing condition as ONE OR statement, so or→and cannot slip through (audit M2)', () => {
    // The existing either-column test pins each half separately; an
    // `and` between them would still pass it while letting a
    // single-column self-grant through. Pin the joined condition.
    expect(normalisedExec).toContain(`if ${firingCondition} then`);
    expect(normalisedExec).not.toContain(
      'new.permissions is distinct from old.permissions and new.mfa_required is distinct from old.mfa_required',
    );
  });

  it('pins the trigger EXECUTE clause to guard_profile_authority, not the role guard (audit M3)', () => {
    expect(normalisedExec).toContain('execute function public.guard_profile_authority()');
    expect(normalisedExec).not.toContain('execute function public.guard_profile_role()');
  });

  it('pins guard-body structure: the firing condition precedes the raise and no return precedes it (audit M4)', () => {
    // An early `return new;` at the top of the body would neuter the
    // guard while leaving every statement pin above intact. The two
    // legitimate branch returns (and the final one) all come AFTER
    // the firing condition, and the raise comes after it too.
    const bodyStart = normalisedExec.indexOf('create or replace function public.guard_profile_authority()');
    const bodyEnd = normalisedExec.indexOf('end $$;', bodyStart);
    expect(bodyStart).toBeGreaterThanOrEqual(0);
    expect(bodyEnd).toBeGreaterThan(bodyStart);
    const body = normalisedExec.slice(bodyStart, bodyEnd);
    const conditionIdx = body.indexOf(firingCondition);
    const raiseIdx = body.indexOf(raiseStatement);
    const firstReturnIdx = body.indexOf('return new;');
    expect(conditionIdx).toBeGreaterThanOrEqual(0);
    expect(raiseIdx).toBeGreaterThan(conditionIdx);
    expect(firstReturnIdx).toBeGreaterThan(conditionIdx);
  });

  it('pins the raise as executable code in the inline-comment-stripped SQL, not comment text (audit M5b)', () => {
    expect(execSql).toContain(raiseStatement);
    expect(normalisedExec).toContain(raiseStatement);
  });
});
