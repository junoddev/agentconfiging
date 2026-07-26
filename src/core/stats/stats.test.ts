/**
 * Stats engine tests (SPEC §5 row 1 / E7). Fixture-driven: the canonical
 * claude session fixtures are parsed with the committed history adapter and
 * fed to the PURE engine, alongside hand-built `Session[]` models for precise
 * streak / heatmap / XP / timezone assertions. Every day boundary is UTC.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseClaudeHistory, parseClaudeSession } from '../history/claude.js';
import type { ReadDiagnostics, Runtime, Session, SessionMessage } from '../history/types.js';
import { computeStats, computeXpTotal, xpToLevel } from './stats.js';

const sessionsDir = path.resolve(process.cwd(), 'fixtures/sessions/claude');

function loadFixtureSessions(): Session[] {
  const projectsDir = path.join(sessionsDir, 'projects');
  const files: string[] = [];
  for (const slug of fs.readdirSync(projectsDir)) {
    const dir = path.join(projectsDir, slug);
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith('.jsonl')) files.push(path.join(dir, file));
    }
  }
  return files.map((f) => parseClaudeSession(fs.readFileSync(f, 'utf8'), f));
}

function loadFixtureHistory() {
  return parseClaudeHistory(fs.readFileSync(path.join(sessionsDir, 'history.jsonl'), 'utf8'));
}

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 6, 26, 12, 0, 0); // 2026-07-26, well after the fixtures.
const emptyDiagnostics: ReadDiagnostics = {
  totalLines: 0,
  skipped: 0,
  malformed: 0,
  ignored: 0,
  unknownTypes: [],
  overflowCount: 0,
  rejectedSpillPaths: 0,
};

/** ISO timestamp `daysAgo` days before NOW (12:00 UTC). */
function dayIso(daysAgo: number): string {
  return new Date(NOW - daysAgo * DAY).toISOString();
}

/** A synthetic session whose messages carry the given ISO timestamps. */
function makeSession(runtime: Runtime, timestamps: (string | undefined)[]): Session {
  const messages: SessionMessage[] = timestamps.map((timestamp, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    isSidechain: false,
    isMeta: false,
    timestamp,
    content: [],
  }));
  return {
    runtime,
    filePath: '',
    cwds: [],
    messages,
    diagnostics: emptyDiagnostics,
  };
}

describe('computeStats — empty / sparse resilience', () => {
  it('returns fully zeroed stats for no sessions, no crash', () => {
    const stats = computeStats([], undefined, { now: NOW });
    expect(stats.sessionCount).toBe(0);
    expect(stats.messageCounts).toEqual({ total: 0, user: 0, assistant: 0 });
    expect(stats.promptCount).toBe(0);
    expect(stats.runtimes).toEqual([]);
    expect(stats.activeDays).toBe(0);
    expect(stats.streak).toEqual({ current: 0, longest: 0 });
    expect(stats.xp).toEqual({
      xp: 0,
      level: 1,
      xpIntoLevel: 0,
      xpForNextLevel: 100,
      levelProgress: 0,
    });
    expect(stats.firstActiveDate).toBeUndefined();
    expect(stats.lastActiveDate).toBeUndefined();
    expect(stats.heatmap).toHaveLength(365);
    expect(stats.heatmap.every((c) => c.count === 0)).toBe(true);
  });

  it('ignores unparseable timestamps without crashing', () => {
    const stats = computeStats([makeSession('claude', ['not-a-date', undefined])], undefined, {
      now: NOW,
    });
    expect(stats.messageCounts.total).toBe(2);
    expect(stats.activeDays).toBe(0);
    expect(stats.streak.longest).toBe(0);
  });
});

describe('computeStats — fixture corpus', () => {
  it('counts sessions and messages by role from the parsed fixtures', () => {
    const stats = computeStats(loadFixtureSessions(), undefined, { now: NOW });
    expect(stats.sessionCount).toBe(3);
    expect(stats.messageCounts).toEqual({ total: 12, user: 6, assistant: 6 });
    expect(stats.runtimes).toEqual(['claude']);
  });

  it('derives 3 consecutive active days and a longest streak of 3', () => {
    const stats = computeStats(loadFixtureSessions(), undefined, { now: NOW });
    expect(stats.activeDays).toBe(3);
    expect(stats.streak.longest).toBe(3);
    expect(stats.firstActiveDate).toBe('2026-06-19');
    expect(stats.lastActiveDate).toBe('2026-06-21');
  });

  it('builds a heatmap whose per-day counts match message events', () => {
    const stats = computeStats(loadFixtureSessions(), undefined, { now: NOW });
    const byDate = new Map(stats.heatmap.map((c) => [c.date, c.count]));
    expect(byDate.get('2026-06-19')).toBe(8);
    expect(byDate.get('2026-06-20')).toBe(2);
    expect(byDate.get('2026-06-21')).toBe(2);
    expect(stats.heatmap.reduce((sum, c) => sum + c.count, 0)).toBe(12);
  });

  it('counts prompt-history entries', () => {
    const stats = computeStats(loadFixtureSessions(), loadFixtureHistory(), { now: NOW });
    expect(stats.promptCount).toBe(5);
  });
});

