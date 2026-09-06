import process from 'node:process';
import { URL } from 'node:url';

const PROFILE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function scheduledMode(date = new Date()) {
  if (date.getUTCDate() === 1) return 'monthly';
  if (date.getUTCDay() === 1) return 'weekly';
  return 'daily';
}

export function makePlan({ event = 'schedule', mode, agent = 'all', source = '' } = {}) {
  const selectedMode = mode || (event === 'schedule' ? scheduledMode() : 'weekly');
  if (!['daily', 'weekly', 'monthly'].includes(selectedMode)) throw new Error('invalid mode');
  if (agent !== 'all' && !PROFILE_ID.test(agent)) throw new Error('invalid agent id');
  if (source && !SOURCE_ID.test(source)) throw new Error('invalid source id');
  if (source && agent === 'all') throw new Error('source requires one explicit agent');
  return { mode: selectedMode, agent, source, fullAudit: agent === 'all' && source === '' };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    process.stdout.write(
      `${JSON.stringify(
        makePlan({
          event: process.env.GITHUB_EVENT_NAME,
          mode: process.env.REFRESH_MODE,
          agent: process.env.REFRESH_AGENT || 'all',
          source: process.env.REFRESH_SOURCE || '',
        }),
      )}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 64;
  }
}
