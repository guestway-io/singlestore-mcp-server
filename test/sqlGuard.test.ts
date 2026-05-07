import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertReadOnlySelect } from '../src/sqlGuard.js';

describe('assertReadOnlySelect', () => {
  it('accepts a plain SELECT', () => {
    const r = assertReadOnlySelect('SELECT 1');
    assert.equal(r.ok, true);
  });

  it('accepts SELECT with WHERE', () => {
    const r = assertReadOnlySelect('SELECT id, name FROM users WHERE id = 1');
    assert.equal(r.ok, true);
  });

  it('accepts a CTE that ends in SELECT', () => {
    const r = assertReadOnlySelect('WITH x AS (SELECT 1 AS v) SELECT * FROM x');
    assert.equal(r.ok, true);
  });

  it('rejects a stacked DROP TABLE', () => {
    const r = assertReadOnlySelect('SELECT 1; DROP TABLE foo');
    assert.equal(r.ok, false);
  });

  it('rejects a comment-cloaked DELETE', () => {
    const r = assertReadOnlySelect('SELECT 1 /* harmless */; DELETE FROM foo');
    assert.equal(r.ok, false);
  });

  it('rejects an INSERT', () => {
    const r = assertReadOnlySelect('INSERT INTO foo (id) VALUES (1)');
    assert.equal(r.ok, false);
  });

  it('rejects an UPDATE', () => {
    const r = assertReadOnlySelect('UPDATE foo SET x = 1');
    assert.equal(r.ok, false);
  });

  it('rejects DDL', () => {
    const r = assertReadOnlySelect('CREATE TABLE foo (id INT)');
    assert.equal(r.ok, false);
  });

  it('rejects SET', () => {
    const r = assertReadOnlySelect('SET autocommit = 0');
    assert.equal(r.ok, false);
  });

  it('rejects a CTE that contains DELETE', () => {
    const r = assertReadOnlySelect('WITH d AS (DELETE FROM foo RETURNING *) SELECT * FROM d');
    assert.equal(r.ok, false);
  });

  it('rejects empty input', () => {
    const r = assertReadOnlySelect('');
    assert.equal(r.ok, false);
  });

  it('rejects SELECT INTO OUTFILE', () => {
    const r = assertReadOnlySelect("SELECT * FROM foo INTO OUTFILE '/tmp/x'");
    assert.equal(r.ok, false);
  });

  it('rejects FOR UPDATE', () => {
    const r = assertReadOnlySelect('SELECT * FROM foo WHERE id = 1 FOR UPDATE');
    assert.equal(r.ok, false);
  });

  it('does not get fooled by a SELECT that contains DROP inside a string literal', () => {
    const r = assertReadOnlySelect("SELECT 'DROP TABLE foo' AS msg");
    assert.equal(r.ok, true);
  });
});
