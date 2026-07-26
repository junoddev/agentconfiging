/**
 * The Ink app (DESIGN §8) — deliberately thin: all decisions live in the
 * pure modules (keys.ts reducer, instances.ts model, logs.ts formatting).
 * Completed log lines render via <Static> so they scroll into terminal
 * history; only the bottom status region (header + instance list + status
 * line) re-renders.
 */

import { Box, Static, Text, useApp, useInput } from 'ink';
import { useState } from 'react';
import {
  addInstance,
  addInstances,
  formatHeader,
  formatInstanceRow,
  moveSelection,
  type InstanceList,
} from './instances.js';
import { handleKey, type KeyEffect, type UiMode } from './keys.js';
import { formatTerminalLine, levelColor, type LogEntry, type LogLevel } from './logs.js';

export interface AppProps {
  url: string;
  initialList: InstanceList;
  initialLogs: readonly LogEntry[];
  /** False under NO_COLOR: render plain text, no color props at all. */
  colors: boolean;
  /** True with --detach: quitting leaves the server running. */
  detach: boolean;
  now: () => Date;
  /** Mirror every log-pane entry to the on-disk log file. */
  appendLog: (entry: LogEntry) => void;
  /** Spawn the platform browser opener pointed at the server URL. */
  openUrl: () => void;
  /** Validate an add-folder path; component adds `root` to the list on ok. */
  addFolder: (path: string) => { ok: boolean; root?: string; message: string };
  /** Recursive discovery under path; hits are offered as instances to add. */
  scanFolder: (path: string) => { ok: boolean; hits: string[]; message: string };
}

const KEY_HINTS = 'j/k SELECT · ENTER OPEN · a ADD · s SCAN · q QUIT';
const MAX_OFFER_PREVIEW = 5;

function StatusLine({ mode, colors }: { mode: UiMode; colors: boolean }) {
  const dim = colors ? 'gray' : undefined;
  if (mode.kind === 'prompt') {
    return (
      <Text>
        {mode.action === 'add' ? 'ADD PATH' : 'SCAN PATH'} &gt; {mode.value}
        <Text color={dim}> (enter confirm · esc cancel)</Text>
      </Text>
    );
  }
  if (mode.kind === 'offer') {
    const shown = mode.hits.slice(0, MAX_OFFER_PREVIEW);
    return (
      <Box flexDirection="column">
        {shown.map((hit) => (
          <Text key={hit} color={dim}>
            {'  + '}
            {hit}
          </Text>
        ))}
        {mode.hits.length > shown.length ? (
          <Text color={dim}>{`  … ${mode.hits.length - shown.length} MORE`}</Text>
        ) : null}
        <Text>
          {mode.hits.length} HIT{mode.hits.length === 1 ? '' : 'S'} · ADD ALL? y/n
        </Text>
      </Box>
    );
  }
  return <Text color={dim}>{KEY_HINTS}</Text>;
}

export function App(props: AppProps) {
  const { exit } = useApp();
  const [list, setList] = useState(props.initialList);
  const [mode, setMode] = useState<UiMode>({ kind: 'list' });
  const [logs, setLogs] = useState<readonly LogEntry[]>(props.initialLogs);

  const pushLog = (level: LogLevel, text: string) => {
    const entry: LogEntry = { time: props.now(), level, text };
    props.appendLog(entry);
    setLogs((prev) => [...prev, entry]);
  };

  const applyEffect = (effect: KeyEffect) => {
    switch (effect.type) {
      case 'move':
        setList((prev) => moveSelection(prev, effect.delta));
        break;
      case 'open':
        props.openUrl();
        pushLog('info', `OPEN ${props.url}`);
        break;
      case 'quit':
        pushLog('info', props.detach ? `DETACHED · SERVER LIVE · ${props.url}` : 'OFFLINE');
        exit();
        break;
      case 'add': {
        const result = props.addFolder(effect.path);
        if (result.ok && result.root !== undefined) {
          const root = result.root;
          setList((prev) => addInstance(prev, root).list);
          pushLog('info', result.message);
        } else {
          pushLog('warn', result.message);
        }
        break;
      }
      case 'scan': {
        const result = props.scanFolder(effect.path);
        if (!result.ok) {
          pushLog('warn', result.message);
        } else if (result.hits.length === 0) {
          pushLog('info', result.message);
        } else {
          pushLog('info', result.message);
          setMode({ kind: 'offer', hits: result.hits });
        }
        break;
      }
      case 'acceptOffer': {
        const { list: next, added } = addInstances(list, effect.hits);
        setList(next);
        pushLog('info', `${added} INSTANCE${added === 1 ? '' : 'S'} ADDED`);
        break;
      }
      case 'declineOffer':
        pushLog('info', 'SCAN DISCARDED');
        break;
    }
  };

  useInput((input, key) => {
    const result = handleKey(mode, { input, ...key });
    setMode(result.mode);
    for (const effect of result.effects) applyEffect(effect);
  });

  return (
    <>
      <Static items={logs as LogEntry[]}>
        {(entry, index) => (
          <Text key={index} color={props.colors ? levelColor(entry.level) : undefined}>
            {formatTerminalLine(entry)}
          </Text>
        )}
      </Static>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>{formatHeader(list.instances.length, props.url)}</Text>
        {list.instances.map((instance, index) => {
          const isSelected = index === list.selected;
          return (
            <Text
              key={instance.root}
              color={props.colors && instance.loaded ? 'green' : undefined}
              inverse={props.colors && isSelected}
            >
              {(isSelected ? '▸ ' : '  ') + formatInstanceRow(instance)}
            </Text>
          );
        })}
        <StatusLine mode={mode} colors={props.colors} />
      </Box>
    </>
  );
}
