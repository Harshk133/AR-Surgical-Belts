import { useEffect, useRef, useState } from 'react';
import { IconCamera, IconHelp, IconReset, IconStop, IconSwitch } from './icons.jsx';

const ERRORS = {
  denied: {
    title: 'Camera access is blocked',
    steps: [
      'Click the camera icon in the address bar (or open site settings).',
      'Set Camera to "Allow" for this site.',
      'Press "Try again" below.',
    ],
  },
  notfound: {
    title: 'No camera found',
    steps: ['Connect a webcam or use a phone or laptop with a camera.', 'Check that it is enabled in your system privacy settings.'],
  },
  busy: {
    title: 'The camera is busy',
    steps: ['Close other apps or tabs that are using the camera (video calls, other try-ons).', 'Then press "Try again".'],
  },
  insecure: {
    title: 'A secure connection is required',
    steps: ['Open this page over https:// (or http://localhost during development).'],
  },
  unsupported: {
    title: 'This browser cannot use the camera',
    steps: ['Use a recent version of Chrome, Edge, Safari or Firefox.'],
  },
  webgl: {
    title: '3D graphics are unavailable',
    steps: ['Enable hardware acceleration in your browser settings, or try another browser.'],
  },
  ended: {
    title: 'The camera stopped',
    steps: ['The camera was disconnected or released by the system.', 'Press "Try again" to restart it.'],
  },
  unknown: { title: 'Something went wrong', steps: ['Press "Try again". If it keeps happening, reload the page.'] },
};

export default function TryOnViewport({ session, snap, product, testSource, onHelp, onCapture, capturing }) {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const videoRef = useRef(null);
  const imageRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    session.attach({
      container: containerRef.current,
      stage: stageRef.current,
      video: videoRef.current,
      image: imageRef.current,
      canvas: canvasRef.current,
    });
    return () => session.detach();
  }, [session]);

  const { phase, loading, error, tracking, hint, stats, options, cameras, deviceId, calibration } = snap;
  const live = phase === 'calibrating' || phase === 'tracking' || phase === 'manual';
  const start = () => session.start({ testSource });

  return (
    <section className="viewport" aria-label="Live try-on" ref={containerRef}>
      <div className="stage-box">
        <div className="stage" ref={stageRef}>
          <video ref={videoRef} playsInline muted aria-label="Camera preview" />
          <img ref={imageRef} alt="Test input" hidden />
          <canvas ref={canvasRef} aria-hidden="true" />
        </div>
      </div>

      {phase === 'idle' && (
        <div className="overlay">
          <div className="start-card">
            <h2>{product.tryOn.title}</h2>
            <p>{product.tryOn.text}</p>
            <button className="btn primary lg" onClick={start}>
              <IconCamera /> Start try-on
            </button>
            <ul className="tips">{product.tryOn.tips.map((t) => <li key={t}>{t}</li>)}</ul>
            <p className="privacy">Video is processed on your device and never uploaded.</p>
          </div>
        </div>
      )}

      {(phase === 'starting' || loading) && phase !== 'error' && (
        <div className="overlay dim" role="status" aria-live="polite">
          <div className="spinner" />
          <div className="loading-label">{loading?.label || 'Starting…'}</div>
          {loading?.progress != null && (
            <div className="progress"><i style={{ width: `${Math.round(loading.progress * 100)}%` }} /></div>
          )}
        </div>
      )}

      {phase === 'error' && <ErrorPanel error={error} onRetry={start} />}

      {phase === 'calibrating' && !loading && <CalibrationGuide kind={product.kind} stand={product.tryOn.stand} progress={calibration} hint={hint} onSkip={() => session.skipCalibration()} />}

      {live && !loading && (
        <div className="hud-top">
          <StatusPill phase={phase} tracking={tracking} labels={product.facingLabels} limb={product.kind === 'wrist' ? 'hand' : 'arm'} />
          <span className="spacer" />
        </div>
      )}
      {phase === 'manual' && error && <div className="banner" role="status">{error.message}</div>}
      {phase === 'tracking' && hint && <div className="hint" role="status" aria-live="polite">{hint}</div>}
      {live && options.showStats && stats && (
        <div className="stats" aria-hidden="true">
          {`render ${stats.renderFps} fps\n${product.kind === 'wrist' ? 'hand' : 'pose'}   ${stats.detectFps} fps  ${stats.detectMs} ms\n${stats.delegate}/${stats.model}  ${stats.size}\nyaw ${tracking.yawDeg}°${tracking.flipped ? ' (relabelled)' : ''}`}
        </div>
      )}

      <div className="toolbar" role="toolbar" aria-label="Try-on controls">
        {live ? (
          <button className="tool" onClick={() => session.stop()} title="Stop camera">
            <IconStop /> Stop
          </button>
        ) : (
          <button className="tool" onClick={start} disabled={phase === 'starting'} title="Start camera">
            <IconCamera /> Start
          </button>
        )}
        <button className="tool" onClick={() => session.resetAlignment()} disabled={!live} title="Reset alignment and re-calibrate">
          <IconReset /> Reset
        </button>
        <button className="tool capture" onClick={onCapture} disabled={!live || capturing} title="Capture preview" aria-label="Capture preview">
          <span className="shutter" />
        </button>
        <CameraSwitch session={session} cameras={cameras} deviceId={deviceId} disabled={!live || testSource} />
        <button className="tool" onClick={onHelp} title="Positioning guide">
          <IconHelp /> Help
        </button>
      </div>
    </section>
  );
}

