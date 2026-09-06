/**
 * Agent config quality / bloat score.
 *
 * Pure, deterministic scoring over AnalyzerInput only: no filesystem, env, or
 * network reads. The serialized QualityScore is content-free (numbers, ids,
 * counts, and paths only); analyzer-only issue evidence also avoids raw file
 * bodies so adversarial instructions and secrets do not leak into reports.
 */

import { dirPrefix } from './detectors/shared.js';
import type { ManifestFile } from './manifest.js';
import { createFenceFilter } from './parsers/index.js';
import type { AnalyzerInput } from './report.js';
import { estimateTokens, estimateTokensFromSizeBytes } from './token-estimate.js';

export type QualityComponentId =
  'token-efficiency' | 'position-risk' | 'clarity' | 'contradictions';

export interface QualityComponentScore {
  id: QualityComponentId;
  score: number;
  penalty: number;
}

export interface QualityMetrics {
  totalTokens: number;
  guideCount: number;
  directiveCount: number;
  criticalRuleCount: number;
  buriedCriticalRuleCount: number;
  contradictionCount: number;
}

export interface AgentConfigQuality {
  /** 0-100, higher is healthier. */
  score: number;
  components: QualityComponentScore[];
  metrics: QualityMetrics;
}

export type QualityIssueKind =
  'low-score' | 'token-bloat' | 'buried-critical-rule' | 'unclear-content' | 'contradiction';

export interface QualityIssue {
  kind: QualityIssueKind;
  component: QualityComponentId;
  id: string;
  severity: 'error' | 'warning' | 'info';
  agent: string;
  path?: string;
  line?: number;
  otherPath?: string;
  otherLine?: number;
  subject?: string;
}

export interface QualityAssessment {
  quality: AgentConfigQuality;
  issues: QualityIssue[];
}

interface QualityDocument {
  path: string;
  agent: string;
  body: string;
  tokens: number;
  lineCount: number;
  headingCount: number;
  directives: DirectiveLine[];
  criticalRules: DirectiveLine[];
}

interface DirectiveLine {
  text: string;
  line: number;
}

interface PolicyClaim {
  subject: string;
  value: string;
  path: string;
  line: number;
  agent: string;
  directive: string;
}

const ROOT_GUIDES = new Set([
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
  'COPILOT.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
]);

const DIRECTIVE_PATTERN = /^\s*(?:[-*+]|\d+[.)])\s+(.+?)\s*$/;
const HEADING_PATTERN = /^\s*#{1,6}\s+(.+?)\s*$/;
const CALLOUT_PATTERN =
  /^(?:important|critical|warning|security|hard rule|required|rule|note)\b\s*[:.-]/i;
