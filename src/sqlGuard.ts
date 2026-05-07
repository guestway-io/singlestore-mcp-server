import pkg from 'node-sql-parser';
import type { AST } from 'node-sql-parser';

const { Parser } = pkg;

export interface SqlGuardResult {
  ok: boolean;
  reason?: string;
}

const parser = new Parser();

const FORBIDDEN_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'REPLACE',
  'MERGE',
  'CREATE',
  'DROP',
  'ALTER',
  'TRUNCATE',
  'RENAME',
  'GRANT',
  'REVOKE',
  'LOAD',
  'CALL',
  'EXEC',
  'EXECUTE',
  'HANDLER',
  'LOCK',
  'UNLOCK',
  'SET',
  'USE',
  'START',
  'COMMIT',
  'ROLLBACK',
  'SAVEPOINT',
  'INTO OUTFILE',
  'INTO DUMPFILE',
  'FOR UPDATE',
];

/**
 * Verifies a query is a single read-only SELECT (or pure-SELECT WITH/CTE).
 *
 * Strategy:
 *  1. Reject obvious multi-statement input by counting parsed AST nodes.
 *  2. Parse with node-sql-parser in MariaDB dialect (closest to SingleStore).
 *  3. Require the root AST type to be 'select'.
 *  4. As a belt-and-braces measure, run a regex check for keywords
 *     that the parser might miss in vendor-specific syntax.
 */
export function assertReadOnlySelect(rawQuery: string): SqlGuardResult {
  const query = rawQuery?.trim();
  if (!query) return { ok: false, reason: 'Query is empty' };

  if (query.length > 50_000) return { ok: false, reason: 'Query exceeds 50000 chars' };

  const stripped = stripCommentsAndStrings(query);
  const upper = stripped.toUpperCase();

  for (const kw of FORBIDDEN_KEYWORDS) {
    const re = new RegExp(`(^|[^A-Z0-9_])${kw.replace(/ /g, '\\s+')}([^A-Z0-9_]|$)`);
    if (re.test(upper)) {
      return { ok: false, reason: `Forbidden token detected: ${kw}` };
    }
  }

  if (/;\s*\S/.test(stripped)) {
    return { ok: false, reason: 'Multiple statements are not allowed' };
  }

  let ast: AST | AST[];
  try {
    ast = parser.astify(query, { database: 'mariadb' });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `Could not parse SQL: ${reason}` };
  }

  const nodes = Array.isArray(ast) ? ast : [ast];
  if (nodes.length !== 1) {
    return { ok: false, reason: 'Multiple statements are not allowed' };
  }

  const root = nodes[0];
  if (!root || root.type !== 'select') {
    return { ok: false, reason: `Only SELECT queries are allowed (got: ${root?.type ?? 'unknown'})` };
  }

  return { ok: true };
}

function stripCommentsAndStrings(query: string): string {
  let result = '';
  let i = 0;
  const len = query.length;
  while (i < len) {
    const ch = query[i];
    const next = query[i + 1];

    if (ch === '-' && next === '-') {
      const eol = query.indexOf('\n', i);
      i = eol === -1 ? len : eol + 1;
      result += ' ';
      continue;
    }
    if (ch === '/' && next === '*') {
      const close = query.indexOf('*/', i + 2);
      i = close === -1 ? len : close + 2;
      result += ' ';
      continue;
    }
    if (ch === '#') {
      const eol = query.indexOf('\n', i);
      i = eol === -1 ? len : eol + 1;
      result += ' ';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      result += ' ';
      i++;
      while (i < len) {
        const c = query[i];
        if (c === '\\' && i + 1 < len) {
          i += 2;
          continue;
        }
        if (c === quote) {
          i++;
          break;
        }
        i++;
      }
      result += ' ';
      continue;
    }
    result += ch;
    i++;
  }
  return result;
}
