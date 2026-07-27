/**
 * cron — a PURE, dependency-free cron parser + next/prev-run computer (SPEC §5
 * row 12, E9 Scheduler, bead agentconfig-ira.4). Cron parsing is a bounded pure
 * algorithm, so it is hand-rolled here (no new dependency). No I/O, no clock of
 * its own — every function is a pure transform over its arguments, which makes
 * the whole surface exhaustively testable and safe to run headless in the daemon.
 *
 * SUPPORTED SYNTAX (the common subset):
 *   - Five whitespace-separated fields: `minute hour day-of-month month day-of-week`.
 *   - Per field: `*` (any), a number, a range `a-b`, a step `* / n` or `a-b/n`,
 *     and comma lists of any of those (`0,15,30,45`).
 *   - Field ranges: minute 0-59, hour 0-23, day-of-month 1-31, month 1-12,
 *     day-of-week 0-6 (0 = Sunday; 7 is also accepted as Sunday).
 *   - Named PRESETS (leading `@` or the friendly `every-*` aliases) expand to a
 *     cron expression before parsing — see {@link PRESETS}.
 *
 * DAY-OF-MONTH vs DAY-OF-WEEK follows the standard Vixie-cron rule: when BOTH are
 * restricted (neither is `*`), a date matches if it matches EITHER field (OR);
 * when only one is restricted, only that one must match.
 */

/** A field's allowed values as a Set plus whether it was the `*` wildcard. */
interface CronField {
  values: Set<number>;
  /** True when the field was `*` (an unrestricted wildcard). Drives the DOM/DOW rule. */
  wildcard: boolean;
}

/** A parsed cron expression: one resolved field per position. */
export interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

/** A parse failure carries a human-readable reason (the field/expression is the user's own). */
export interface CronParseError {
  error: string;
}

/**
 * Named schedule presets. Each expands to a standard five-field cron expression
 * before parsing. Both the canonical `@name` forms and friendly `every-*`
 * aliases are accepted; the set is documented so the UI can offer them.
 */
export const PRESETS: Readonly<Record<string, string>> = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  'every-hour': '0 * * * *',
  'every-day': '0 0 * * *',
  'every-week': '0 0 * * 0',
  'every-month': '0 0 1 * *',
};

interface FieldSpec {
  min: number;
  max: number;
  /** Day-of-week only: 7 is folded to 0 (both are Sunday). */
  wrapSevenToZero?: boolean;
}

const FIELD_SPECS: Record<keyof ParsedCron, FieldSpec> = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  dayOfMonth: { min: 1, max: 31 },
  month: { min: 1, max: 12 },
  dayOfWeek: { min: 0, max: 7, wrapSevenToZero: true },
};

const FIELD_ORDER: (keyof ParsedCron)[] = ['minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek'];

function toInt(token: string): number | undefined {
  if (!/^\d+$/.test(token)) return undefined;
  const n = Number(token);
  return Number.isSafeInteger(n) ? n : undefined;
}

/** Parse ONE comma-separated field into a resolved {@link CronField}, or an error. */
function parseField(raw: string, spec: FieldSpec): CronField | CronParseError {
  const values = new Set<number>();
  let wildcard = false;

  for (const part of raw.split(',')) {
    if (part === '') return { error: `empty term in "${raw}"` };

    // Split off an optional step (`.../n`).
    const [rangePart, stepPart, ...rest] = part.split('/');
    if (rest.length > 0) return { error: `too many "/" in "${part}"` };
    let step = 1;
    if (stepPart !== undefined) {
      const s = toInt(stepPart);
      if (s === undefined || s < 1) return { error: `invalid step in "${part}"` };
      step = s;
    }

    let lo: number;
    let hi: number;
    if (rangePart === '*') {
      lo = spec.min;
      hi = spec.max;
      if (stepPart === undefined) wildcard = true;
    } else if (rangePart !== undefined && rangePart.includes('-')) {
      const [a, b, ...more] = rangePart.split('-');
      if (more.length > 0 || a === undefined || b === undefined) {
        return { error: `invalid range "${rangePart}"` };
      }
      const av = toInt(a);
      const bv = toInt(b);
      if (av === undefined || bv === undefined) return { error: `invalid range "${rangePart}"` };
      lo = av;
      hi = bv;
    } else {
      const v = rangePart === undefined ? undefined : toInt(rangePart);
      if (v === undefined) return { error: `invalid value "${String(rangePart)}"` };
      lo = v;
      hi = v;
    }

    if (lo > hi) return { error: `range start after end in "${part}"` };
    for (let v = lo; v <= hi; v += step) {
      let value = v;
      if (spec.wrapSevenToZero && value === 7) value = 0;
      if (value < spec.min || value > spec.max)
        return { error: `value ${v} out of range in "${part}"` };
      values.add(value);
    }
  }

  if (values.size === 0) return { error: `field "${raw}" matches nothing` };
  return { values, wildcard };
}