const CRITICAL_PROSE_PATTERN = /^(?:must|never|always|required|do not|don't|must not)\b/i;
const VAGUE_PATTERN =
  /\b(?:use best judgment|be careful|do the right thing|as needed|etc\.?|stuff|things|make it good|handle appropriately|obvious(?:ly)?|clean it up)\b/i;
const CRITICAL_PATTERN =
  /\b(?:must|never|always|required|critical|security|secret|credential|token|approval|permission|forbidden|prohibited|do not|don't|must not|commit|push|delete|rm\s+-rf|reset\s+--hard)\b/i;

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function agentForPath(path: string): string {
  if (path === 'CLAUDE.md' || path.startsWith('.claude/')) return 'claude-code';
  if (path === 'AGENTS.md' || path.startsWith('.codex/')) return 'codex';
  if (path === 'GEMINI.md' || path.startsWith('.gemini/')) return 'gemini-cli';
  if (path === '.cursorrules' || path.startsWith('.cursor/')) return 'cursor';
  if (path.startsWith('.github/')) return 'copilot';
  return 'multi';
}

function scopedCopilotInstructions(path: string): boolean {
  return path.startsWith('.github/instructions/') && path.endsWith('.instructions.md');
}

function contextCandidate(path: string, claudePrefix: string): boolean {
  if (ROOT_GUIDES.has(path)) return true;
  if (scopedCopilotInstructions(path)) return true;
  if (path === '.mcp.json') return true;
  if (path.startsWith('.cursor/rules/') && path.endsWith('.mdc')) return true;
  if (path === `${claudePrefix}settings.json` || path === `${claudePrefix}settings.local.json`) {
    return true;
  }
  return (
    (path.startsWith(`${claudePrefix}rules/`) && path.endsWith('.md')) ||
    path.startsWith(`${claudePrefix}memory/`) ||
    path.startsWith(`${claudePrefix}skills/`) ||
    (path.startsWith(`${claudePrefix}agents/`) && path.endsWith('.md')) ||
    (path.startsWith(`${claudePrefix}commands/`) && path.endsWith('.md'))
  );
}

function fileTokens(file: ManifestFile): number {
  if (typeof file.content === 'string') return estimateTokens(file.content);
  return estimateTokensFromSizeBytes(file.size);
}

function normalizeDirectiveText(text: string): string | undefined {
  const normalized = text
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!]+$/, '')
    .trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizedProseCallout(line: string): string | undefined {
  const prose = line.trim().replace(/^>\s*/, '').replace(/\*\*/g, '').trim();
  if (!CALLOUT_PATTERN.test(prose) && !CRITICAL_PROSE_PATTERN.test(prose)) return undefined;
  if (!CRITICAL_PATTERN.test(prose)) return undefined;
  return normalizeDirectiveText(prose);
}

function normalizedDirective(line: string): string | undefined {
  const directive = DIRECTIVE_PATTERN.exec(line)?.[1] ?? HEADING_PATTERN.exec(line)?.[1];
  if (directive !== undefined) return normalizeDirectiveText(directive);
  return normalizedProseCallout(line);
}

function analyzeBody(path: string, body: string): QualityDocument {
  const skipLine = createFenceFilter();
  const directives: DirectiveLine[] = [];
  const criticalRules: DirectiveLine[] = [];
  let headingCount = 0;
  const lines = body.split('\n');
  lines.forEach((line, i) => {
    if (skipLine(line)) return;
    if (HEADING_PATTERN.test(line)) headingCount += 1;
    const directive = normalizedDirective(line);
    if (directive === undefined) return;
    const entry = { text: directive, line: i + 1 };
    directives.push(entry);
    if (CRITICAL_PATTERN.test(directive)) criticalRules.push(entry);
  });
  return {
    path,
    agent: agentForPath(path),
    body,
    tokens: estimateTokens(body),
    lineCount: lines.length,
    headingCount,
    directives,
    criticalRules,
  };
}

function collectDocuments(input: AnalyzerInput): QualityDocument[] {
  const byPath = new Map<string, QualityDocument>();
  const add = (path: string, body: string) => byPath.set(path, analyzeBody(path, body));

  for (const guide of input.parsed.guides) add(guide.path, guide.model.body);
  for (const rule of input.parsed.rules) add(rule.path, rule.model.body);
  for (const rule of input.parsed.cursorRules) add(rule.path, rule.model.body);
  for (const subagent of input.parsed.subagents) add(subagent.path, subagent.model.body);
  for (const skill of input.parsed.skills) add(skill.path, skill.model.body);
  for (const command of input.parsed.commands) add(command.path, command.model.body);

  return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function totalContextTokens(input: AnalyzerInput, docs: readonly QualityDocument[]): number {
  const claudePrefix = dirPrefix(input.manifest, '.claude');
  const seenDocs = new Set(docs.map((d) => d.path));
  let total = docs.reduce((sum, doc) => sum + doc.tokens, 0);
  for (const file of input.manifest.files) {
    if (seenDocs.has(file.path)) continue;
    if (!contextCandidate(file.path, claudePrefix)) continue;
    total += fileTokens(file);
  }
  return total;
}

function tokenComponent(
  totalTokens: number,
  docs: readonly QualityDocument[],
): QualityComponentScore {
  const directiveTokens = docs.reduce(
    (sum, doc) => sum + doc.directives.reduce((s, d) => s + estimateTokens(d.text), 0),
    0,
  );
  const ratio = totalTokens === 0 ? 1 : directiveTokens / totalTokens;
  let penalty = 0;
  if (totalTokens > 2500) penalty += Math.min(30, (totalTokens - 2500) / 250);
  penalty += docs.filter((doc) => doc.tokens > 1400).length * 8;
  if (totalTokens > 800 && ratio < 0.18) penalty += Math.min(25, (0.18 - ratio) * 180);
  penalty = Math.min(55, penalty);
  return { id: 'token-efficiency', score: clampScore(100 - penalty), penalty: Math.round(penalty) };
}

function buriedCriticalRules(
  docs: readonly QualityDocument[],
): (QualityIssue & { path: string })[] {
  const issues: (QualityIssue & { path: string })[] = [];
  for (const doc of docs) {
    if (doc.tokens < 700 && doc.lineCount < 70) continue;
    for (const rule of doc.criticalRules) {
      const lineRatio = doc.lineCount <= 1 ? 0 : (rule.line - 1) / (doc.lineCount - 1);
      if (lineRatio < 0.6 && rule.line < 70) continue;
      issues.push({
        kind: 'buried-critical-rule',
        component: 'position-risk',
        id: `quality-bloat-buried-critical-rule-${slug(doc.path)}-${rule.line}`,
        severity: 'warning',
        agent: doc.agent,
        path: doc.path,
        line: rule.line,
      });
    }
  }
  return issues.sort(
    (a, b) =>
      a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0) || a.id.localeCompare(b.id),
  );
}

function positionComponent(buried: readonly QualityIssue[]): QualityComponentScore {
  const penalty = Math.min(40, buried.length * 16);
  return { id: 'position-risk', score: clampScore(100 - penalty), penalty };
}

function paragraphBlocks(body: string): string[] {
  const skipLine = createFenceFilter();
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of body.split('\n')) {
    if (skipLine(line)) continue;
    if (line.trim().length === 0 || HEADING_PATTERN.test(line) || DIRECTIVE_PATTERN.test(line)) {
      if (current.length > 0) blocks.push(current.join(' '));
      current = [];
      continue;
    }
    current.push(line.trim());
  }
  if (current.length > 0) blocks.push(current.join(' '));
  return blocks;
}

