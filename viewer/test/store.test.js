'use strict';

// Lesson store (schema 2) tests. Everything runs in temp directories; the real
// ~/.claude is never touched.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const S = require('../store.js');
const { parseMd } = require('../server.js');

const tmp = () => fs.mkdtempSync(join(tmpdir(), 'st-store-'));

const BODY = `**Problem:** A file saved with a BOM prefixed the first header, so the parser matched zero records.

**Solution:** Strip a leading BOM on read; reading as plain UTF-8 does not remove it.

**Takeaway:** Always strip a leading BOM before line-anchored parsing.
`;

test('frontmatter round-trip preserves every field and the body byte-for-byte', () => {
  const dir = tmp();
  const l = S.createLesson(dir, {
    title: 'Strip the UTF-8 BOM: before parsing #1', date: '2026-06-10',
    stack: ['Encoding', 'parsing', 'node', 'node'], body: BODY, project: 'sync-service', now: '2026-06-10T14:02:11Z',
  });
  const text = fs.readFileSync(join(dir, 'lessons', l.file), 'utf8');
  const back = S.parseLesson(text);
  assert.equal(back.id, l.id);
  assert.equal(back.title, 'Strip the UTF-8 BOM: before parsing #1', 'title with : and # survives quoting');
  assert.deepEqual(back.stack, ['encoding', 'parsing', 'node'], 'lowercased, deduped');
  assert.deepEqual(back.projects, ['sync-service']);
  assert.equal(back.seen, 1);
  assert.equal(back.schema, 2);
  assert.equal(back.created, '2026-06-10T14:02:11Z');
  assert.equal(back.hash, S.bodyHash(BODY));
  assert.equal(back.body, BODY);
  assert.equal(S.serializeLesson(back), text, 'serialize(parse(x)) === x');
  assert.match(l.file, /^2026-06-10-strip-the-utf-8-bom-before-parsing-1--[0-9A-Z]{8}\.md$/);
});

test('ulid: 26 chars, time-sortable, unique across 10k calls, monotonic within a millisecond', () => {
  const ids = Array.from({ length: 10000 }, () => S.ulid());
  assert.ok(ids.every(id => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)));
  assert.equal(new Set(ids).size, ids.length, 'unique');
  const a = S.ulid(1000), b = S.ulid(1000), c = S.ulid(2000);
  assert.ok(a < b && b < c, 'same-ms ids increment; later ms sorts after');
  assert.equal(a.slice(0, 10), b.slice(0, 10), 'same timestamp prefix');
});

test('hand edit sets edited (hash mismatch); a tool write clears it', () => {
  const dir = tmp();
  const l = S.createLesson(dir, { title: 'T', date: '2026-01-01', body: BODY, project: 'p' });
  const file = join(dir, 'lessons', l.file);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Strip a leading BOM', 'Strip a leading BOM carefully'), 'utf8');
  let { lessons } = S.loadStore(dir);
  assert.equal(lessons[0].edited, true);
  // whitespace-only edits are NOT flagged
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('carefully', 'carefully   '), 'utf8');
  assert.equal(S.loadStore(dir).lessons[0].edited, true, 'still edited: content differs from recorded hash');
  const fixed = { ...lessons[0], hash: S.bodyHash(lessons[0].body) };
  S.writeLesson(dir, fixed);
  assert.equal(S.loadStore(dir).lessons[0].edited, false);
});

