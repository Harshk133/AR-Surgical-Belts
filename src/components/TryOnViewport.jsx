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

const FACING_LABEL = { front: 'Front view', side: 'Side view', back: 'Back view' };

export default function TryOnViewport({ session, snap, testSource, onHelp, onCapture, capturing }) {
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
            <h2>See the brace on you</h2>
            <p>Use your camera to preview the Taylor's Brace on your own torso. Turn to see the sides, and turn around for the back.</p>
            <button className="btn primary lg" onClick={start}>
              <IconCamera /> Start try-on
            </button>
            <ul className="tips">
              <li>Stand 1.5–2 m from the camera with your shoulders and waist in view.</li>
              <li>Wear fitted, plain clothing in even, front-facing light.</li>
              <li>Hold still for a second while the brace aligns.</li>
            </ul>
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

      {phase === 'calibrating' && !loading && <CalibrationGuide progress={calibration} hint={hint} onSkip={() => session.skipCalibration()} />}

      {live && !loading && (
        <div className="hud-top">
          <StatusPill phase={phase} tracking={tracking} />
          <span className="spacer" />
        </div>
      )}
      {phase === 'manual' && error && <div className="banner" role="status">{error.message}</div>}
      {phase === 'tracking' && hint && <div className="hint" role="status" aria-live="polite">{hint}</div>}
      {live && options.showStats && stats && (
        <div className="stats" aria-hidden="true">
          {`render ${stats.renderFps} fps\npose   ${stats.detectFps} fps  ${stats.detectMs} ms\n${stats.delegate}/${stats.model}  ${stats.size}\nyaw ${tracking.yawDeg}°${tracking.flipped ? ' (relabelled)' : ''}`}
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

function StatusPill({ phase, tracking }) {
  let dot = 'warn';
  let text = 'Looking for you…';
  if (phase === 'manual') {
    dot = 'err';
    text = 'Manual placement';
  } else if (phase === 'calibrating') {
    text = 'Aligning';
  } else if (tracking.valid) {
    dot = tracking.quality > 0.7 ? 'ok' : 'warn';
    text = `Tracking · ${FACING_LABEL[tracking.facing]} (est.)`;
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

function CalibrationGuide({ progress, hint, onSkip }) {
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
        <svg viewBox="0 0 200 300">
          {/* head, shoulders, torso to hips: where to stand */}
          <path className="zone" d="M58 92 Q100 80 142 92 L150 230 Q100 240 50 230 Z" />
          <path
            className="outline"
            d="M100 18 a26 30 0 1 1 -0.1 0 M84 74 Q86 84 70 88 L40 96 Q26 102 26 120 L26 200 M116 74 Q114 84 130 88 L160 96 Q174 102 174 120 L174 200 M52 120 L50 236 Q100 246 150 236 L148 120"
          />
        </svg>
      </div>
      <div className="cal-panel" role="status" aria-live="polite">
        <svg className="ring" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
          <circle cx="14" cy="14" r={r} stroke="rgba(255,255,255,.2)" strokeWidth="3" fill="none" />
          <circle
            cx="14" cy="14" r={r} stroke="#4cc08a" strokeWidth="3" fill="none"
            strokeDasharray={c} strokeDashoffset={c * (1 - progress)} transform="rotate(-90 14 14)" strokeLinecap="round"
          />
        </svg>
        <span>{hint || 'Line yourself up with the outline'}</span>
        {showSkip && <button className="btn small ghost" onClick={onSkip}>Skip</button>}
      </div>
    </>
  );
}
