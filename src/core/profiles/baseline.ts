/**
 * The runtime instruction-format table (SPEC §4.1) — data, not logic.
 *
 * Covers the 8 first-class runtimes (those with detector modules in
 * src/core/detectors) AND the long-tail runtimes that are instruction sync
 * TARGETS even though full detection is not built for them.
 *
 * Fact policy: paths were checked against vendor docs / detector modules
 * where possible. Entries marked `confidence: 'unverified'` keep facts
 * minimal — nothing here is invented; when a detail was uncertain it was
 * left out rather than guessed.
 */

import type { RuntimeFormat } from '../runtimes/types.js';

const MD_STUB = '# Project instructions\n\n<!-- Add project-specific guidance here. -->\n';

/**
 * One-time compatibility inputs used to construct the canonical baseline
 * profiles. Runtime consumers must use the profile projection rather than
 * importing this seed directly.
 */
export const BASELINE_RUNTIME_FORMATS: readonly RuntimeFormat[] = [
  // ── First-class runtimes (full detectors exist) ──────────────────────
  {
    id: 'aider',
    displayName: 'Aider',
    firstClass: true,
    format: 'markdown',
    layout: 'single-file',
    instructionPaths: ['CONVENTIONS.md'],
    scopeNotes:
      'CONVENTIONS.md is a documented convention, not auto-loaded by name: it is passed ' +
      'via --read or a `read:` entry in .aider.conf.yml.',
    scaffoldPath: 'CONVENTIONS.md',
    scaffoldTemplate: '# Coding conventions\n\n<!-- Conventions aider should follow. -->\n',
    detectionMarkers: ['.aider.conf.yml', '.aiderignore'],
    docsUrl: 'https://aider.chat/docs/usage/conventions.html',
    confidence: 'verified',
  },
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    firstClass: true,
    format: 'markdown',
    layout: 'single-file',
    instructionPaths: ['CLAUDE.md'],
    globalPaths: ['~/.claude/CLAUDE.md'],
    scopeNotes: 'Nested CLAUDE.md files in subdirectories are also loaded on demand.',
    scaffoldPath: 'CLAUDE.md',
    scaffoldTemplate: MD_STUB,
    detectionMarkers: ['CLAUDE.md', '.claude/'],
    docsUrl: 'https://docs.anthropic.com/en/docs/claude-code/memory',
    confidence: 'verified',
  },
  {
    id: 'codex',
    displayName: 'OpenAI Codex',
    firstClass: true,
    format: 'markdown',
    layout: 'single-file',
    instructionPaths: ['AGENTS.md'],
    globalPaths: ['~/.codex/AGENTS.md'],
    scopeNotes: 'AGENTS.md is a shared cross-tool convention; other runtimes read it too.',
    scaffoldPath: 'AGENTS.md',
    scaffoldTemplate: MD_STUB,
    detectionMarkers: ['AGENTS.md', '.codex/'],
    docsUrl: 'https://agents.md/',
    confidence: 'verified',
  },
  {
    id: 'continue',
    displayName: 'Continue',
    firstClass: true,
    format: 'frontmattered-markdown',
    layout: 'hybrid',
    instructionPaths: ['.continue/rules/', '.continuerules'],
    rulesDirPattern: '.continue/rules/*.md',
    scopeNotes:
      'Newer versions use .continue/rules/*.md (YAML frontmatter supported); .continuerules ' +
      'is the legacy single-file form. Format has churned recently.',
    scaffoldPath: '.continue/rules/project.md',
    scaffoldTemplate: '---\nname: Project rules\n---\n\n# Project rules\n',
    detectionMarkers: ['.continue/'],
    docsUrl: 'https://docs.continue.dev/customize/deep-dives/rules',
    confidence: 'unverified',
  },
  {
    id: 'copilot',
    displayName: 'GitHub Copilot',
    firstClass: true,
    format: 'markdown',
    layout: 'hybrid',
    instructionPaths: ['.github/copilot-instructions.md', '.github/instructions/'],
    rulesDirPattern: '.github/instructions/*.instructions.md',
    scopeNotes:
      'Repo-wide instructions are plain markdown; .github/instructions/*.instructions.md ' +
      'files are path-scoped with an `applyTo` frontmatter field.',
    scaffoldPath: '.github/copilot-instructions.md',
    scaffoldTemplate: MD_STUB,
    detectionMarkers: ['.github/copilot-instructions.md', '.github/copilot/'],
    docsUrl:
      'https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot',
    confidence: 'verified',
  },
  {
    id: 'cursor',
    displayName: 'Cursor',
    firstClass: true,
    format: 'frontmattered-markdown',
    layout: 'hybrid',
    instructionPaths: ['.cursor/rules/', '.cursorrules'],
    rulesDirPattern: '.cursor/rules/*.mdc',
    scopeNotes:
      '.cursor/rules/*.mdc files carry description/globs/alwaysApply frontmatter; ' +
      '.cursorrules is the deprecated legacy single file. User-level rules live in app ' +
      'settings, not files.',
    scaffoldPath: '.cursor/rules/project.mdc',
    scaffoldTemplate:
      '---\ndescription: Project conventions\nalwaysApply: true\n---\n\n# Project rules\n',
    detectionMarkers: ['.cursorrules', '.cursor/'],
    docsUrl: 'https://docs.cursor.com/context/rules',
    confidence: 'verified',
  },
  {
    id: 'gemini-cli',
    displayName: 'Gemini CLI',
    firstClass: true,
    format: 'markdown',
    layout: 'single-file',
    instructionPaths: ['GEMINI.md'],
    globalPaths: ['~/.gemini/GEMINI.md'],
    scaffoldPath: 'GEMINI.md',
    scaffoldTemplate: MD_STUB,
    detectionMarkers: ['GEMINI.md', '.gemini/'],
    docsUrl: 'https://github.com/google-gemini/gemini-cli',
    confidence: 'verified',
  },
  {
    id: 'opencode',
    displayName: 'opencode',
    firstClass: true,
    format: 'markdown',
    layout: 'single-file',
    instructionPaths: ['AGENTS.md'],
    scopeNotes:
      'Reads the shared AGENTS.md convention; runtime config lives in opencode.json and ' +
      '.opencode/. Global config dir is ~/.config/opencode.',
    scaffoldPath: 'AGENTS.md',
    scaffoldTemplate: MD_STUB,
    detectionMarkers: ['opencode.json', '.opencode/'],
    docsUrl: 'https://opencode.ai/docs/rules/',
    confidence: 'verified',
  },

  // ── Long-tail runtimes (sync targets; detection-lite only) ───────────
  {
    id: 'amazon-q',
    displayName: 'Amazon Q Developer',
    firstClass: false,
    format: 'markdown',
    layout: 'rules-dir',
    instructionPaths: ['.amazonq/rules/'],
    rulesDirPattern: '.amazonq/rules/*.md',
    scaffoldPath: '.amazonq/rules/project.md',
    scaffoldTemplate: MD_STUB,
    detectionMarkers: ['.amazonq/'],
    docsUrl: 'https://docs.aws.amazon.com/amazonq/',
    confidence: 'verified',
  },
  {
    id: 'cline',
    displayName: 'Cline',
    firstClass: false,
    format: 'markdown',
    layout: 'hybrid',
    instructionPaths: ['.clinerules', '.clinerules/'],
    rulesDirPattern: '.clinerules/*.md',
    globalPaths: ['~/Documents/Cline/Rules/'],
    scopeNotes: '.clinerules is either a single file or a directory of markdown rule files.',
    scaffoldPath: '.clinerules',
    scaffoldTemplate: MD_STUB,
    detectionMarkers: ['.clinerules', '.clinerules/'],
    docsUrl: 'https://docs.cline.bot/features/cline-rules',
    confidence: 'verified',
  },
  {
    id: 'junie',
    displayName: 'JetBrains Junie',
    firstClass: false,
    format: 'markdown',
    layout: 'single-file',
    instructionPaths: ['.junie/guidelines.md'],
    scaffoldPath: '.junie/guidelines.md',
    scaffoldTemplate: MD_STUB,
    detectionMarkers: ['.junie/'],
    docsUrl: 'https://www.jetbrains.com/junie/',
    confidence: 'verified',
  },
  {
    id: 'qodo',
    displayName: 'Qodo',
    firstClass: false,
    format: 'markdown',
    layout: 'single-file',
    instructionPaths: ['best_practices.md'],
    scopeNotes:
      'best_practices.md at the repo root is used by Qodo Merge best-practices checks; ' +
      'other Qodo products configure context differently.',
    scaffoldPath: 'best_practices.md',
    scaffoldTemplate: '# Best practices\n\n<!-- Practices Qodo should enforce in reviews. -->\n',
    detectionMarkers: ['best_practices.md'],
    docsUrl: 'https://docs.qodo.ai/',
    confidence: 'unverified',
  },
  {
    id: 'roo',
    displayName: 'Roo Code',
    firstClass: false,
    format: 'markdown',
    layout: 'hybrid',
    instructionPaths: ['.roo/rules/', '.roorules'],
    rulesDirPattern: '.roo/rules/*.md',
    scopeNotes: '.roo/rules/ is the current form; .roorules is the legacy single file.',
    scaffoldPath: '.roo/rules/project.md',
    scaffoldTemplate: MD_STUB,
    detectionMarkers: ['.roo/', '.roorules'],
    docsUrl: 'https://docs.roocode.com/features/custom-instructions',
    confidence: 'verified',
  },
  {
    id: 'windsurf',
    displayName: 'Windsurf',
    firstClass: false,
    format: 'markdown',
    layout: 'hybrid',
    instructionPaths: ['.windsurfrules', '.windsurf/rules/'],
    rulesDirPattern: '.windsurf/rules/*.md',
    globalPaths: ['~/.codeium/windsurf/memories/global_rules.md'],
    scopeNotes: 'Newer versions add the .windsurf/rules/ directory alongside .windsurfrules.',
    scaffoldPath: '.windsurfrules',
    scaffoldTemplate: MD_STUB,
    detectionMarkers: ['.windsurfrules', '.windsurf/'],
    docsUrl: 'https://docs.windsurf.com/windsurf/cascade/memories',
    confidence: 'verified',
  },
  {
    id: 'zed',
    displayName: 'Zed',
    firstClass: false,
    format: 'markdown',
    layout: 'single-file',
    instructionPaths: ['.rules'],
    scopeNotes:
      'When .rules is absent, Zed falls back to other tools’ rule files ' +
      '(.cursorrules, .windsurfrules, .clinerules, AGENTS.md, CLAUDE.md, GEMINI.md, ' +
      '.github/copilot-instructions.md).',
    scaffoldPath: '.rules',
    scaffoldTemplate: MD_STUB,
    detectionMarkers: ['.rules'],
    docsUrl: 'https://zed.dev/docs/ai/rules',
    confidence: 'verified',
  },
];
