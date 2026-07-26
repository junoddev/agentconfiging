import {
  Button,
  DiffPanel,
  EmptyState,
  FileChip,
  FindingRow,
  SignalStrip,
  StatBlock,
  Table,
} from '../components/core/index.js';
import { CLAUDE_SOURCES, CODEX_SOURCES, buildDemoDiff, buildDemoFindings } from './fixtures.js';

const DEMO_DIFF = buildDemoDiff();
const DEMO_FINDINGS = buildDemoFindings();

/** Gallery demos are state specimens — handlers exist only where a real
 *  handler changes the rendered state (e.g. [APPLY] appears at all). */
const noop = () => undefined;

/** Core components (DESIGN.md §6) in every shipped state and variant.
 *  Pure chassis — nothing here animates. */
export function CoreSection() {
  return (
    <section className="page__section" id="core-components">
      <h2 className="micro-label">CORE COMPONENTS</h2>

      <div className="gallery__demo">
        <h3 className="micro-label">BUTTON</h3>
        <div className="gallery__chips">
          <Button label="install" />
          <Button label="apply" variant="primary" />
          <Button label="discard" variant="destructive" />
        </div>
        <div className="gallery__chips">
          <Button label="install" disabled />
          <Button label="apply" variant="primary" disabled />
          <Button label="discard" variant="destructive" disabled />
        </div>
      </div>

      <div className="gallery__demo">
        <h3 className="micro-label">STATBLOCK</h3>
        <div className="grid-page">
          <div style={{ gridColumn: 'span 3' }}>
            <StatBlock value={2} label="AGENTS" />
          </div>
          <div className="col-rule" style={{ gridColumn: 'span 3' }}>
            <StatBlock value={14} label="ARTIFACTS" delta={3} />
          </div>
          <div className="col-rule" style={{ gridColumn: 'span 3' }}>
            <StatBlock value={3} label="WARNINGS" delta={-1} size="md" />
          </div>
          <div className="col-rule" style={{ gridColumn: 'span 3' }}>
            <StatBlock value="98%" label="CACHE HIT" delta={0} size="md" />
          </div>
        </div>
      </div>

      <div className="gallery__demo">
        <h3 className="micro-label">SIGNALSTRIP</h3>
        <SignalStrip kind="CLAUDE" sources={CLAUDE_SOURCES} confidence={0.9} fileCount={2} />
        <SignalStrip kind="CODEX" sources={CODEX_SOURCES} confidence={0.65} fileCount={2} />
      </div>

      <div className="gallery__demo">
        <h3 className="micro-label">FINDINGROW</h3>
        {DEMO_FINDINGS.map((f) => (
          <FindingRow
            key={f.index}
            index={f.index}
            severity={f.severity}
            title={f.title}
            fix={f.fix}
            onApply={f.applicable ? noop : undefined}
          />
        ))}
      </div>

      <div className="gallery__demo">
        <h3 className="micro-label">FILECHIP</h3>
        <div className="gallery__chips">
          <FileChip path="CLAUDE.md" size={3120} sha="a1b2c3d4" onClick={noop} />
          <FileChip path=".claude/settings.json" size={512} sha="9f8e7d6c" />
          <FileChip path=".codex/config.toml" />
        </div>
      </div>

      <div className="gallery__demo">
        <h3 className="micro-label">DIFFPANEL</h3>
        <DiffPanel label=".gitignore" hunks={DEMO_DIFF} onCommit={noop} onDiscard={noop} />
      </div>

      <div className="gallery__demo">
        <h3 className="micro-label">DIFFPANEL · READ-ONLY</h3>
        <DiffPanel hunks={DEMO_DIFF} />
      </div>

      <div className="gallery__demo">
        <h3 className="micro-label">TABLE</h3>
        <Table headers={['NO', 'KIND', 'FILES']}>
          <tr>
            <td>01</td>
            <td>CLAUDE</td>
            <td>2</td>
          </tr>
          <tr>
            <td>02</td>
            <td>CODEX</td>
            <td>2</td>
          </tr>
        </Table>
      </div>

      <div className="gallery__demo">
        <h3 className="micro-label">TABLE · HEADLESS</h3>
        <Table>
          <tr>
            <td>CLAUDE.md</td>
            <td>3.0 KB</td>
          </tr>
          <tr>
            <td>AGENTS.md</td>
            <td>5.8 KB</td>
          </tr>
        </Table>
      </div>

      <div className="gallery__demo">
        <h3 className="micro-label">EMPTYSTATE</h3>
        <EmptyState instruction="add a folder to begin watching" />
      </div>

      <div className="gallery__demo">
        <h3 className="micro-label">EMPTYSTATE · CUSTOM TITLE</h3>
        <EmptyState title="NO MATCHES" instruction="clear the filter to see all findings" />
      </div>
    </section>
  );
}
