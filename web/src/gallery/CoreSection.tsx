import { useState } from 'react';
import {
  Button,
  Card,
  ChipRow,
  Dialog,
  DiffPanel,
  EmptyState,
  Field,
  FileChip,
  Heatmap,
  Input,
  ListCard,
  ListRow,
  Notice,
  Pager,
  Pill,
  SearchInput,
  SegmentedControl,
  Select,
  SourceBadge,
  StatBlock,
  Switch,
  Table,
  ToastProvider,
  useToast,
} from '../components/core/index.js';
import { buildDemoDiff, buildDemoHeatmap } from './fixtures.js';

const DEMO_DIFF = buildDemoDiff();
const DEMO_HEATMAP = buildDemoHeatmap();

const SCOPE_CHIPS = [
  { value: 'all', label: 'All scopes' },
  { value: 'project', label: 'Project' },
  { value: 'global', label: 'Global' },
  { value: 'local', label: 'Local' },
] as const;

const APPROVAL_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'] as const;

/** Gallery demos are state specimens — handlers exist only where a real
 *  handler changes the rendered state. */
const noop = () => undefined;

function ToastDemo() {
  const toast = useToast();
  return (
    <div className="gallery__chips">
      <Button label="Save hook" variant="primary" onClick={() => toast('Hook saved')} />
      <Button label="Remove server" variant="destructive" onClick={() => toast('Server removed')} />
      <span className="meta">inverted fg/bg · bottom-right · 2.2s · confirms every mutation</span>
    </div>
  );
}

/** Core components — Console §5 contract, every shipped state and variant.
 *  Flip the theme toggle to verify both themes. */
