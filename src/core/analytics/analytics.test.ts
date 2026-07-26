/**
 * Tests for the pure analytics engine (bead 7yb.5). The engine is exercised over
 * hand-built {@link Session} fixtures — no disk, no adapter — pinning: per-model
 * token/cost aggregation against the dated pricing table, cache efficiency, the
 * daily + hourly trends, the current-month figure, and content-free resilience
 * (messages without usage / timestamps contribute nothing and never crash).
 */

import { describe, expect, it } from 'vitest';
import { computeAnalytics, costOf, priceFor } from './index.js';
import type { Session, SessionMessage, TokenUsage } from '../history/types.js';

const NOW = Date.parse('2026-07-26T12:00:00.000Z');

function usage(input: number, output: number, cacheWrite = 0, cacheRead = 0): TokenUsage {
  return {
    inputTokens: input,
    outputTokens: output,
    cacheCreationTokens: cacheWrite,
    cacheReadTokens: cacheRead,
  };
}

function asstMsg(model: string, ts: string, u: TokenUsage | undefined): SessionMessage {
  const msg: SessionMessage = {
    role: 'assistant',
    timestamp: ts,
    isSidechain: false,
    isMeta: false,
    model,
    content: [{ type: 'text', text: 'x' }],
  };
  if (u !== undefined) msg.usage = u;
  return msg;
}

function session(messages: SessionMessage[]): Session {
  return {
    runtime: 'claude',
    filePath: '/x/s.jsonl',
    cwds: [],
    messages,
    diagnostics: {
      totalLines: 0,
      skipped: 0,
      malformed: 0,
      ignored: 0,
      unknownTypes: [],
      overflowCount: 0,
      rejectedSpillPaths: 0,
    },
  };
}

describe('priceFor', () => {
  it('matches families by substring and prices per token', () => {
    expect(priceFor('claude-opus-4-5').family).toBe('opus');
    expect(priceFor('claude-3-5-sonnet-20241022').family).toBe('sonnet');
    expect(priceFor('claude-haiku-4-5').family).toBe('haiku');
    // $15 / 1e6 input for opus.
    expect(priceFor('claude-opus-4-5').rate.input).toBeCloseTo(15 / 1_000_000, 12);
    expect(priceFor('claude-opus-4-5').priced).toBe(true);
  });

  it('falls back (flagged) for an unknown model id', () => {
    const p = priceFor('claude-fable-5');
    expect(p.priced).toBe(false);
    expect(p.family).toBe('sonnet');
  });
});

describe('costOf', () => {
  it('multiplies each token class by its per-token rate', () => {
    const rate = priceFor('claude-sonnet-4-5').rate;
    // 1M input + 1M output at sonnet rates = $3 + $15.
    const c = costOf(usage(1_000_000, 1_000_000), rate);
    expect(c.input).toBeCloseTo(3, 6);
    expect(c.output).toBeCloseTo(15, 6);
    expect(c.total).toBeCloseTo(18, 6);
  });
});

describe('computeAnalytics', () => {
  it('aggregates tokens and cost per model, sorted by cost desc', () => {
    const sessions = [
      session([
        asstMsg('claude-opus-4-5', '2026-07-20T10:00:00Z', usage(1_000_000, 100_000)),
        asstMsg('claude-sonnet-4-5', '2026-07-20T11:00:00Z', usage(1_000_000, 100_000)),
      ]),
    ];
    const r = computeAnalytics(sessions, { now: NOW });

    expect(r.models).toHaveLength(2);
    // Opus is pricier, so it sorts first.
    expect(r.models[0]!.model).toBe('claude-opus-4-5');
    // opus: 1M input * $15 + 100k output * $75/1e6 = 15 + 7.5 = 22.5
    expect(r.models[0]!.cost.total).toBeCloseTo(22.5, 6);
    // sonnet: 3 + 1.5 = 4.5
    expect(r.models[1]!.cost.total).toBeCloseTo(4.5, 6);
    expect(r.totalCost).toBeCloseTo(27, 6);
    expect(r.totals.inputTokens).toBe(2_000_000);
    expect(r.totals.outputTokens).toBe(200_000);
    expect(r.pricedMessages).toBe(2);
  });

  it('computes cache efficiency as cache-read over all input-side tokens', () => {
    const r = computeAnalytics(
      [session([asstMsg('claude-sonnet-4-5', '2026-07-20T10:00:00Z', usage(200, 50, 300, 500))])],
      { now: NOW },
    );
    // cacheRead 500 / (input 200 + cacheWrite 300 + cacheRead 500) = 500/1000
    expect(r.cacheEfficiency).toBeCloseTo(0.5, 6);
  });

  it('builds an ascending daily trend and a 24-bucket hourly profile', () => {
    const r = computeAnalytics(
      [
        session([
          asstMsg('claude-sonnet-4-5', '2026-07-20T10:15:00Z', usage(100, 10)),
          asstMsg('claude-sonnet-4-5', '2026-07-20T10:45:00Z', usage(100, 10)),
          asstMsg('claude-sonnet-4-5', '2026-07-22T23:30:00Z', usage(100, 10)),
        ]),
      ],
      { now: NOW },
    );
    expect(r.daily.map((d) => d.date)).toEqual(['2026-07-20', '2026-07-22']);
    expect(r.daily[0]!.tokens).toBe(220);
    expect(r.hourly).toHaveLength(24);
    expect(r.hourly[10]!.messages).toBe(2);
    expect(r.hourly[23]!.messages).toBe(1);
    expect(r.hourly[0]!.messages).toBe(0);
  });

  it('sums only the current UTC month into currentMonthCost', () => {
    const r = computeAnalytics(
      [
        session([
          asstMsg('claude-sonnet-4-5', '2026-07-01T00:00:00Z', usage(1_000_000, 0)), // in month
          asstMsg('claude-sonnet-4-5', '2026-06-30T23:59:00Z', usage(1_000_000, 0)), // prior month
        ]),
      ],
      { now: NOW },
    );
    expect(r.currentMonth).toBe('2026-07');
    // Only July's 1M input * $3 counts.
    expect(r.currentMonthCost).toBeCloseTo(3, 6);
    expect(r.totalCost).toBeCloseTo(6, 6);
  });

  it('ignores messages without usage and tolerates missing timestamps', () => {
    const noTs = asstMsg('claude-sonnet-4-5', '', usage(100, 10));
    delete noTs.timestamp;
    const r = computeAnalytics(
      [
        session([
          asstMsg('claude-sonnet-4-5', '2026-07-20T10:00:00Z', undefined), // no usage
          noTs, // usage but no timestamp → totals yes, trends no
        ]),
      ],
      { now: NOW },
    );
    expect(r.pricedMessages).toBe(1);
    expect(r.totals.inputTokens).toBe(100);
    expect(r.daily).toEqual([]); // no timestamped priced message
  });

  it('returns fully zeroed, crash-free output for empty input', () => {
    const r = computeAnalytics([], { now: NOW });
    expect(r.totalCost).toBe(0);
    expect(r.cacheEfficiency).toBe(0);
    expect(r.models).toEqual([]);
    expect(r.daily).toEqual([]);
    expect(r.hourly).toHaveLength(24);
    expect(r.pricingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.planNote).toContain('API-equivalent');
  });

  it('flags a fallback-priced model so the UI can mark it approximate', () => {
    const r = computeAnalytics(
      [session([asstMsg('claude-fable-5', '2026-07-20T10:00:00Z', usage(100, 10))])],
      { now: NOW },
    );
    expect(r.models[0]!.priced).toBe(false);
  });
});
