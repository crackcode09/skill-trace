'use strict';

// In-process tests for the project → global sync path in store.js: absorbFile,
// projectRoot, projectSlug, syncProject, and the trust gate. All paths are
// redirected to temp dirs via env BEFORE the modules load.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const HOME = fs.mkdtempSync(join(tmpdir(), 'st-sync-home-'));
process.env.SKILL_TRACE_TRUST_PATH   = join(HOME, '.claude', 'skill-trace-trust.txt');
process.env.SKILL_TRACE_SOURCES_PATH = join(HOME, '.claude', 'skill-trace-sources.txt');
process.env.SKILL_TRACE_GLOBAL_STORE = join(HOME, '.claude', 'skill-trace');
process.env.GLOBAL_SKILLS_MD_PATH    = join(HOME, '.claude', 'global-skills.md');
delete process.env.SKILL_TRACE_SOURCE_PATTERN;

const S = require('../store.js');
const T = require('../trust.js');

const GLOBAL = process.env.SKILL_TRACE_GLOBAL_STORE;
const files = dir => fs.existsSync(join(dir, 'lessons')) ? fs.readdirSync(join(dir, 'lessons')).filter(f => f.endsWith('.md')) : [];
const ENTRY = '## [2026-06-11] — Sync test lesson <!-- ignored-prov -->\n\n**Stack:** node\n\n**Problem:** p\n\n**Takeaway:** t\n';

function project(name) {
  const root = join(fs.mkdtempSync(join(tmpdir(), 'st-sync-proj-')), name);
  fs.mkdirSync(join(root, 'docs'), { recursive: true });
  return root;
}

test('projectRoot recognizes docs/skills.md, lesson files, the opt-in pattern, and nothing else', () => {
  assert.deepEqual(S.projectRoot('/w/app/docs/skills.md'), { root: '/w/app', legacyMd: '/w/app/docs/skills.md' });
  assert.deepEqual(S.projectRoot('C:\\w\\app\\docs\\skills.md'), { root: 'C:/w/app', legacyMd: 'C:\\w\\app\\docs\\skills.md' });
  assert.deepEqual(S.projectRoot('/w/app/.claude/skill-trace/lessons/2026-01-01-x--ABCDEFGH.md'), { root: '/w/app' });
  assert.equal(S.projectRoot('/w/app/src/index.js'), null);
  assert.equal(S.projectRoot('/w/app/LESSONS.md'), null, 'custom file ignored unless opted in');
  process.env.SKILL_TRACE_SOURCE_PATTERN = 'LESSONS\\.md$';
  assert.deepEqual(S.projectRoot('/w/app/LESSONS.md'), { root: '/w/app', legacyMd: '/w/app/LESSONS.md' });
  assert.deepEqual(S.projectRoot('/w/app/docs/LESSONS.md').root, '/w/app', 'inside docs/ → parent is the root');
  delete process.env.SKILL_TRACE_SOURCE_PATTERN;
});

test('hook CLI tolerates a UTF-8 BOM on stdin (PowerShell 5.1 pipes one)', () => {
  const { spawnSync } = require('node:child_process');
  const root = project('bom-proj');
  fs.writeFileSync(join(root, 'docs', 'skills.md'), ENTRY, 'utf8');
  const event = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(root, 'docs', 'skills.md') } });
  const r = spawnSync(process.execPath, [join(__dirname, '..', 'store.js'), 'hook'], { input: '﻿' + event, encoding: 'utf8', env: { ...process.env } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /"projectLessons": 1/);
  assert.equal(files(join(root, '.claude', 'skill-trace')).length, 1);
});

test('projectSlug falls back to the folder name outside git', () => {
  const root = project('fallback-name');
  assert.equal(S.projectSlug(root), 'fallback-name');
});

test('syncProject: untrusted → project store + rollup + registry row, nothing global; grant → mirrored; revoke keeps', () => {
  const root = project('alpha');
  fs.writeFileSync(join(root, 'docs', 'skills.md'), ENTRY, 'utf8');

  let r = S.syncProject(root, 'alpha');
  assert.equal(r.trusted, false);
  assert.equal(r.projectLessons, 1);
  assert.equal(r.synced, 0);
  assert.equal(r.absorbed.action, 'migrated');
  const pstore = join(root, '.claude', 'skill-trace');
  assert.equal(files(pstore).length, 1);
  const l = S.loadStore(pstore).lessons[0];
  assert.deepEqual(l.projects, ['ignored-prov'], 'legacy provenance kept on the project copy');
  assert.equal(l.generated_by, 'migration');
  assert.ok(S.isGenerated(join(root, 'docs', 'skills.md')));
  assert.equal(T.parseRegistry().rows.find(x => x.slug === 'alpha').trusted, 'no');
  assert.equal(T.sourcePath('alpha'), root);
  assert.equal(files(GLOBAL).length, 0);

  // grant via the registry (what trust.js does), then sync again
  const rows = T.parseRegistry().rows; rows.find(x => x.slug === 'alpha').trusted = 'yes';
  fs.writeFileSync(T.TRUST_PATH, fs.readFileSync(T.TRUST_PATH, 'utf8').replace('alpha | no', 'alpha | yes'), 'utf8');
  r = S.syncProject(root, 'alpha');
  assert.equal(r.trusted, true);
  assert.equal(r.synced, 1);
  assert.equal(files(GLOBAL).length, 1);
  const g = S.loadStore(GLOBAL).lessons[0];
  assert.equal(g.id, l.id, 'same id in both stores');
  assert.deepEqual(g.projects.sort(), ['alpha', 'ignored-prov'], 'slug added to provenance on the global copy');
  assert.ok(fs.readFileSync(join(HOME, '.claude', 'global-skills.md'), 'utf8').includes('Sync test lesson'));

  // idempotent
  r = S.syncProject(root, 'alpha');
  assert.equal(r.synced, 0, 'unchanged re-sync writes nothing');

  // a second project with the SAME lesson content → recurrence on the global copy
  const root2 = project('beta');
  fs.writeFileSync(join(root2, 'docs', 'skills.md'), ENTRY.replace('Sync test lesson', 'Same lesson, other repo'), 'utf8');
  fs.writeFileSync(T.TRUST_PATH, fs.readFileSync(T.TRUST_PATH, 'utf8') + 'beta | yes | 2026-10-02 | 2026-10-02 | manual\n', 'utf8');
  S.syncProject(root2, 'beta');
  assert.equal(files(GLOBAL).length, 1, 'deduped by content hash');
  const g2 = S.loadStore(GLOBAL).lessons[0];
  assert.equal(g2.seen, 2);
  assert.deepEqual(g2.projects.sort(), ['alpha', 'beta', 'ignored-prov']);
});