function isError(v: CronField | CronParseError): v is CronParseError {
  return (v as CronParseError).error !== undefined;
}

/**
 * Parse a cron expression (or a named preset) into a {@link ParsedCron}, or a
 * {@link CronParseError}. Never throws. Whitespace-tolerant; presets are
 * case-insensitive.
 */
export function parseCron(expression: string): ParsedCron | CronParseError {
  if (typeof expression !== 'string') return { error: 'schedule must be a string' };
  const trimmed = expression.trim();
  if (trimmed === '') return { error: 'schedule is empty' };

  const preset = PRESETS[trimmed.toLowerCase()];
  const source = preset ?? trimmed;

  const fields = source.split(/\s+/);
  if (fields.length !== 5) {
    return { error: `expected 5 fields, got ${fields.length}` };
  }

  const parsed: Partial<Record<keyof ParsedCron, CronField>> = {};
  for (let i = 0; i < FIELD_ORDER.length; i += 1) {
    const key = FIELD_ORDER[i]!;
    const field = parseField(fields[i]!, FIELD_SPECS[key]);
    if (isError(field)) return { error: `${key}: ${field.error}` };
    parsed[key] = field;
  }
  return parsed as ParsedCron;
}

/** True when `expression` parses to a valid cron/preset. */
export function isValidCron(expression: string): boolean {
  return !('error' in parseCron(expression));
}

/** Whether this calendar date's day matches, applying the Vixie DOM-or-DOW rule. */
function dayMatches(parsed: ParsedCron, d: Date): boolean {
  const domOk = parsed.dayOfMonth.values.has(d.getDate());
  const dowOk = parsed.dayOfWeek.values.has(d.getDay());
  const domRestricted = !parsed.dayOfMonth.wildcard;
  const dowRestricted = !parsed.dayOfWeek.wildcard;
  if (domRestricted && dowRestricted) return domOk || dowOk;
  if (domRestricted) return domOk;
  if (dowRestricted) return dowOk;
  return true;
}

/** Whether the given minute (local time) matches every field of `parsed`. */
export function matchesDate(parsed: ParsedCron, d: Date): boolean {
  return (
    parsed.minute.values.has(d.getMinutes()) &&
    parsed.hour.values.has(d.getHours()) &&
    parsed.month.values.has(d.getMonth() + 1) &&
    dayMatches(parsed, d)
  );
}

/** Field-stepping search bound — far more than the ~1825 day-steps a 5-year span needs. */
const MAX_STEPS = 500_000;

/**
 * The next minute STRICTLY AFTER `from` that matches, or `undefined` when no
 * match exists within a bounded horizon (an impossible expression, e.g. Feb 31).
 * Uses local wall-clock time — a daemon runs in the host time zone. Pure.
 */
export function computeNextRun(parsed: ParsedCron, from: Date): Date | undefined {
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);

  for (let i = 0; i < MAX_STEPS; i += 1) {
    if (!parsed.month.values.has(d.getMonth() + 1)) {
      d.setMonth(d.getMonth() + 1, 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(parsed, d)) {
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    if (!parsed.hour.values.has(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!parsed.minute.values.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1, 0, 0);
      continue;
    }
    return d;
  }
  return undefined;
}

/**
 * The latest minute AT OR BEFORE `from` that matches, or `undefined` when none
 * exists within the bounded horizon. The scheduler's due-detection primitive: a
 * schedule is due when its most-recent occurrence is newer than the last run.
 * Local wall-clock time. Pure.
 */
export function computePrevRun(parsed: ParsedCron, from: Date): Date | undefined {
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);

  for (let i = 0; i < MAX_STEPS; i += 1) {
    if (!parsed.month.values.has(d.getMonth() + 1)) {
      // Jump to the last minute of the previous month.
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      d.setMinutes(-1);
      continue;
    }
    if (!dayMatches(parsed, d)) {
      // Jump to the last minute of the previous day.
      d.setHours(0, 0, 0, 0);
      d.setMinutes(-1);
      continue;
    }
    if (!parsed.hour.values.has(d.getHours())) {
      // Previous hour at minute :59.
      d.setHours(d.getHours(), 0, 0, 0);
      d.setMinutes(-1);
      continue;
    }
    if (!parsed.minute.values.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() - 1, 0, 0);
      continue;
    }
    return d;
  }
  return undefined;
}