function StatusPill({ phase, tracking, labels, limb }) {
  let dot = 'warn';
  let text = 'Looking for you…';
  if (phase === 'manual') {
    dot = 'err';
    text = 'Manual placement';
  } else if (phase === 'calibrating') {
    text = 'Aligning';
  } else if (tracking.valid) {
    dot = tracking.quality > 0.7 ? 'ok' : 'warn';
    const hand = tracking.hand ? `${tracking.hand[0].toUpperCase()}${tracking.hand.slice(1)} ${limb} · ` : '';
    text = `Tracking · ${hand}${labels[tracking.facing] || tracking.facing} (est.)`;
  }
  return (
    <span className="pill" role="status" aria-live="polite">
      <span className={`dot ${dot}`} /> {text}
    </span>
  );
}

function CameraSwitch({ session, cameras, deviceId, disabled }) {
  const many = cameras.length > 1;
  return (
    <span className="tool has-select" aria-disabled={disabled || !many} style={disabled || !many ? { opacity: 0.4 } : undefined}>
      <IconSwitch /> Camera
      {many && !disabled && (
        <select aria-label="Choose camera" value={deviceId || ''} onChange={(e) => session.switchCamera(e.target.value)}>
          {cameras.map((c) => (
            <option key={c.deviceId} value={c.deviceId}>{c.label}</option>
          ))}
        </select>
      )}
    </span>
  );
}

function ErrorPanel({ error, onRetry }) {
  const info = ERRORS[error?.kind] || ERRORS.unknown;
  return (
    <div className="overlay dim">
      <div className="error-card" role="alert">
        <h2>{info.title}</h2>
        {error?.message && <p>{error.message}</p>}
        <ol>{info.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        <div className="row">
          <button className="btn primary" onClick={onRetry}>Try again</button>
          <button className="btn" onClick={() => window.location.reload()}>Reload page</button>
        </div>
      </div>
    </div>
  );
}

function CalibrationGuide({ kind, stand, progress, hint, onSkip }) {
  const [showSkip, setShowSkip] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShowSkip(true), 6000);
    return () => clearTimeout(t);
  }, []);
  const r = 11;
  const c = 2 * Math.PI * r;
  return (
    <>
      <div className="guide" aria-hidden="true">
        {kind === 'elbow' ? (
          <svg viewBox="0 0 200 300">
            {/* head and shoulders at the top, one forearm bent out to the side: elbow to wrist in view */}
            <path className="zone" d="M112 150 L176 112 L186 130 L124 172 Z" />
            <path
              className="outline"
              d="M100 20 a22 26 0 1 1 -0.1 0 M86 70 Q88 80 74 84 L44 92 Q30 98 30 116 L30 230 M114 70 Q112 80 126 84 L150 90 Q164 96 166 112 L170 180 M170 180 L186 112 Q190 100 180 98 L168 102 M58 116 L56 280 M144 116 L146 280"
            />
          </svg>
        ) : kind === 'wrist' ? (
          <svg viewBox="0 0 200 300">
            {/* raised hand with the forearm entering from the bottom: where to hold it */}
            <path className="zone" d="M70 150 L130 150 L136 290 L64 290 Z" />
            <path
              className="outline"
              d="M70 296 L72 170 Q60 160 56 140 L40 108 Q34 96 44 92 Q54 88 60 100 L72 122 L72 52 Q72 40 82 40 Q92 40 92 52 L92 104 L94 34 Q94 22 104 22 Q114 22 114 34 L114 104 L118 42 Q118 30 128 30 Q138 30 138 42 L136 110 L142 62 Q142 52 151 52 Q160 52 160 62 L156 132 Q152 160 130 172 L130 296"
            />
          </svg>
        ) : (
        <svg viewBox="0 0 200 300">
          {/* head, shoulders, torso to hips: where to stand */}
          <path className="zone" d="M58 92 Q100 80 142 92 L150 230 Q100 240 50 230 Z" />
          <path
            className="outline"
            d="M100 18 a26 30 0 1 1 -0.1 0 M84 74 Q86 84 70 88 L40 96 Q26 102 26 120 L26 200 M116 74 Q114 84 130 88 L160 96 Q174 102 174 120 L174 200 M52 120 L50 236 Q100 246 150 236 L148 120"
          />
        </svg>
        )}
      </div>
      <div className="cal-panel" role="status" aria-live="polite">
        <svg className="ring" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
          <circle cx="14" cy="14" r={r} stroke="rgba(255,255,255,.2)" strokeWidth="3" fill="none" />
          <circle
            cx="14" cy="14" r={r} stroke="#4cc08a" strokeWidth="3" fill="none"
            strokeDasharray={c} strokeDashoffset={c * (1 - progress)} transform="rotate(-90 14 14)" strokeLinecap="round"
          />
        </svg>
        <span>{hint || stand}</span>
        {showSkip && <button className="btn small ghost" onClick={onSkip}>Skip</button>}
      </div>
    </>
  );
}
