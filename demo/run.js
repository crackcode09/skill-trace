'use strict';
// Launch a throwaway viewer on the fictional demo log, on its own port, so it
// never touches ~/.claude/global-skills.md or the real viewer on 38888.
//   npm run demo            -> http://localhost:38890
//   GLOBAL_SKILLS_PORT=38891 npm run demo
const { fork } = require('child_process');
const { join } = require('path');

const child = fork(join(__dirname, '..', 'viewer', 'server.js'), [], {
  stdio: 'inherit',
  env: {
    ...process.env,
    GLOBAL_SKILLS_MD_PATH: join(__dirname, 'skills-demo.md'),
    GLOBAL_SKILLS_PORT: process.env.GLOBAL_SKILLS_PORT || '38890',
  },
});
child.on('exit', code => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
