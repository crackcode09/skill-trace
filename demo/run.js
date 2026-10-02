'use strict';
// Launch a throwaway viewer on the fictional demo log, on its own port, so it
// never touches ~/.claude or the real viewer on 38888.
//   npm run demo            -> http://localhost:38890
//   GLOBAL_SKILLS_PORT=38891 npm run demo
//
// The fixture is COPIED into a temp directory first: the server migrates a
// legacy single file into a lesson store on startup (renaming the original), and
// demo/skills-demo.md must stay pristine in the repo.
const { fork } = require('child_process');
const { join } = require('path');
const fs = require('fs');
const os = require('os');

const tmp = fs.mkdtempSync(join(os.tmpdir(), 'skill-trace-demo-'));
fs.copyFileSync(join(__dirname, 'skills-demo.md'), join(tmp, 'global-skills.md'));

const child = fork(join(__dirname, '..', 'viewer', 'server.js'), [], {
  stdio: 'inherit',
  env: {
    ...process.env,
    GLOBAL_SKILLS_MD_PATH: join(tmp, 'global-skills.md'),
    SKILL_TRACE_GLOBAL_STORE: join(tmp, 'skill-trace'),
    GLOBAL_SKILLS_PORT: process.env.GLOBAL_SKILLS_PORT || '38890',
  },
});

function cleanup(code) {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  process.exit(code ?? 0);
}
child.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