export function CoreSection() {
  const [switchOn, setSwitchOn] = useState(true);
  const [chip, setChip] = useState('all');
  const [mode, setMode] = useState<string>('acceptEdits');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [rowOn, setRowOn] = useState<Record<string, boolean>>({ prettier: true, notify: false });

  return (
    <ToastProvider>
      <section className="page__section" id="core-components">
        <h2 className="table-header">Core components · §5 contract</h2>

        <div className="gallery__demo">
          <h3 className="micro-label">BUTTONS · .btn-*</h3>
          <div className="gallery__chips">
            <Button label="Save hook" variant="primary" />
            <Button label="Cancel" variant="secondary" />
            <Button label="View" variant="ghost" />
            <Button label="Remove" variant="destructive" />
          </div>
          <div className="gallery__chips">
            <Button label="Save hook" variant="primary" disabled />
            <Button label="Cancel" variant="secondary" disabled />
            <Button label="View" variant="ghost" disabled />
            <Button label="Remove" variant="destructive" disabled />
          </div>
        </div>

        <div className="gallery__demo">
          <h3 className="micro-label">SCOPE BADGES · .scope.s-*</h3>
          <div className="gallery__chips">
            <SourceBadge scope="project" />
            <SourceBadge scope="global" detail="~/.claude" />
            <SourceBadge scope="global" detail="~/.claude" readOnly />
            <SourceBadge scope="local" detail="gitignored" />
            <SourceBadge scope="default" />
          </div>
        </div>

        <div className="gallery__demo">
          <h3 className="micro-label">STATUS PILLS · .pill.p-*</h3>
          <div className="gallery__chips">
            <Pill tone="ok">valid</Pill>
            <Pill tone="ok">connected</Pill>
            <Pill tone="warn">check</Pill>
            <Pill tone="err">error</Pill>
            <Pill tone="off">disabled</Pill>
          </div>
        </div>

        <div className="gallery__demo">
          <h3 className="micro-label">SWITCH · .switch</h3>
          <div className="gallery__chips">
            <Switch on={switchOn} onChange={setSwitchOn} label="Demo switch" />
            <span className="meta">{switchOn ? 'on' : 'off'} · click to toggle</span>
            <Switch on onChange={noop} label="Disabled on" disabled />
            <Switch on={false} onChange={noop} label="Disabled off" disabled />
            <span className="meta">disabled</span>
          </div>
        </div>

        <div className="gallery__demo">
          <h3 className="micro-label">STAT TILES · .tile</h3>
          <div className="tile-row">
            <StatBlock value={6} label="Rules" onClick={noop} />
            <StatBlock value={4} label="Hooks" delta={1} onClick={noop} />
            <StatBlock value={3} label="MCP servers" delta={-1} />
            <StatBlock value="98%" label="Cache hit" delta={0} />
          </div>
        </div>

        <div className="gallery__demo">
          <h3 className="micro-label">DATA TABLE · .ds-table IN .table-card</h3>
          <Table headers={['File', 'Scope', 'Keys', 'Status']}>
            <tr>
              <td className="mono">~/.claude/settings.json</td>
              <td>
                <SourceBadge scope="global" />
              </td>
              <td className="num-col">14</td>
              <td>
                <Pill tone="ok">valid</Pill>
              </td>
            </tr>
            <tr>
              <td className="mono">.claude/settings.json</td>
              <td>
                <SourceBadge scope="project" />
              </td>
              <td className="num-col">6</td>
              <td>
                <Pill tone="ok">valid</Pill>
              </td>
            </tr>
            <tr>
              <td className="mono">.mcp.json</td>
              <td>
                <SourceBadge scope="project" />
              </td>
              <td className="num-col">4</td>
              <td>
                <Pill tone="warn">check</Pill>
              </td>
            </tr>
          </Table>
        </div>

        <div className="gallery__demo">
          <h3 className="micro-label">WIN VALUES · .win</h3>
          <Table headers={['Key', 'Global', 'Project', 'Effective']}>
            <tr>
              <td className="mono">model</td>
              <td className="mono">&quot;opus&quot;</td>
              <td className="mono">&quot;sonnet&quot;</td>
              <td>
                <span className="mono win">&quot;sonnet&quot;</span> <SourceBadge scope="project" />
              </td>
            </tr>
            <tr>
              <td className="mono">autoUpdates</td>
              <td className="mono">true</td>
              <td className="mono">—</td>
              <td>
                <span className="mono win">true</span> <SourceBadge scope="global" />
              </td>
            </tr>
          </Table>
        </div>

        <div className="gallery__demo">
          <h3 className="micro-label">LIST CARD · .list-card / .lc-head / .list-row</h3>
          <ListCard head="PROJECT SCOPE" headMeta="2 hooks">
            <ListRow
              leading={
                <Switch
                  on={rowOn.prettier ?? false}
                  onChange={(v) => setRowOn((s) => ({ ...s, prettier: v }))}
                  label="Toggle prettier hook"
                />
              }
              title="PostToolUse"
              badge={<SourceBadge scope="project" />}
              sub='npx prettier --write "$FILE" — runs after every Edit or Write'
              trailing={<Button label="View" variant="ghost" />}
            />
            <ListRow
              leading={
                <Switch
                  on={rowOn.notify ?? false}
                  onChange={(v) => setRowOn((s) => ({ ...s, notify: v }))}
                  label="Toggle notify hook"
                />
              }
              title="Stop"
              badge={<SourceBadge scope="global" detail="~/.claude" />}
              sub="~/.claude/hooks/notify-done.sh — a long sub-line that should ellipsize rather than wrap when the row runs out of horizontal room"
              trailing={<Button label="View" variant="ghost" />}
            />
          </ListCard>
        </div>

        <div className="gallery__demo">
          <h3 className="micro-label">FILTER CHIPS · .chip-row / .chip</h3>
          <div className="gallery__chips">
            <ChipRow options={SCOPE_CHIPS} value={chip} onChange={setChip} label="Scope filter" />
            <span className="meta">active: {chip}</span>
          </div>
        </div>

        <div className="gallery__demo">
          <h3 className="micro-label">SEGMENTED · .seg</h3>
          <SegmentedControl
            options={APPROVAL_MODES}
            value={mode}
            onChange={setMode}
            label="Approval policy"
          />
        </div>

        <div className="gallery__demo">
          <h3 className="micro-label">SEARCH · .search</h3>
          <div className="gallery__chips">
            <SearchInput value={query} onChange={setQuery} placeholder="Filter settings…" />
            <span className="meta">{query === '' ? 'empty' : `query: ${query}`}</span>
          </div>
        </div>

        <div className="gallery__demo">
          <h3 className="micro-label">PAGER · .pager</h3>
          <Pager page={page} pageSize={20} total={42} onPage={setPage} />
          <Pager page={1} pageSize={20} total={0} onPage={noop} />
        </div>

        <div className="gallery__demo">
          <h3 className="micro-label">NOTICES · .notice / .notice-info</h3>
          <Notice>
            <strong>Codex has no lifecycle hooks.</strong> The closest equivalent is the notify
            command for turn events — shown here instead.
          </Notice>
          <Notice tone="info">
            Values merge global → project; project wins on conflict. Provenance is always visible.
          </Notice>
        </div>

        <div className="gallery__demo">
          <h3 className="micro-label">CARD · .card</h3>
          <Card title="Health">
            <p>
              Cards are surface + hairline at radius-lg. No shadow at rest — hairlines do all
              separation work.
            </p>
          </Card>
        </div>

        <div className="gallery__demo">
          <h3 className="micro-label">FIELD / INPUT · .field / .input</h3>
          <Card>
            <Field label="Matcher" htmlFor="demo-matcher">
              <Input id="demo-matcher" placeholder="e.g. Bash, Edit|Write, *" defaultValue="*" />
            </Field>
            <Field label="Event" htmlFor="demo-event">
              <Select id="demo-event" defaultValue="PreToolUse">
                <option>PreToolUse</option>
                <option>PostToolUse</option>
                <option>Stop</option>
              </Select>
            </Field>
          </Card>
        </div>

        <div className="gallery__demo">
          <h3 className="micro-label">DIALOG · .modal-head / .modal-body / .modal-foot</h3>
          <div className="gallery__chips">
            <Button label="Add hook" variant="primary" onClick={() => setDialogOpen(true)} />
            <span className="meta">560px max · hairline separators · Esc or ✕ closes</span>
          </div>
          <Dialog
            open={dialogOpen}
            title="Add hook"
            onClose={() => setDialogOpen(false)}
            footer={
              <>
                <Button label="Cancel" onClick={() => setDialogOpen(false)} />
                <Button label="Save hook" variant="primary" onClick={() => setDialogOpen(false)} />
              </>
            }
          >
            <Field label="Command" htmlFor="demo-dialog-cmd">
              <Input id="demo-dialog-cmd" placeholder="./scripts/my-hook.sh" />
            </Field>
            <Field label="Scope" htmlFor="demo-dialog-scope">
              <Select id="demo-dialog-scope">
                <option>project</option>
                <option>global</option>
              </Select>
            </Field>
          </Dialog>
        </div>

        <div className="gallery__demo">
          <h3 className="micro-label">TOAST · .toast</h3>
          <ToastDemo />
        </div>

        <div className="gallery__demo">
          <h3 className="micro-label">PERM CHIPS · .perm-chip</h3>
          <div className="perm-wrap">
            <span className="perm-chip">
              Bash(npm run *) <SourceBadge scope="project" />
              <button type="button" className="x" title="Remove" onClick={noop}>
                ✕
              </button>
            </span>
            <span className="perm-chip">
              Read(~/dev/**) <SourceBadge scope="global" />
              <button type="button" className="x" title="Remove" onClick={noop}>
                ✕
              </button>
            </span>
          </div>
        </div>

        <div className="gallery__demo">
          <h3 className="micro-label">FILE CHIP · .code</h3>
          <div className="gallery__chips">
            <FileChip path="CLAUDE.md" size={3120} sha="a1b2c3d4" onClick={noop} />
            <FileChip path=".claude/settings.json" size={512} sha="9f8e7d6c" />
            <FileChip path=".codex/config.toml" />
          </div>
        </div>

        <div className="gallery__demo">
          <h3 className="micro-label">DIFF PANEL</h3>
          <DiffPanel label=".gitignore" hunks={DEMO_DIFF} onCommit={noop} onDiscard={noop} />
        </div>

        <div className="gallery__demo">
          <h3 className="micro-label">DIFF PANEL · READ-ONLY</h3>
          <DiffPanel hunks={DEMO_DIFF} />
        </div>

        <div className="gallery__demo">
          <h3 className="micro-label">HEATMAP</h3>
          <Heatmap cells={DEMO_HEATMAP} label="demo activity calendar" />
        </div>

        <div className="gallery__demo">
          <h3 className="micro-label">EMPTY STATES · §7 VOICE</h3>
          <Card>
            <EmptyState instruction='No settings match "verbose". Clear the search to see all 42.' />
          </Card>
          <Card>
            <EmptyState
              title="No hooks yet"
              instruction="This project defines no hooks. Add one to run commands on lifecycle events."
            />
          </Card>
        </div>
      </section>
    </ToastProvider>
  );
}