function clarityComponent(docs: readonly QualityDocument[]): {
  component: QualityComponentScore;
  issue?: QualityIssue;
} {
  let vagueHits = 0;
  let unstructured = 0;
  let longParagraphs = 0;
  let lowDirectiveDensity = 0;
  let worst: QualityDocument | undefined;
  let worstPenalty = 0;

  for (const doc of docs) {
    const skipLine = createFenceFilter();
    let docVagueHits = 0;
    for (const line of doc.body.split('\n')) {
      if (!skipLine(line) && VAGUE_PATTERN.test(line)) docVagueHits += 1;
    }
    const docLongParagraphs = paragraphBlocks(doc.body).filter(
      (p) => estimateTokens(p) > 130,
    ).length;
    const docUnstructured =
      doc.tokens > 500 && doc.headingCount < 2 && doc.directives.length < 3 ? 1 : 0;
    const docLowDensity =
      doc.tokens > 700 && doc.directives.length / (doc.tokens / 250) < 1 ? 1 : 0;
    const docPenalty =
      docVagueHits * 6 + docLongParagraphs * 8 + docUnstructured * 16 + docLowDensity * 12;

    vagueHits += docVagueHits;
    longParagraphs += docLongParagraphs;
    unstructured += docUnstructured;
    lowDirectiveDensity += docLowDensity;
    if (docPenalty > worstPenalty) {
      worstPenalty = docPenalty;
      worst = doc;
    }
  }

  const penalty = Math.min(
    45,
    vagueHits * 6 + longParagraphs * 8 + unstructured * 16 + lowDirectiveDensity * 12,
  );
  const component = { id: 'clarity' as const, score: clampScore(100 - penalty), penalty };
  if (component.score >= 80 || !worst) return { component };
  return {
    component,
    issue: {
      kind: 'unclear-content',
      component: 'clarity',
      id: `quality-bloat-unclear-content-${slug(worst.path)}`,
      severity: 'warning',
      agent: worst.agent,
      path: worst.path,
    },
  };
}

function numericWordValue(text: string): string | undefined {
  const word = /\b(once|twice|thrice)\b/.exec(text)?.[1];
  if (word === 'once') return '1';
  if (word === 'twice') return '2';
  if (word === 'thrice') return '3';
  return undefined;
}

function testCommandValue(text: string): string | undefined {
  if (!/\b(?:tests?|lint|typecheck|check)\b/.test(text)) return undefined;
  const runner =
    /\b(npm|yarn|pnpm|bun)\s+(?:run\s+)?(?:tests?|test|lint|typecheck|check)\b/.exec(text)?.[1] ??
    /\b(?:tests?|test|lint|typecheck|check)\b.{0,24}\b(?:with|using|via)\s+(npm|yarn|pnpm|bun)\b/.exec(
      text,
    )?.[1];
  return runner ? `runner:${runner}` : undefined;
}

