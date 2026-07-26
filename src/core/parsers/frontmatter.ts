/**
 * YAML frontmatter extraction for markdown-family config files.
 *
 * Real-world frontmatter is not always strict YAML — Cursor writes bare
 * comma-separated globs (`globs: *.tsx,src/components/**`) which is invalid
 * YAML (alias syntax). When strict parsing fails, a lenient line-wise
 * `key: value` scan salvages what it can and the failure is reported as a
 * problem instead of being thrown. Duplicate keys keep the last value and
 * are reported. Oversized or pathologically nested input is not parsed.
 */

import { parseDocument } from 'yaml';
import {
  capProblems,
  problem,
  problemFromError,
  scrubMessage,
  type ParseProblem,
} from './result.js';
import {
  flowNestingTooDeep,
  inputSizeProblem,
  isRecord,
  sanitize,
  type SafeRecord,
} from './values.js';

export interface Frontmatter {
  /** True when the content opened with a `---` frontmatter fence. */
  hasFrontmatter: boolean;
  /** Null-prototype record of frontmatter keys; empty when there is none. */
  data: SafeRecord;
  /** Content after the frontmatter block (the whole input when none). */
  body: string;
  problems: ParseProblem[];
}

const OPEN_FENCE = /^---[ \t]*$/;
const CLOSE_FENCE = /^(?:---|\.\.\.)[ \t]*$/;

/** Split and parse YAML frontmatter. Never throws. */
export function parseFrontmatter(content: string): Frontmatter {
  const problems: ParseProblem[] = [];
  const emptyData: SafeRecord = Object.create(null) as SafeRecord;

  const sizeProblem = inputSizeProblem(content);
  if (sizeProblem) {
    return { hasFrontmatter: false, data: emptyData, body: '', problems: [sizeProblem] };
  }

  // Strip a leading BOM (charcode 0xFEFF) so it cannot hide the opening fence.
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  const lines = content.split('\n');
  const firstLine = lines[0] ?? '';

  if (!OPEN_FENCE.test(firstLine.replace(/\r$/, ''))) {
    return { hasFrontmatter: false, data: emptyData, body: content, problems };
  }

  let closeIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (CLOSE_FENCE.test((lines[i] ?? '').replace(/\r$/, ''))) {
      closeIndex = i;
      break;
    }
  }

  let yamlSource: string;
  let body: string;
  if (closeIndex === -1) {
    problems.push(problem('frontmatter', 'unterminated frontmatter block (no closing ---)'));
    yamlSource = lines.slice(1).join('\n');
    body = '';
  } else {
    yamlSource = lines.slice(1, closeIndex).join('\n');
    body = lines.slice(closeIndex + 1).join('\n');
  }

  const data = parseFrontmatterYaml(yamlSource, problems);
  return { hasFrontmatter: true, data, body, problems: capProblems(problems) };
}

function parseFrontmatterYaml(source: string, problems: ParseProblem[]): SafeRecord {
  const out: SafeRecord = Object.create(null) as SafeRecord;

  // The yaml library's error recovery on pathological bracket nesting is
  // super-linear; skip straight to the lenient scan for such input.
  if (flowNestingTooDeep(source)) {
    problems.push(problem('frontmatter', 'pathological bracket nesting; strict parse skipped'));
    mergeLenient(out, source, problems);
    return out;
  }

  let strictValue: unknown;
  let strictFailed = false;

  try {
    const doc = parseDocument(source, { strict: false, uniqueKeys: true });
    for (const err of doc.errors) {
      // Duplicate keys are report-only: last value wins, the mapping is
      // still usable, and the lenient fallback must not kick in for them.
      if (err.code !== 'DUPLICATE_KEY') strictFailed = true;
      const line = err.linePos?.[0]?.line;
      problems.push(
        problem(
          line === undefined ? 'frontmatter' : `frontmatter (line ${line})`,
          scrubMessage(err.message.split('\n', 1)[0] ?? err.message),
        ),
      );
    }
    strictValue = doc.toJS({ maxAliasCount: 100 });
  } catch (error) {
    strictFailed = true;
    problems.push(problemFromError('frontmatter', error));
  }

  if (strictValue !== undefined && strictValue !== null) {
    if (isRecord(strictValue)) {
      const sanitized = sanitize(strictValue);
      problems.push(...sanitized.problems.map((p) => problem('frontmatter', p.message)));
      for (const [k, v] of Object.entries(sanitized.value as SafeRecord)) {
        if (v !== undefined) out[k] = v;
      }
    } else {
      strictFailed = true;
      problems.push(problem('frontmatter', 'expected a YAML mapping'));
    }
  }

  if (strictFailed) mergeLenient(out, source, problems);
  return out;
}

/** Merge lenient line-scan results into `out` for keys strict parsing lost. */
function mergeLenient(out: SafeRecord, source: string, problems: ParseProblem[]): void {
  let added = 0;
  for (const [k, v] of lenientScan(source)) {
    if (!(k in out) || out[k] === undefined) {
      out[k] = v;
      added += 1;
    }
  }
  if (added > 0) {
    problems.push(problem('frontmatter', `not strict YAML; salvaged ${added} key(s) line-wise`));
  }
}

/**
 * Line-wise `key: value` salvage for frontmatter that is not strict YAML.
 * Values stay strings except bare true/false; quotes are stripped.
 */
function lenientScan(source: string): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [];
  for (const rawLine of source.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const match = /^([A-Za-z0-9_][A-Za-z0-9_-]*):[ \t]?(.*)$/.exec(line);
    if (!match || match[1] === undefined) continue;
    const key = match[1];
    let value: unknown = (match[2] ?? '').trim();
    if (typeof value === 'string') {
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      } else if (value === 'true') value = true;
      else if (value === 'false') value = false;
    }
    entries.push([key, value]);
  }
  return entries;
}
