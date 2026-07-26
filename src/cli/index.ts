#!/usr/bin/env node
import { parseCliArgs } from './args.js';

export { COMMANDS, parseCliArgs } from './args.js';
export type { Command, ParsedArgs } from './args.js';

function main(): void {
  let parsed;
  try {
    parsed = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  switch (parsed.command) {
    case 'report':
      // Plain JSON to stdout for CI — never Ink (SPEC §4).
      process.stdout.write(`${JSON.stringify({ status: 'placeholder', findings: [] })}\n`);
      break;
    case 'daemon':
      console.log('agentconfiging daemon: not implemented yet');
      break;
    case 'launch':
      console.log('agentconfiging: launch UI not implemented yet');
      break;
  }
}

main();
