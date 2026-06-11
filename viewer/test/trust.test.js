'use strict';

// Trust-model tests, including the attack simulation: a hostile source is recorded
// but stays inert (non-injectable) until an explicit grant. This test failing is
// the only acceptable way the injection gate ever changes.

const { test } = require('node:test');
const assert = require('node:assert');
const { writeFileSync, readFileSync, mkdtempSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');

const REG = join(mkdtempSync(join(tmpdir(), 'st-trust-')), 'skill-trace-trust.txt');
process.env.SKILL_TRACE_TRUST_PATH = REG;

const trust = require('../trust.js');
const CLI = join(__dirname, '..', 'trust.js');

// Write rows the way the sync hook would (always trusted=no).
function seed(rows) {
  writeFileSync(REG,
    '# columns: project-slug | trusted(yes|no) | first-seen | granted-at | granted-by\n' +
    rows.join('\n') + '\n', 'utf8');
}

test('ATTACK SIM: untrusted source is recorded but NOT injectable', () => {
  seed(['evil-repo | no | 2026-06-10 |  | ']);
  assert.ok(!trust.trustedSlugs().includes('evil-repo'));
  assert.equal(trust.isTrusted('evil-repo'), false);
});

test('grant flips no->yes with command audit trail; others stay denied', () => {
  seed(['evil-repo | no | 2026-06-10 |  | ', 'my-repo | no | 2026-06-10 |  | ']);
  execFileSync(process.execPath, [CLI, 'grant', 'my-repo'],
    { env: { ...process.env, SKILL_TRACE_TRUST_PATH: REG } });
  const slugs = trust.trustedSlugs();
  assert.ok(slugs.includes('my-repo'), 'granted source is injectable');
  assert.ok(!slugs.includes('evil-repo'), 'ungranted source stays denied');
  assert.match(readFileSync(REG, 'utf8'), /my-repo \| yes \|.*\| command\s*$/m);
});

test('revoke flips yes->no and clears the grant audit fields', () => {
  seed(['my-repo | yes | 2026-06-10 | 2026-06-10 | command']);
  execFileSync(process.execPath, [CLI, 'revoke', 'my-repo'],
    { env: { ...process.env, SKILL_TRACE_TRUST_PATH: REG } });
  assert.deepEqual(trust.trustedSlugs(), []);
});

test('trustedSlugs reads ONLY the registry — never any file content', () => {
  seed(['x | no | 2026-06-10 |  | ']);
  assert.deepEqual(trust.trustedSlugs(), []);
});
