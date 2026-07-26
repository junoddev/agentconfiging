import { VuMeter, Waveform, type ConfigSource } from '../signal/index.js';
import { pluralize } from '../../lib/format.js';
import './components.css';

export interface SignalStripProps {
  /** Agent kind, e.g. "CLAUDE". Archivo 600. */
  kind: string;
  /** Config sources feeding the waveform fingerprint. Pass a stable array. */
  sources: readonly ConfigSource[];
  /** Detector confidence in [0, 1]. */
  confidence: number;
  /** Number of config files detected for this agent. */
  fileCount: number;
  /** Increment on each file event to pulse the fingerprint. */
  pulseKey?: number;
}

/** Agent row (DESIGN.md §6): kind · waveform fingerprint · confidence meter ·
 *  file count. Composes the signal layer; adds no motion of its own. */
export function SignalStrip({ kind, sources, confidence, fileCount, pulseKey }: SignalStripProps) {
  return (
    <div className="strip">
      <span className="strip__kind">{kind}</span>
      <Waveform sources={sources} pulseKey={pulseKey} label={`${kind} fingerprint`} />
      <VuMeter level={confidence} label={`${kind} confidence`} />
      <span className="mono-data strip__count">{pluralize(fileCount, 'file').toUpperCase()}</span>
    </div>
  );
}
