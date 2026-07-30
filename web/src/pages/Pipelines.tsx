/**
 * Pipelines (rail `24 PIPELINES`, route `#/pipelines`) — the VISUAL WORKFLOW
 * BUILDER (SPEC §5 row 12, E9, bead agentconfig-ira.2). A React Flow canvas with
 * a 14-type node PALETTE, custom HAIRLINE-BOX nodes (DESIGN §6), 1px right-angled
 * `step` edges, and a themed MiniMap. Select a node to edit its typed config in
 * the side panel; SAVE/LOAD persist the graph as a Pipeline; RUN executes it on
 * the server and colours nodes by LIVE per-node status (§5).
 *
 * SECURITY / TRUST: a pipeline is UNTRUSTED user config. Running it executes the
 * COMMITTED guarded server executor (bash/http/file/git bounded + scoped to the
 * instance root) — this page never runs anything itself; the run POST is CSRF-
 * gated by the server. Every config/output value is rendered as a TEXT NODE
 * (nodeSummary / the config panel inputs) — never markup. React Flow owns its own
 * canvas DOM; its stylesheet is bundled by vite (no external fetch).
 *
 * CLIENT SEAM: like Git/Marketplace, the shell keeps its ApiClient private, so
 * this page captures the launch token at module load and builds its own client.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import type { Connection, Edge, Node, NodeTypes, OnConnect } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ApiClient,
  ApiError,
  type PipelineNode,
  type PipelineNodeType,
  type PipelineSchedule,
  type PipelineSummary,
  type RunHistoryEntry,
  type RunSnapshot,
} from '../api/index.js';
import { bootstrapToken } from '../api/token.js';
import { Button, Notice, Pill, Switch, useToast, type PillTone } from '../components/core/index.js';
import { useAppState } from '../state/index.js';
import { AgentConfigNode } from './pipelines/AgentConfigNode.js';
import { NodeConfigPanel } from './pipelines/NodeConfigPanel.js';
import { RunHistory } from './pipelines/RunHistory.js';
import { SCHEDULE_PRESETS, formatLastRun, formatNextRun } from './pipelines/schedule.js';
import {
  AGENTCONFIG_NODE,
  PALETTE,
  applyRunStatus,
  defaultNodeConfig,
  graphToPipeline,
  makePipelineId,
  nextNodeId,
  pipelineToGraph,
  uniqueNodeName,
  type FlowNodeData,
} from './pipelines/logic.js';
import './pipelines.css';

const bootToken = typeof window !== 'undefined' ? bootstrapToken() : undefined;

/** Stable node/edge type maps (React Flow requires a stable reference). */
const nodeTypes: NodeTypes = { [AGENTCONFIG_NODE]: AgentConfigNode };
const defaultEdgeOptions = { type: 'step' as const };

type Phase = 'loading' | 'ok' | 'error';

/** Parse the run-input textbox: JSON when it parses, else the raw string; '' → undefined. */
function parseInput(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return text;
  }
}

/** Pill tone for a live run status. */
function runPillTone(status: string): PillTone {
  if (status === 'running') return 'warn';
  if (status === 'ok') return 'ok';
  if (status === 'error') return 'err';
  return 'off';
}

