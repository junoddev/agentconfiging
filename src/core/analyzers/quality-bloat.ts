/**
 * quality-bloat — content-aware 0-100 quality/bloat scoring.
 *
 * The analyzer itself is pure and delegates the deterministic score/evidence
 * computation to src/core/quality.ts. Findings intentionally do not carry
 * fixes: prose quality, buried critical rules, and contradictions need human
 * consolidation rather than blind replacement patches.
 */

import type { Finding } from '../findings.js';
import { assessConfigQuality, type QualityAssessment, type QualityIssue } from '../quality.js';
import type { AnalyzerInput } from '../report.js';
import { registerAnalyzer } from './registry.js';

function scoreOf(assessment: QualityAssessment, component: QualityIssue['component']): number {
  return assessment.quality.components.find((c) => c.id === component)?.score ?? 100;
}

function findingForIssue(assessment: QualityAssessment, issue: QualityIssue): Finding {
  if (issue.kind === 'low-score') {
    const { quality } = assessment;
    return {
      id: issue.id,
      severity: issue.severity,
      agent: issue.agent,
      title: `Agent config quality score is ${quality.score}/100`,
      detail:
        `The quality/bloat score is ${quality.score}/100 across ` +
        `${quality.metrics.guideCount} context-bearing guide file(s), ` +
        `${quality.metrics.totalTokens} estimated tokens, ` +
        `${quality.metrics.buriedCriticalRuleCount} buried critical rule(s), and ` +
        `${quality.metrics.contradictionCount} contradiction(s).`,
      suggestion:
        'Trim low-signal prose, move critical rules near the top of the relevant guide, and make runtime guides agree on required workflow rules.',
    };
  }

  if (issue.kind === 'token-bloat') {
    const { quality } = assessment;
    return {
      id: issue.id,
      severity: issue.severity,
      agent: issue.agent,
      title: `Instruction context is bloated (${quality.metrics.totalTokens} estimated tokens)`,
      detail:
        `The token-efficiency component scored ${scoreOf(assessment, 'token-efficiency')}/100. ` +
        'Large or low-directive guidance burns context before the agent reaches the actual task.',
      suggestion:
        'Delete repeated background prose, keep always-loaded guides directive-heavy, and move optional reference material behind explicit imports or narrower rule files.',
    };
  }

  if (issue.kind === 'buried-critical-rule') {
    return {
      id: issue.id,
      severity: issue.severity,
      agent: issue.agent,
      title: 'Critical rule is buried late in a guide',
      detail:
        `A critical directive appears late in \`${issue.path}\` at line ${issue.line}. ` +
        'Rules about must/never/security/permissions are easy to miss when they are placed after large blocks of context.',
      suggestion:
        'Move the critical rule into the first policy section of the guide or extract it into a small, always-loaded rule file.',
    };
  }

  if (issue.kind === 'unclear-content') {
    return {
      id: issue.id,
      severity: issue.severity,
      agent: issue.agent,
      title: 'Guide content is vague or hard to scan',
      detail:
        `The clarity component scored ${scoreOf(assessment, 'clarity')}/100, with the strongest signal in \`${issue.path}\`. ` +
        'Vague phrases, long paragraphs, or too few directive lines make the instruction file harder for agents to apply consistently.',
      suggestion:
        'Replace vague prose with concrete bullets: command names, allowed/disallowed actions, ownership boundaries, and test expectations.',
    };
  }

  return {
    id: issue.id,
    severity: issue.severity,
    agent: issue.agent,
    title: `Contradictory ${issue.subject ?? 'workflow'} rules`,
    detail:
      `Conflicting directives were found in \`${issue.path}\` line ${issue.line} and ` +
      `\`${issue.otherPath}\` line ${issue.otherLine}. Agents reading different runtime files can follow opposite rules.`,
    suggestion:
      'Pick one canonical policy and mirror it across runtime-specific guides, or replace secondary guides with a pointer to the canonical file.',
  };
}

registerAnalyzer({
  id: 'quality-bloat',

  analyze(input: AnalyzerInput): Finding[] {
    const assessment = assessConfigQuality(input);
    return assessment.issues.map((issue) => findingForIssue(assessment, issue));
  },
});