test('syncProject: a hand-written entry appended to the project rollup is absorbed; a hand-edited lesson is re-blessed and mirrored (authoritative)', () => {
  const root = project('gamma');
  fs.writeFileSync(T.TRUST_PATH, fs.readFileSync(T.TRUST_PATH, 'utf8') + 'gamma | yes | 2026-10-02 | 2026-10-02 | manual\n', 'utf8');
  fs.writeFileSync(join(root, 'docs', 'skills.md'), ENTRY.replace('Sync test lesson', 'Gamma one'), 'utf8');
  S.syncProject(root, 'gamma');
  const pstore = join(root, '.claude', 'skill-trace');

  // 1. append by hand to the generated rollup
  fs.appendFileSync(join(root, 'docs', 'skills.md'), '\n## [2026-06-12] — Gamma two, typed by hand\n\n**Problem:** p2\n\n**Takeaway:** t2\n', 'utf8');
  let r = S.syncProject(root, 'gamma');
  assert.equal(r.absorbed.action, 'absorbed');
  assert.equal(r.absorbed.added, 1);
  assert.equal(files(pstore).length, 2);
  assert.equal(S.loadStore(pstore).lessons.find(l => l.title.startsWith('Gamma two')).generated_by, 'hook');
  assert.equal((fs.readFileSync(join(root, 'docs', 'skills.md'), 'utf8').match(/^## \[/gm) || []).length, 2, 'rollup regenerated with both');

  // 2. edit a lesson file by hand (body + title), no timestamp bump
  const f = join(pstore, 'lessons', files(pstore).find(x => x.includes('gamma-one')));
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('title: Gamma one', 'title: Gamma one, revised').replace('**Takeaway:** t', '**Takeaway:** t revised'), 'utf8');
  assert.equal(S.loadStore(pstore).lessons.find(l => l.title.startsWith('Gamma one')).edited, true, 'hash mismatch detected');
  r = S.syncProject(root, 'gamma');
  const p = S.loadStore(pstore).lessons.find(l => l.title.startsWith('Gamma one'));
  assert.equal(p.edited, false, 're-blessed: hash refreshed');
  const g = S.loadStore(GLOBAL).lessons.find(l => l.id === p.id);
  assert.equal(g.title, 'Gamma one, revised', 'project copy is authoritative for its own lessons');
  assert.match(g.body, /t revised/);
});

test('syncProject never clobbers a hand-written global file: it is migrated first', () => {
  // fresh global for this case
  const home2 = fs.mkdtempSync(join(tmpdir(), 'st-sync-home2-'));
  const prevG = process.env.SKILL_TRACE_GLOBAL_STORE, prevM = process.env.GLOBAL_SKILLS_MD_PATH;
  // storePaths reads env at call time, so swapping here is enough
  process.env.SKILL_TRACE_GLOBAL_STORE = join(home2, '.claude', 'skill-trace');
  process.env.GLOBAL_SKILLS_MD_PATH = join(home2, '.claude', 'global-skills.md');
  fs.mkdirSync(join(home2, '.claude'), { recursive: true });
  fs.writeFileSync(process.env.GLOBAL_SKILLS_MD_PATH, '## [2026-05-01] — Old global lesson <!-- elsewhere -->\n\n**Problem:** old\n', 'utf8');
  const root = project('delta');
  fs.writeFileSync(T.TRUST_PATH, fs.readFileSync(T.TRUST_PATH, 'utf8') + 'delta | yes | 2026-10-02 | 2026-10-02 | manual\n', 'utf8');
  fs.writeFileSync(join(root, 'docs', 'skills.md'), ENTRY.replace('Sync test lesson', 'Delta lesson'), 'utf8');
  S.syncProject(root, 'delta');
  const g = S.loadStore(process.env.SKILL_TRACE_GLOBAL_STORE).lessons.map(l => l.title).sort();
  assert.deepEqual(g, ['Delta lesson', 'Old global lesson'], 'old global entry migrated, new one mirrored');
  assert.ok(fs.readdirSync(join(home2, '.claude')).some(f => f.startsWith('global-skills.legacy-')));
  process.env.SKILL_TRACE_GLOBAL_STORE = prevG; process.env.GLOBAL_SKILLS_MD_PATH = prevM;
});