test('upsertGlobal: id → re-sync (no seen bump); hash → recurrence; title within 7 days → recurrence; projects merge', () => {
  const proj = tmp(), glob = tmp();
  const a = S.createLesson(proj, { title: 'Lock the file', date: '2026-06-10', stack: ['node'], body: BODY, project: 'repo-a', now: '2026-06-10T00:00:00Z' });

  let r = S.upsertGlobal(glob, a);
  assert.equal(r.action, 'created');
  assert.equal(r.lesson.id, a.id, 'global keeps the project id');

  r = S.upsertGlobal(glob, a);
  assert.equal(r.action, 'unchanged', 'plain re-sync of the same lesson');
  assert.equal(S.loadStore(glob).lessons[0].seen, 1, 'no seen bump for re-sync');

  // same content, different id and project → recurrence
  const b = S.createLesson(tmp(), { title: 'Lock the file (again)', date: '2026-07-01', stack: ['locking'], body: BODY, project: 'repo-b', now: '2026-07-01T00:00:00Z' });
  r = S.upsertGlobal(glob, b);
  assert.equal(r.action, 'recurrence');
  let g = S.loadStore(glob).lessons;
  assert.equal(g.length, 1, 'still one lesson');
  assert.equal(g[0].seen, 2);
  assert.deepEqual(g[0].projects.sort(), ['repo-a', 'repo-b']);
  assert.deepEqual(g[0].stack.sort(), ['locking', 'node'], 'stack union');
  assert.equal(g[0].title, 'Lock the file', 'existing title wins on recurrence');

  // same title, different body, 5 days later → recurrence; 30 days later → new lesson
  const c = S.createLesson(tmp(), { title: 'lock the FILE', date: '2026-06-15', body: '**Problem:** reworded\n', project: 'repo-c', now: '2026-06-15T00:00:00Z' });
  assert.equal(S.upsertGlobal(glob, c).action, 'recurrence');
  assert.equal(S.loadStore(glob).lessons[0].seen, 3);
  const d = S.createLesson(tmp(), { title: 'Lock the file', date: '2026-07-20', body: '**Problem:** different\n', project: 'repo-d', now: '2026-07-20T00:00:00Z' });
  assert.equal(S.upsertGlobal(glob, d).action, 'created');
  assert.equal(S.loadStore(glob).lessons.length, 2);

  // same id, newer content → updated in place, no seen bump
  const a2 = { ...a, title: 'Lock every file', body: '**Problem:** rewritten\n', updated: '2026-08-01T00:00:00Z' };
  r = S.upsertGlobal(glob, a2);
  assert.equal(r.action, 'updated');
  g = S.loadStore(glob).lessons.find(l => l.id === a.id);
  assert.equal(g.title, 'Lock every file');
  assert.equal(g.seen, 3);
  assert.equal(fs.readdirSync(join(glob, 'lessons')).filter(f => f.endsWith(`--${a.id.slice(-8)}.md`)).length, 1, 'retitle renames, does not duplicate the file');
});

test('a tombstoned id is never resurrected by upsert', () => {
  const proj = tmp(), glob = tmp();
  const a = S.createLesson(proj, { title: 'Gone', date: '2026-06-10', body: BODY, project: 'repo-a' });
  S.upsertGlobal(glob, a);
  assert.equal(S.deleteLesson(glob, a.id), true);
  assert.equal(S.loadStore(glob).lessons.length, 0);
  assert.deepEqual([...S.readTombstones(glob)], [a.id]);
  assert.equal(S.upsertGlobal(glob, a).action, 'tombstoned');
  assert.equal(S.loadStore(glob).lessons.length, 0);
  assert.equal(S.deleteLesson(glob, 'NOPE'), false, 'deleting a missing id is false, not a throw');
  // the project copy is untouched: deleting globally never reaches into a project
  assert.equal(S.loadStore(proj).lessons.length, 1);
});

