// @vitest-environment jsdom
/**
 * useFileEditor regression tests (jsdom). The critical case is the reload race:
 * a `reload()` promise resolving AFTER the user selected a different file must
 * not clobber the new selection with the old file's content (a wrong-file
 * overwrite via the save flow). Mirrors the createRoot + act style used by the
 * page tests (no renderHook dependency).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { FileContent } from '../api/index.js';
import { useFileEditor, type FileEditorState } from './useFileEditor.js';

let host: HTMLElement | undefined;
let root: Root | undefined;
let latest: FileEditorState | undefined;

function mount(path: string | undefined, getFile: (path: string) => Promise<FileContent>): void {
  const Harness = (): null => {
    latest = useFileEditor({ path, getFile });
    return null;
  };
  act(() => {
    root?.render(<Harness />);
  });
}

function deferred(): {
  promise: Promise<FileContent>;
  resolve: (value: FileContent) => void;
} {
  let resolve!: (value: FileContent) => void;
  const promise = new Promise<FileContent>((r) => (resolve = r));
  return { promise, resolve };
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = undefined;
  root = undefined;
  latest = undefined;
});

const file = (path: string, content: string): FileContent => ({
  path,
  content,
  spans: [],
  pathScope: 'root',
});

describe('useFileEditor', () => {
  it('ignores a reload resolving after the selection changed (no wrong-file clobber)', async () => {
    // One deferred per a.md load: [selection, reload].
    const aLoads = [deferred(), deferred()];
    let aCalls = 0;
    const getFile = (path: string): Promise<FileContent> => {
      if (path === 'a.md') return aLoads[aCalls++]!.promise;
      return Promise.resolve(file('b.md', 'B content'));
    };

    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);

    mount('a.md', getFile);
    await act(async () => {
      aLoads[0]!.resolve(file('a.md', 'A content'));
      await aLoads[0]!.promise;
    });
    expect(latest?.draft).toBe('A content');

    // Reload fires for a.md, then the user selects b.md before it resolves.
    act(() => latest?.reload());
    mount('b.md', getFile);
    await act(async () => {}); // flush b.md's selection load
    expect(latest?.draft).toBe('B content');

    await act(async () => {
      aLoads[1]!.resolve(file('a.md', 'STALE A'));
      await aLoads[1]!.promise;
    });
    expect(latest?.file?.path).toBe('b.md');
    expect(latest?.draft).toBe('B content'); // NOT clobbered with the stale text
  });
});
