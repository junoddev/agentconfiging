import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import console from 'node:console';

const incidents = new Map([
  ['agentconfig-gxo.3', 1],
  ['agentconfig-0zm.4', 1],
  ['agentconfig-gxo.1', 1],
  ['agentconfig-np8.7', 1],
  ['upstream-port ReDoS', 1],
  ['agentconfig-0zm.7', 9],
]);
const files = [
  'src/server/security.test.ts',
  'src/server/catalog.test.ts',
  'src/cli/launch.test.ts',
  'src/core/history/claude.test.ts',
  'src/core/registry/client.test.ts',
];
const selector = [...incidents.keys()]
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
const work = mkdtempSync(join(tmpdir(), 'agentconfig-security-'));
const report = join(work, 'vitest.json');

try {
  const run = spawnSync(
    process.execPath,
    [
      'node_modules/vitest/vitest.mjs',
      'run',
      ...files,
      '--testNamePattern',
      selector,
      '--reporter=json',
      `--outputFile=${report}`,
    ],
    { stdio: 'inherit' },
  );
  if (run.error) throw run.error;
  if (run.status !== 0) process.exit(run.status ?? 1);

  const json = JSON.parse(readFileSync(report, 'utf8'));
  const executed = json.testResults.flatMap((suite) =>
    suite.assertionResults.filter((test) => test.status === 'passed').map((test) => test.fullName),
  );
  const errors = [];
  let expectedTotal = 0;
  for (const [incident, expected] of incidents) {
    const actual = executed.filter((name) => name.includes(incident)).length;
    expectedTotal += expected;
    if (actual !== expected) errors.push(`${incident}: expected ${expected}, executed ${actual}`);
  }
  if (executed.length !== expectedTotal) {
    errors.push(`total: expected ${expectedTotal}, executed ${executed.length}`);
  }
  if (errors.length > 0) {
    console.error(
      `Security gate manifest mismatch:\n${errors.map((line) => `- ${line}`).join('\n')}`,
    );
    process.exit(1);
  }
  console.log(`Security gate passed: ${expectedTotal} named adversarial cases executed.`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