function PipelinesPanel() {
  const { currentInstance } = useAppState();
  const instanceId = currentInstance?.id;
  const client = useMemo(() => (bootToken ? new ApiClient(bootToken) : undefined), []);
  const toast = useToast();

  const [phase, setPhase] = useState<Phase>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [list, setList] = useState<PipelineSummary[]>([]);

  const [pipelineId, setPipelineId] = useState<string>(() => makePipelineId());
  const [pipelineName, setPipelineName] = useState('Untitled');
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const [inputText, setInputText] = useState('');
  const [runId, setRunId] = useState<string | undefined>();
  const [run, setRun] = useState<RunSnapshot | undefined>();
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();

  const [history, setHistory] = useState<RunHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>();
  const [replay, setReplay] = useState<RunSnapshot | undefined>();

  const [cronText, setCronText] = useState('@daily');
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [schedule, setSchedule] = useState<PipelineSchedule | null>(null);
  const [nextRun, setNextRun] = useState<number | null>(null);
  const [scheduleNotice, setScheduleNotice] = useState<string | undefined>();

  const refreshList = useCallback(async () => {
    if (!client) return;
    setList(await client.listPipelines());
  }, [client]);

  const refreshHistory = useCallback(
    async (id: string) => {
      if (!client) return;
      setHistoryLoading(true);
      try {
        setHistory(await client.listRuns(id));
      } catch {
        // A pipeline that was never saved has no run history — an empty list is
        // the honest state, not an error.
        setHistory([]);
      } finally {
        setHistoryLoading(false);
      }
    },
    [client],
  );

  const refreshSchedule = useCallback(
    async (id: string) => {
      if (!client) return;
      try {
        const res = await client.getSchedule(id);
        setSchedule(res.schedule);
        setNextRun(res.nextRun);
        if (res.schedule) {
          setCronText(res.schedule.cron);
          setScheduleEnabled(res.schedule.enabled);
        } else {
          setScheduleEnabled(false);
        }
      } catch {
        // A never-saved pipeline has no schedule — the honest state is "none".
        setSchedule(null);
        setNextRun(null);
        setScheduleEnabled(false);
      }
    },
    [client],
  );

  // Load the run history + schedule for whichever pipeline is on the canvas, and
  // clear any open replay, whenever the pipeline id changes (new / load).
  useEffect(() => {
    setSelectedRunId(undefined);
    setReplay(undefined);
    setScheduleNotice(undefined);
    void refreshHistory(pipelineId);
    void refreshSchedule(pipelineId);
  }, [pipelineId, refreshHistory, refreshSchedule]);

  // When a run finishes, refresh the history so the new run appears in the list.
  useEffect(() => {
    if (!running && runId !== undefined) void refreshHistory(pipelineId);
  }, [running, runId, pipelineId, refreshHistory]);

  const onSelectRun = useCallback(
    async (rid: string) => {
      if (!client) return;
      setSelectedRunId(rid);
      try {
        // The detail is REDACTED server-side — safe to render as text nodes.
        setReplay(await client.getRun(rid));
      } catch {
        setReplay(undefined);
      }
    },
    [client],
  );

  useEffect(() => {
    if (!client) {
      setPhase('error');
      setErrMsg('session token missing — reopen from the CLI');
      return;
    }
    void (async () => {
      try {
        await refreshList();
        setPhase('ok');
      } catch (err) {
        setPhase('error');
        setErrMsg(err instanceof ApiError ? err.message : 'could not reach the local server');
      }
    })();
  }, [client, refreshList]);

  // LIVE run polling: while a run is in flight, poll its snapshot every 400ms and
  // stop once it finishes. The snapshot colours the nodes (applyRunStatus below).
  useEffect(() => {
    if (!runId || !client) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const snap = await client.getRun(runId);
        if (!active) return;
        setRun(snap);
        if (snap.finishedAt !== undefined) {
          setRunning(false);
          return;
        }
      } catch {
        if (active) setRunning(false);
        return;
      }
      if (active) timer = setTimeout(() => void poll(), 400);
    };
    timer = setTimeout(() => void poll(), 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [runId, client]);

  const displayNodes = useMemo(() => applyRunStatus(nodes, run), [nodes, run]);
  const selected = nodes.find((n) => n.selected);
  const selectedConfig = selected ? (selected.data as FlowNodeData).config : undefined;

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => setEdges((es) => addEdge({ ...connection, type: 'step' }, es)),
    [setEdges],
  );

  const addNode = useCallback(
    (type: PipelineNodeType) => {
      setNodes((ns) => {
        const id = nextNodeId(ns.map((n) => n.id));
        const name = uniqueNodeName(
          type,
          ns.map((n) => (n.data as FlowNodeData).config.name),
        );
        const config = defaultNodeConfig(type, id, name);
        const node: Node = {
          id,
          type: AGENTCONFIG_NODE,
          position: { x: 40 + (ns.length % 5) * 30, y: 40 + ns.length * 24 },
          data: { config } satisfies FlowNodeData,
        };
        return [...ns, node];
      });
    },
    [setNodes],
  );

  const updateConfig = useCallback(
    (next: PipelineNode) => {
      setNodes((ns) =>
        ns.map((n) =>
          n.id === next.id ? { ...n, data: { ...(n.data as FlowNodeData), config: next } } : n,
        ),
      );
    },
    [setNodes],
  );

  const deleteSelected = useCallback(() => {
    if (!selected) return;
    const id = selected.id;
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
  }, [selected, setNodes, setEdges]);

  const onNew = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setPipelineId(makePipelineId());
    setPipelineName('Untitled');
    setRun(undefined);
    setRunId(undefined);
    setNotice(undefined);
  }, [setNodes, setEdges]);

  const onLoad = useCallback(
    async (id: string) => {
      if (!client) return;
      try {
        const pipeline = await client.getPipeline(id);
        const graph = pipelineToGraph(pipeline);
        setNodes(graph.nodes);
        setEdges(graph.edges);
        setPipelineId(pipeline.id);
        setPipelineName(pipeline.name);
        setRun(undefined);
        setRunId(undefined);
        setNotice(undefined);
      } catch (err) {
        setNotice(err instanceof ApiError ? err.message : 'load failed');
      }
    },
    [client, setNodes, setEdges],
  );

  const onSave = useCallback(async () => {
    if (!client) return;
    const pipeline = graphToPipeline(pipelineId, pipelineName.trim() || 'Untitled', nodes, edges);
    try {
      await client.savePipeline(pipeline);
      setNotice(undefined);
      toast('Pipeline saved');
      await refreshList();
    } catch (err) {
      // A 400's message is the joined validatePipeline errors — surface them.
      setNotice(err instanceof ApiError ? err.message : 'save failed');
    }
  }, [client, pipelineId, pipelineName, nodes, edges, refreshList, toast]);

  const onRun = useCallback(async () => {
    if (!client) return;
    const pipeline = graphToPipeline(pipelineId, pipelineName.trim() || 'Untitled', nodes, edges);
    try {
      // Persist the current graph, then run it (the server validates + guards).
      await client.savePipeline(pipeline);
      await refreshList();
      const { runId: id } = await client.runPipeline(pipelineId, parseInput(inputText), instanceId);
      setRun(undefined);
      setRunId(id);
      setRunning(true);
      setNotice(undefined);
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'run failed');
    }
  }, [client, pipelineId, pipelineName, nodes, edges, inputText, instanceId, refreshList]);

  const onDelete = useCallback(
    async (id: string) => {
      if (!client) return;
      try {
        await client.deletePipeline(id);
        toast('Pipeline deleted');
        await refreshList();
        if (id === pipelineId) onNew();
      } catch (err) {
        setNotice(err instanceof ApiError ? err.message : 'delete failed');
      }
    },
    [client, pipelineId, refreshList, onNew, toast],
  );

  const onSaveSchedule = useCallback(async () => {
    if (!client) return;
    const cron = cronText.trim();
    if (cron === '') {
      setScheduleNotice('enter a cron expression or preset');
      return;
    }
    const pipeline = graphToPipeline(pipelineId, pipelineName.trim() || 'Untitled', nodes, edges);
    try {
      // The schedule route needs the pipeline to exist — persist it first.
      await client.savePipeline(pipeline);
      await refreshList();
      const res = await client.setSchedule(pipelineId, cron, scheduleEnabled, instanceId);
      setSchedule(res.schedule);
      setNextRun(res.nextRun);
      setScheduleNotice(undefined);
      toast('Schedule saved');
    } catch (err) {
      // A 400's message is the cron validation error — surface it.
      setScheduleNotice(err instanceof ApiError ? err.message : 'schedule save failed');
    }
  }, [
    client,
    cronText,
    pipelineId,
    pipelineName,
    nodes,
    edges,
    scheduleEnabled,
    instanceId,
    refreshList,
    toast,
  ]);

  if (phase === 'error') {
    return (
      <main className="layout-main page">
        <section className="page__section">
          <div className="page-head">
            <h1>Pipelines</h1>
          </div>
          <Notice>{errMsg}</Notice>
        </section>
      </main>
    );
  }

  const runStatus = running ? 'running' : (run?.status ?? undefined);

  return (
    <main className="layout-main page pipeline-page">
      <section className="page__section pipeline-toolbar">
        <h1>Pipelines</h1>
        <input
          className="input pipeline-name"
          aria-label="pipeline name"
          value={pipelineName}
          onChange={(e) => setPipelineName(e.target.value)}
        />
        <input
          className="input mono pipeline-runinput"
          aria-label="run input"
          placeholder="run input ({{input}}) — text or JSON"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
        />
        <div className="pipeline-toolbar__actions">
          <Button label="New" onClick={onNew} />
          <Button label="Save" onClick={() => void onSave()} />
          <Button
            label={running ? 'Running…' : 'Run'}
            variant="primary"
            disabled={running}
            onClick={() => void onRun()}
          />
        </div>
        {runStatus !== undefined && <Pill tone={runPillTone(runStatus)}>run {runStatus}</Pill>}
      </section>

      {notice !== undefined && (
        <section className="page__section">
          <Notice>
            <span role="status">{notice}</span>
          </Notice>
        </section>
      )}

      <section className="page__section pipeline-schedule">
        <span className="micro-label">SCHEDULE</span>
        <input
          className="input mono pipeline-schedule__cron"
          aria-label="cron schedule"
          list="pipeline-schedule-presets"
          placeholder="cron (min hour dom mon dow) or a @preset"
          value={cronText}
          onChange={(e) => setCronText(e.target.value)}
        />
        <datalist id="pipeline-schedule-presets">
          {SCHEDULE_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </datalist>
        <span className="pipeline-schedule__toggle">
          <Switch on={scheduleEnabled} onChange={setScheduleEnabled} label="schedule enabled" />
          <span className="meta">enabled</span>
        </span>
        <Button label="Save schedule" onClick={() => void onSaveSchedule()} />
        <span className="meta">
          next {formatNextRun(nextRun)} · last {formatLastRun(schedule?.lastRunAt)}
        </span>
        <span className="meta">
          schedules run via <span className="code">agentconfiging daemon</span> (the UI only sets
          them)
        </span>
      </section>

      {scheduleNotice !== undefined && (
        <section className="page__section">
          <Notice>
            <span role="status">{scheduleNotice}</span>
          </Notice>
        </section>
      )}

      <section className="page__section pipeline-workspace">
        <div className="pipeline-palette">
          <span className="micro-label pipeline-palette__title">NODES</span>
          {PALETTE.map((item) => (
            <button
              key={item.type}
              type="button"
              className="pipeline-palette__item micro-label"
              onClick={() => addNode(item.type)}
            >
              + {item.label}
            </button>
          ))}
          <span className="micro-label pipeline-palette__title pipeline-palette__saved">SAVED</span>
          {list.length === 0 ? (
            <span className="meta">none yet</span>
          ) : (
            list.map((p) => (
              <div key={p.id} className="pipeline-saved">
                <button
                  type="button"
                  className="pipeline-saved__open micro-label"
                  onClick={() => void onLoad(p.id)}
                >
                  {p.name}
                </button>
                <button
                  type="button"
                  className="pipeline-saved__del micro-label"
                  aria-label={`delete ${p.name}`}
                  onClick={() => void onDelete(p.id)}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>

        <div className="pipeline-canvas">
          {nodes.length === 0 && (
            <div className="pipeline-canvas__hint micro-label">
              add nodes from the palette, connect them, then save or run
            </div>
          )}
          <ReactFlow
            nodes={displayNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} />
            <Controls />
            <MiniMap pannable zoomable className="pipeline-minimap" />
          </ReactFlow>
        </div>

        {selectedConfig !== undefined && (
          <NodeConfigPanel
            node={selectedConfig}
            onChange={updateConfig}
            onDelete={deleteSelected}
          />
        )}
      </section>

      <section className="page__section pipeline-history-section">
        <RunHistory
          runs={history}
          replay={replay}
          selectedRunId={selectedRunId}
          loading={historyLoading}
          canRerun={nodes.length > 0 && !running}
          onSelect={(rid) => void onSelectRun(rid)}
          onRerun={() => void onRun()}
        />
      </section>
    </main>
  );
}

export function Pipelines() {
  // Toasts confirm through the shell-level ToastProvider (App.tsx).
  return <PipelinesPanel />;
}