function indentationValue(text: string): string | undefined {
  if (!/\b(?:indent|indentation|format|formatting|tabs?|spaces?)\b/.test(text)) {
    return undefined;
  }
  if (
    /\b(?:indent|indentation|format|formatting)\b.{0,35}\btabs?\b|\btabs?\b.{0,35}\b(?:indent|indentation|format|formatting)\b/.test(
      text,
    )
  ) {
    return 'tabs';
  }
  const spaces =
    /\b(?:indent|indentation|format|formatting)\b.{0,35}\b(\d+)\s+spaces?\b/.exec(text)?.[1] ??
    /\b(\d+)\s+spaces?\b.{0,35}\b(?:indent|indentation|format|formatting)\b/.exec(text)?.[1];
  if (spaces) return `${spaces}-spaces`;
  if (
    /\b(?:indent|indentation|format|formatting)\b.{0,35}\bspaces?\b|\bspaces?\b.{0,35}\b(?:indent|indentation|format|formatting)\b/.test(
      text,
    )
  ) {
    return 'spaces';
  }
  return undefined;
}

function retryCountValue(text: string): string | undefined {
  if (!/\b(?:retry|retries|retried|attempts?|fail fast)\b/.test(text)) return undefined;
  if (
    /\b(?:do not|don't|never|must not|should not|no)\b.{0,35}\b(?:retry|retries|retried)\b|\b(?:without retries|no retries|fail fast)\b/.test(
      text,
    )
  ) {
    return '0';
  }
  const numeric =
    /\b(?:retry|retries|retried|attempts?)\b.{0,35}\b(\d+)\b/.exec(text)?.[1] ??
    /\b(\d+)\b.{0,24}\b(?:retries|retry attempts|attempts)\b/.exec(text)?.[1] ??
    numericWordValue(text);
  return numeric;
}

function hasSecretObject(text: string): boolean {
  return /\b(?:secret|secrets|credential|credentials|token|tokens|api key|api keys)\b/.test(text);
}