describe('computeStats — streaks', () => {
  it('counts a current streak ending today', () => {
    const stats = computeStats(
      [
        makeSession('claude', [dayIso(0)]),
        makeSession('claude', [dayIso(1)]),
        makeSession('claude', [dayIso(2)]),
      ],
      undefined,
      { now: NOW },
    );
    expect(stats.streak.current).toBe(3);
    expect(stats.streak.longest).toBe(3);
  });

  it('keeps the streak current when the last active day is yesterday', () => {
    const stats = computeStats(
      [makeSession('claude', [dayIso(1), dayIso(2), dayIso(3)])],
      undefined,
      { now: NOW },
    );
    expect(stats.streak.current).toBe(3);
  });

  it('resets the current streak when the last active day is older than yesterday', () => {
    const stats = computeStats([makeSession('claude', [dayIso(3), dayIso(4)])], undefined, {
      now: NOW,
    });
    expect(stats.streak.current).toBe(0);
    expect(stats.streak.longest).toBe(2);
  });

  it('breaks the longest streak across a gap', () => {
    // Active today,1,2 ago (run of 3) and 5,6,7,8 ago (run of 4); gap at day 3,4.
    const stats = computeStats(
      [
        makeSession('claude', [dayIso(0), dayIso(1), dayIso(2)]),
        makeSession('claude', [dayIso(5), dayIso(6), dayIso(7), dayIso(8)]),
      ],
      undefined,
      { now: NOW },
    );
    expect(stats.streak.current).toBe(3);
    expect(stats.streak.longest).toBe(4);
  });

  it('handles a single active day', () => {
    const stats = computeStats([makeSession('claude', [dayIso(0)])], undefined, { now: NOW });
    expect(stats.streak.current).toBe(1);
    expect(stats.streak.longest).toBe(1);
  });
});

describe('computeStats — heatmap window bounds', () => {
  it('emits exactly heatmapDays cells ending today, oldest first', () => {
    const stats = computeStats([], undefined, { now: NOW, heatmapDays: 7 });
    expect(stats.heatmap).toHaveLength(7);
    expect(stats.heatmap[0]?.date).toBe(new Date(NOW - 6 * DAY).toISOString().slice(0, 10));
    expect(stats.heatmap[6]?.date).toBe(new Date(NOW).toISOString().slice(0, 10));
  });

  it('supports a zero-length window', () => {
    const stats = computeStats([], undefined, { now: NOW, heatmapDays: 0 });
    expect(stats.heatmap).toEqual([]);
  });

  it('excludes activity that falls outside the window from cells but not from totals', () => {
    const stats = computeStats([makeSession('claude', [dayIso(100)])], undefined, {
      now: NOW,
      heatmapDays: 7,
    });
    expect(stats.heatmap.reduce((sum, c) => sum + c.count, 0)).toBe(0);
    expect(stats.activeDays).toBe(1); // still counted all-time
  });
});

describe('computeStats — timezone (UTC) consistency', () => {
  it('groups timestamps by UTC calendar day across the midnight boundary', () => {
    const stats = computeStats(
      [makeSession('claude', ['2026-06-19T23:59:59.000Z', '2026-06-20T00:00:01.000Z'])],
      undefined,
      { now: NOW },
    );
    expect(stats.activeDays).toBe(2);
    expect(stats.firstActiveDate).toBe('2026-06-19');
    expect(stats.lastActiveDate).toBe('2026-06-20');
  });
});

describe('XP / level formula', () => {
  it('computes total XP as the documented weighted sum', () => {
    // 12 msgs*1 + 3 sessions*10 + 3 active days*15 + longest 3*25 = 12+30+45+75 = 162
    expect(computeXpTotal(12, 3, 3, 3)).toBe(162);
  });

  it('follows the quadratic level curve at boundaries', () => {
    expect(xpToLevel(0)).toBe(1);
    expect(xpToLevel(99)).toBe(1);
    expect(xpToLevel(100)).toBe(2);
    expect(xpToLevel(399)).toBe(2);
    expect(xpToLevel(400)).toBe(3);
    expect(xpToLevel(900)).toBe(4);
  });

  it('reports level progress into the current level', () => {
    const stats = computeStats(loadFixtureSessions(), undefined, { now: NOW });
    // xp 162 → level 2 (starts at 100), next level at 400 → 62/300 progress.
    expect(stats.xp.xp).toBe(162);
    expect(stats.xp.level).toBe(2);
    expect(stats.xp.xpIntoLevel).toBe(62);
    expect(stats.xp.xpForNextLevel).toBe(300);
    expect(stats.xp.levelProgress).toBeCloseTo(62 / 300);
  });
});

describe('multi-runtime', () => {
  it('aggregates sessions from any runtime through the same engine', () => {
    const stats = computeStats(
      [
        makeSession('claude', [dayIso(0)]),
        makeSession('codex', [dayIso(1)]),
        makeSession('gemini', [dayIso(2)]),
      ],
      undefined,
      { now: NOW },
    );
    expect(stats.runtimes).toEqual(['claude', 'codex', 'gemini']);
    expect(stats.sessionCount).toBe(3);
  });
});
