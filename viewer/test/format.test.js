'use strict';

// Parser / dedup / schema-marker tests. Run against a temp MD file via the
// GLOBAL_SKILLS_MD_PATH override so the real ~/.claude log is never touched.

const { test } = require('node:test');
const assert = require('node:assert');
const { writeFileSync, mkdtempSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const MD = join(mkdtempSync(join(tmpdir(), 'st-fmt-')), 'global-skills.md');
process.env.GLOBAL_SKILLS_MD_PATH = MD;
process.env.SKILL_TRACE_GLOBAL_STORE = join(mkdtempSync(join(tmpdir(), 'st-fmt-store-')), 'skill-trace');

const { parseMd, readSchemaVersion, sync, searchSkills } = require('../server.js');
const { bodyHash } = require('../store.js');

test('parseMd extracts title, date, sections, provenance', () => {
  const [e] = parseMd(
`# Global Skills Log
<!-- skill-trace-schema: 1 -->

## [2026-06-10] — CORS pitfall <!-- repo-a -->

**Problem:** P here.

**Solution:** S here.

**Takeaway:** T here.
`);
  assert.equal(e.title, 'CORS pitfall');
  assert.equal(e.date, '2026-06-10');
  assert.deepEqual(e.projects, ['repo-a']);
  assert.match(e.problem, /P here/);
  assert.match(e.solution, /S here/);
  assert.match(e.takeaway, /T here/);
});

test('merged provenance splits into multiple projects (merged-tag filter)', () => {
  const [e] = parseMd('## [2026-06-10] — Shared <!-- repo-a, repo-b -->\n\n**Problem:** x\n');
  assert.deepEqual(e.projects, ['repo-a', 'repo-b']);
});

test('bare (unbracketed) date header still parses', () => {
  const [e] = parseMd('## 2026-06-10 — No brackets <!-- repo-a -->\n\n**Problem:** x\n');
  assert.equal(e.date, '2026-06-10');
  assert.equal(e.title, 'No brackets');
});

test('parseMd strips a leading UTF-8 BOM so the first entry still parses', () => {
  // An externally-edited skills.md can carry a BOM; without stripping it the
  // first '## ' header never matches and the file parses to zero entries.
  const bom = String.fromCharCode(0xFEFF);
  const entries = parseMd(bom + '## [2026-06-10] — BOM entry <!-- repo-a -->\n\n**Problem:** x\n');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, 'BOM entry');
});

test('parseMd extracts **Stack:** tags as a lowercased array; absent => []', () => {
  const [withStack] = parseMd('## [2026-06-10] — Tagged <!-- repo-a -->\n\n**Stack:** Node, Concurrency , locking\n\n**Problem:** x\n');
  assert.deepEqual(withStack.stack, ['node', 'concurrency', 'locking']);
  const [noStack] = parseMd('## [2026-06-10] — Untagged <!-- repo-a -->\n\n**Problem:** x\n');
  assert.deepEqual(noStack.stack, []);
});

test('schema marker: missing => v1; explicit value read', () => {
  assert.equal(readSchemaVersion('# no marker here'), 1);
  assert.equal(readSchemaVersion('<!-- skill-trace-schema: 2 -->'), 2);
});

test('lesson identity is the body hash: whitespace and provenance do not change it', () => {
  assert.equal(bodyHash('**Problem:** same body\n'), bodyHash('  **Problem:** same body  \n\n'));
  assert.notEqual(bodyHash('**Problem:** same body\n'), bodyHash('**Problem:** other body\n'));
});

test('a legacy file with duplicate content migrates to one lesson with merged provenance', () => {
  writeFileSync(MD,
`# Global Skills Log
<!-- skill-trace-schema: 1 -->

## [2026-06-10] — Dup <!-- repo-a -->

**Problem:** identical body

## [2026-06-10] — Dup <!-- repo-b -->

**Problem:** identical body
`, 'utf8');
  sync(); // first sync migrates the legacy file into the store, deduping by body hash
  const all = searchSkills('', '');
  assert.equal(all.length, 1);
  assert.deepEqual(all[0].projects.slice().sort(), ['repo-a', 'repo-b']);
});

test('searchSkills matches project slugs and Stack tags, not only title/body', () => {
  writeFileSync(process.env.GLOBAL_SKILLS_MD_PATH, `<!-- skill-trace-schema: 1 -->

## [2026-06-10] — Alpha <!-- sync-service -->

**Stack:** node, encoding

**Problem:** body one

## [2026-06-11] — Beta <!-- inventory-portal -->

**Problem:** body two
`, 'utf8');
  sync();
  assert.deepEqual(searchSkills('sync-service', '').map(s => s.title), ['Alpha'], 'project slug');
  assert.deepEqual(searchSkills('ENCODING', '').map(s => s.title), ['Alpha'], 'stack tag, case-insensitive');
  assert.deepEqual(searchSkills('body two', '').map(s => s.title), ['Beta'], 'body text');
  assert.deepEqual(searchSkills('nope', ''), [], 'no false positives');
});