function claimForDirective(doc: QualityDocument, directive: DirectiveLine): PolicyClaim[] {
  const text = directive.text;
  const out: PolicyClaim[] = [];
  const add = (subject: string, value: string) =>
    out.push({
      subject,
      value,
      path: doc.path,
      line: directive.line,
      agent: doc.agent,
      directive: directive.text,
    });

  const testCommand = testCommandValue(text);
  if (testCommand) add('test-command', testCommand);

  const indentation = indentationValue(text);
  if (indentation) add('indentation', indentation);

  const retryCount = retryCountValue(text);
  if (retryCount !== undefined) add('retry-count', retryCount);

  if (
    /\b(?:skip|avoid|never|do not|don't|no need to)\b.{0,45}\b(?:run\s+)?(?:tests?|lint|typecheck)\b|\b(?:tests?|lint|typecheck)\b.{0,20}\boptional\b/.test(
      text,
    )
  ) {
    add('tests', 'forbid');
  } else if (
    /\b(?:must|always|required|require|run)\b.{0,45}\b(?:tests?|lint|typecheck)\b|\b(?:tests?|lint|typecheck)\b.{0,30}\b(?:must|always|required)\b/.test(
      text,
    )
  ) {
    add('tests', 'require');
  }

  if (
    !hasSecretObject(text) &&
    /\b(?:never|do not|don't|must not|avoid|no)\b.{0,35}\bcommit\b/.test(text)
  ) {
    add('commits', 'forbid');
  } else if (
    !hasSecretObject(text) &&
    /\b(?:must|always|required|commit)\b.{0,35}\bcommit\b|\bcommit\b.{0,35}\b(?:must|always|required)\b/.test(
      text,
    )
  ) {
    add('commits', 'require');
  }

  if (/\b(?:never|do not|don't|must not|avoid|no)\b.{0,35}\bpush\b/.test(text)) {
    add('pushes', 'forbid');
  } else if (
    /\b(?:must|always|required|push)\b.{0,35}\bpush\b|\bpush\b.{0,35}\b(?:must|always|required)\b/.test(
      text,
    )
  ) {
    add('pushes', 'require');
  }

  if (
    /\b(?:never|do not|don't|must not)\b.{0,45}\b(?:secret|credential|token|api key)\b/.test(text)
  ) {
    add('secrets', 'forbid');
  } else if (
    /\b(?:commit|store|include)\b.{0,45}\b(?:secret|credential|token|api key)\b/.test(text)
  ) {
    add('secrets', 'require');
  }

  if (/\b(?:never|do not|don't|must not)\b.{0,45}\b(?:rm -rf|reset --hard|delete)\b/.test(text)) {
    add('destructive-commands', 'forbid');
  } else if (/\b(?:use|run|always|must)\b.{0,45}\b(?:rm -rf|reset --hard|delete)\b/.test(text)) {
    add('destructive-commands', 'require');
  }

  return out;
}

function contradictionIssues(docs: readonly QualityDocument[]): QualityIssue[] {
  const allClaims = docs
    .flatMap((doc) => doc.directives.flatMap((directive) => claimForDirective(doc, directive)))
    .sort(
      (a, b) =>
        a.subject.localeCompare(b.subject) ||
        a.path.localeCompare(b.path) ||
        a.line - b.line ||
        a.value.localeCompare(b.value),
    );
  const uniqueClaims = new Map<string, PolicyClaim>();
  for (const claim of allClaims) {
    const key = `${claim.path}\0${claim.subject}\0${claim.value}\0${claim.directive}`;
    if (!uniqueClaims.has(key)) uniqueClaims.set(key, claim);
  }
  const claims = [...uniqueClaims.values()];
  const issues: QualityIssue[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      const a = claims[i];
      const b = claims[j];
      if (!a || !b) continue;
      if (a.subject !== b.subject) break;
      if (a.value === b.value) continue;
      const [first, second] =
        a.path < b.path || (a.path === b.path && a.line <= b.line) ? [a, b] : [b, a];
      const key = `${a.subject}:${first.path}:${first.line}:${second.path}:${second.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({
        kind: 'contradiction',
        component: 'contradictions',
        id: `quality-bloat-contradiction-${slug(a.subject)}-${slug(first.path)}-${first.line}-${slug(second.path)}-${second.line}`,
        severity: 'warning',
        agent: first.agent === second.agent ? first.agent : 'multi',
        path: first.path,
        line: first.line,
        otherPath: second.path,
        otherLine: second.line,
        subject: a.subject,
      });
    }
  }
  return issues;
}

function contradictionComponent(issues: readonly QualityIssue[]): QualityComponentScore {
  const subjects = new Set(issues.map((i) => i.subject ?? i.id));
  const penalty = Math.min(60, subjects.size * 28 + Math.max(0, issues.length - subjects.size) * 8);
  return { id: 'contradictions', score: clampScore(100 - penalty), penalty };
}

/** Compute the score plus analyzer-only issue evidence. */
export function assessConfigQuality(input: AnalyzerInput): QualityAssessment {
  const docs = collectDocuments(input);
  const totalTokens = totalContextTokens(input, docs);
  const buried = buriedCriticalRules(docs);
  const contradictions = contradictionIssues(docs);
  const clarity = clarityComponent(docs);
  const components = [
    tokenComponent(totalTokens, docs),
    positionComponent(buried),
    clarity.component,
    contradictionComponent(contradictions),
  ];
  const penaltyById = new Map(components.map((c) => [c.id, c.penalty]));
  const weightedPenalty =
    (penaltyById.get('token-efficiency') ?? 0) * 0.55 +
    (penaltyById.get('position-risk') ?? 0) * 0.35 +
    (penaltyById.get('clarity') ?? 0) * 0.4 +
    (penaltyById.get('contradictions') ?? 0) * 0.7;
  const quality: AgentConfigQuality = {
    score: clampScore(100 - weightedPenalty),
    components,
    metrics: {
      totalTokens,
      guideCount: docs.length,
      directiveCount: docs.reduce((sum, doc) => sum + doc.directives.length, 0),
      criticalRuleCount: docs.reduce((sum, doc) => sum + doc.criticalRules.length, 0),
      buriedCriticalRuleCount: buried.length,
      contradictionCount: contradictions.length,
    },
  };

  const issues: QualityIssue[] = [];
  if (quality.score < 75) {
    issues.push({
      kind: 'low-score',
      component: 'token-efficiency',
      id: 'quality-bloat-score',
      severity: quality.score < 50 ? 'error' : 'warning',
      agent: 'multi',
    });
  }
  if (components[0]?.score !== undefined && components[0].score < 75) {
    issues.push({
      kind: 'token-bloat',
      component: 'token-efficiency',
      id: 'quality-bloat-token-efficiency',
      severity: 'warning',
      agent: 'multi',
    });
  }
  issues.push(...buried.slice(0, 5));
  if (clarity.issue) issues.push(clarity.issue);
  issues.push(...contradictions.slice(0, 5));

  return { quality, issues };
}

/** Serialized score only; no issue evidence. */
export function computeQualityScore(input: AnalyzerInput): AgentConfigQuality {
  return assessConfigQuality(input).quality;
}