test('migrateLegacy: 1:1 entries, dedups like the old entryKey, idempotent, renames (never deletes) the source', () => {
  const home = tmp();
  const md = join(home, 'global-skills.md');
  fs.writeFileSync(md, `﻿# Global Skills Log
<!-- skill-trace-schema: 1 -->

## [2026-06-10] — HTMX partial detection <!-- app-a -->

**Stack:** HTMX, Express

**Problem:** Routes serve both full pages and partials.

**Solution:** Check the hx-request header.

**Takeaway:** Always check req.headers['hx-request'].

## 2026-06-11 — Bare date header <!-- app-b, app-c -->

**Problem:** p

**Takeaway:** t

## [2026-06-10] — HTMX partial detection <!-- app-z -->

**Stack:** HTMX, Express

**Problem:** Routes serve both full pages and partials.

**Solution:** Check the hx-request header.

**Takeaway:** Always check req.headers['hx-request'].
`, 'utf8');
  const dir = join(home, 'skill-trace');
  const r = S.migrateLegacy(md, dir, { now: '2026-10-02T12:00:00Z' });
  assert.equal(r.total, 3);
  assert.equal(r.migrated, 2, 'duplicate content collapsed');
  assert.equal(r.merged, 1);
  assert.ok(fs.existsSync(r.legacyRenamedTo), 'legacy kept under a new name');
  assert.equal(r.legacyRenamedTo, join(home, 'global-skills.legacy-20261002.md'));
  const { lessons, warnings } = S.loadStore(dir);
  assert.deepEqual(warnings, []);
  assert.equal(lessons.length, 2);
  const htmx = lessons.find(l => l.title === 'HTMX partial detection');
  assert.deepEqual(htmx.stack, ['htmx', 'express']);
  assert.deepEqual(htmx.projects.sort(), ['app-a', 'app-z'], 'provenance merged on dedup');
  assert.equal(htmx.seen, 2);
  assert.equal(htmx.created, '2026-06-10T00:00:00Z');
  assert.ok(!htmx.body.includes('**Stack:**'), 'Stack moved to frontmatter, not left in the body');
  assert.equal(lessons.find(l => l.title === 'Bare date header').date, '2026-06-11');
  // the rollup now stands where the legacy file was, and re-running is a no-op
  assert.ok(S.isGenerated(md));
  assert.deepEqual(S.migrateLegacy(md, dir), { migrated: 0, merged: 0, skipped: 'already a generated rollup' });
  assert.equal(S.loadStore(dir).lessons.length, 2);
  assert.deepEqual(S.migrateLegacy(join(home, 'missing.md'), dir), { migrated: 0, merged: 0, skipped: 'no legacy file' });
});

test('rollup parses back through the viewer parser to the same titles, dates, stacks and projects', () => {
  const dir = tmp();
  S.createLesson(dir, { title: 'Alpha', date: '2026-06-10', stack: ['node', 'http'], body: BODY, projects: ['p1', 'p2'] });
  S.createLesson(dir, { title: 'Beta: with colon', date: '2026-06-12', body: '**Problem:** only a problem\n', project: 'p3' });
  const target = join(dir, 'docs', 'skills.md');
  assert.equal(S.regenRollup(dir, target), 2);
  const text = fs.readFileSync(target, 'utf8');
  assert.ok(text.startsWith('<!-- generated by skill-trace'));
  const parsed = parseMd(text);
  assert.deepEqual(parsed.map(e => [e.title, e.date, e.stack, e.projects]), [
    ['Beta: with colon', '2026-06-12', [], ['p3']],
    ['Alpha', '2026-06-10', ['node', 'http'], ['p1', 'p2']],
  ]);
  assert.equal(parsed[1].takeaway, 'Always strip a leading BOM before line-anchored parsing.');
  const index = fs.readFileSync(join(dir, 'index.md'), 'utf8');
  assert.match(index, /^## node \(1\)/m);
  assert.match(index, /\[Alpha\]\(lessons\/2026-06-10-alpha--[0-9A-Z]{8}\.md\)/);
  assert.match(index, /## \(untagged\) \(1\)/);
});

test('an unparsable file is skipped with a warning; the rest of the store still loads', () => {
  const dir = tmp();
  S.createLesson(dir, { title: 'Good', date: '2026-06-10', body: BODY, project: 'p' });
  fs.writeFileSync(join(dir, 'lessons', '2026-06-11-broken--XXXXXXXX.md'), 'no frontmatter here\n', 'utf8');
  fs.writeFileSync(join(dir, 'lessons', 'notes.txt'), 'ignored: not .md\n', 'utf8');
  const { lessons, warnings } = S.loadStore(dir);
  assert.equal(lessons.length, 1);
  assert.equal(lessons[0].title, 'Good');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^2026-06-11-broken--XXXXXXXX\.md: missing frontmatter/);
});

test('storePaths: one constant, env overrides for tests', () => {
  const p = S.storePaths({ home: '/h', projectDir: '/proj' });
  assert.equal(p.global.replace(/\\/g, '/'), '/h/.claude/skill-trace');
  assert.equal(p.project.replace(/\\/g, '/'), '/proj/.claude/skill-trace');
  process.env.SKILL_TRACE_GLOBAL_STORE = '/override';
  assert.equal(S.storePaths({ home: '/h' }).global, '/override');
  delete process.env.SKILL_TRACE_GLOBAL_STORE;
});
