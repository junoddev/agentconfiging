import { useState } from 'react';
import { Button } from '../components/core/index.js';
import { LiveDot, SweepOverlay, VuMeter, Waveform } from '../components/signal/index.js';
import { CLAUDE_SOURCES, CODEX_SOURCES, VU_LEVELS } from './fixtures.js';

/** Signal-layer primitives in every state: live and reduced-motion
 *  waveforms, the VU sweep including the warn range, LIVE/OFFLINE dots,
 *  and the rescan sweep. The only section that moves. */
export function SignalSection() {
  const [pulseKey, setPulseKey] = useState(0);
  const [sweepKey, setSweepKey] = useState(0);

  return (
    <section className="page__section" id="signal-primitives">
      <h2 className="micro-label">SIGNAL PRIMITIVES</h2>

      <div className="gallery__demo">
        <h3 className="micro-label">WAVEFORM</h3>
        <div className="row">
          <Waveform sources={CLAUDE_SOURCES} pulseKey={pulseKey} label="claude fingerprint" />
          <span className="mono-data">LIVE · CLAUDE SOURCES</span>
        </div>
        <div className="row">
          <Waveform sources={CODEX_SOURCES} pulseKey={pulseKey} label="codex fingerprint" />
          <span className="mono-data">LIVE · CODEX SOURCES</span>
        </div>
        <div className="row">
          <Waveform sources={CLAUDE_SOURCES} reducedMotion label="claude fingerprint, static" />
          <span className="mono-data">REDUCED MOTION · STATIC TRACE</span>
        </div>
        <div className="gallery__chips">
          <Button label="file event" onClick={() => setPulseKey((k) => k + 1)} />
        </div>
      </div>

      <div className="gallery__demo">
        <h3 className="micro-label">VU METER</h3>
        {VU_LEVELS.map((level) => (
          <div key={level} className="row">
            <VuMeter level={level} label={`demo level ${level}`} />
            <span className="mono-data">{level.toFixed(2)}</span>
          </div>
        ))}
        <div className="row">
          <VuMeter level={0.9} segments={16} label="demo 16 segments" />
          <span className="mono-data">0.90 · 16 SEGMENTS</span>
        </div>
      </div>

      <div className="gallery__demo">
        <h3 className="micro-label">LIVE DOT</h3>
        <div className="row">
          <LiveDot connected />
          <span className="mono-data">CONNECTED · 1.2S PULSE</span>
        </div>
        <div className="row">
          <LiveDot connected reducedMotion />
          <span className="mono-data">CONNECTED · REDUCED MOTION</span>
        </div>
        <div className="row">
          <LiveDot connected={false} />
          <span className="mono-data">DISCONNECTED · HOLLOW</span>
        </div>
      </div>

      <div className="gallery__demo">
        <h3 className="micro-label">RESCAN SWEEP</h3>
        <div className="surface sweep-panel">
          <span className="micro-label">PANEL UNDER RE-ANALYSIS</span>
          <div className="gallery__chips">
            <Button label="rescan" onClick={() => setSweepKey((k) => k + 1)} />
          </div>
          <SweepOverlay sweepKey={sweepKey} />
        </div>
      </div>
    </section>
  );
}
