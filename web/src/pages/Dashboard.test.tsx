// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatsResponse } from '../api/types.js';
import { Dashboard } from './Dashboard.js';

const getStatsMock = vi.hoisted(() => vi.fn<() => Promise<StatsResponse>>());

vi.mock('../api/token.js', () => ({
  bootstrapToken: () => 'test-token',
}));

vi.mock('../api/index.js', () => ({
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly kind: string,
      message: string,
    ) {
      super(message);
    }
  },
  ApiClient: class ApiClient {
    getStats = getStatsMock;
  },
}));

function statsResponse(over: Partial<StatsResponse['stats']> = {}): StatsResponse {
  return {
    stats: {
      sessionCount: 1,
      messageCounts: { total: 1, user: 0, assistant: 1 },
      promptCount: 0,
      runtimes: ['claude'],
      activeDays: 1,
      streak: { current: 1, longest: 1 },
      xp: { xp: 51, level: 1, xpIntoLevel: 51, xpForNextLevel: 100, levelProgress: 0.51 },
      usage: {
        tokens: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          totalTokens: 0,
        },
        messagesWithUsage: 0,
        completeUsageMessages: 0,
        partialUsageMessages: 0,
        assistantMessagesWithoutUsage: 1,
        cost: { status: 'unknown', currency: 'USD', pricedMessages: 0, unpricedMessages: 0 },
      },
      heatmap: [],
      firstActiveDate: '2026-07-31',
      lastActiveDate: '2026-07-31',
      ...over,
    },
    achievements: { unlocked: [], locked: [] },
    sessionsScanned: 1,
    sessionsTotal: 1,
    capped: false,
  };
}

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function tileValue(container: HTMLElement, label: string): string | undefined {
  const tiles = [...container.querySelectorAll('.tile')];
  const tile = tiles.find((el) => el.querySelector('.t-label')?.textContent === label);
  return tile?.querySelector('.t-num')?.textContent ?? undefined;
}

describe('Dashboard render', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    getStatsMock.mockResolvedValue(statsResponse());
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    getStatsMock.mockReset();
  });

  it('renders all token tiles as unknown when no usage blocks exist', async () => {
    await act(async () => {
      root.render(<Dashboard />);
    });
    await flush();

    expect(tileValue(container, 'Tokens')).toBe('—');
    expect(tileValue(container, 'Input tokens')).toBe('—');
    expect(tileValue(container, 'Output tokens')).toBe('—');
  });
});
