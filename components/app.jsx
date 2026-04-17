// Drive Cycle Timer — hi-vis landscape in-car app
// Original design. Not based on any vendor UI.

const { useState, useEffect, useRef, useMemo, useCallback } = React;

const PHASES = window.DRIVE_CYCLE_PHASES;
const RULES = window.DRIVE_CYCLE_RULES;

// ---------- Theme tokens ----------
const THEMES = {
  hivis: {
    bg: "#000000",
    surface: "#0a0a0a",
    surface2: "#141414",
    line: "#262626",
    ink: "#F5F5F5",
    dim: "#8A8A8A",
    accent: "#FFD400",      // hazard yellow
    accentInk: "#000000",
    go: "#3EFF7B",          // signal green
    alert: "#FF2E2E",       // safety red
    hold: "#FFD400",
  },
  dark: {
    bg: "#05070A",
    surface: "#0B1016",
    surface2: "#131A22",
    line: "#1E2732",
    ink: "#E6F1FF",
    dim: "#6B7A8A",
    accent: "#00E5FF",      // cyan HUD
    accentInk: "#001015",
    go: "#00E5A8",
    alert: "#FF4D6D",
    hold: "#00E5FF",
  },
  amber: {
    bg: "#120A00",
    surface: "#1A0F02",
    surface2: "#241605",
    line: "#3A2608",
    ink: "#FFE3B0",
    dim: "#8A6A3A",
    accent: "#FFB020",      // instrument amber
    accentInk: "#1A0F02",
    go: "#FFD400",
    alert: "#FF4020",
    hold: "#FFB020",
  },
};

// ---------- Tweakable defaults ----------
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "hivis",
  "timerScale": 1.0,
  "units": "mph",
  "audioOn": true
}/*EDITMODE-END*/;

// ---------- Utilities ----------
const pad = (n) => String(n).padStart(2, "0");
const fmtTime = (s) => {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${pad(m)}:${pad(ss)}`;
};
const mphToKph = (mph) => Math.round(mph * 1.60934);
const fmtSpeed = (mph, units) => (units === "kph" ? `${mphToKph(mph)}` : `${Math.round(mph)}`);
const speedLabel = (units) => (units === "kph" ? "KM/H" : "MPH");

// ---------- Voice ----------
function useVoice(enabled) {
  const speak = useCallback((text) => {
    if (!enabled) return;
    if (typeof window.speechSynthesis === "undefined") return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.98; u.pitch = 1.0; u.volume = 1.0;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }, [enabled]);
  return speak;
}

// ---------- GPS ----------
function useGps(enabled) {
  const [state, setState] = useState({ active: false, speedMph: null, accuracy: null, error: null });
  const watchId = useRef(null);
  useEffect(() => {
    if (!enabled) { setState({ active: false, speedMph: null, accuracy: null, error: null }); return; }
    if (!("geolocation" in navigator)) { setState({ active: false, speedMph: null, accuracy: null, error: "GPS not supported" }); return; }
    try {
      watchId.current = navigator.geolocation.watchPosition(
        (pos) => {
          const mps = pos.coords.speed;
          const mph = (mps == null || isNaN(mps)) ? null : (mps * 2.23694);
          setState({ active: true, speedMph: mph, accuracy: pos.coords.accuracy, error: null });
        },
        (err) => setState({ active: false, speedMph: null, accuracy: null, error: err.message || "GPS error" }),
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
      );
    } catch (e) {
      setState({ active: false, speedMph: null, accuracy: null, error: "GPS unavailable" });
    }
    return () => {
      if (watchId.current != null) try { navigator.geolocation.clearWatch(watchId.current); } catch (e) {}
    };
  }, [enabled]);
  return state;
}

// ---------- Main App ----------
function App() {
  const [tweaks, setTweaks] = useState(TWEAK_DEFAULTS);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0); // seconds in current phase
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  // Manual speed fallback
  const [manualSpeed, setManualSpeed] = useState(0);
  const [useManual, setUseManual] = useState(false);
  // Simulated RPM when no OBD link (used for violation detection fallback)
  const [simRpm, setSimRpm] = useState(700);
  // Violation / auto-advance state
  const [violation, setViolation] = useState(null);
  const [advanceCountdown, setAdvanceCountdown] = useState(null);
  const [editMode, setEditMode] = useState(false);

  const theme = THEMES[tweaks.theme] || THEMES.hivis;
  const phase = PHASES[phaseIdx];
  const speak = useVoice(tweaks.audioOn);
  const gps = useGps(!useManual);

  const currentSpeedMph = useManual ? manualSpeed : (gps.speedMph ?? 0);

  // Tick
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [running, phaseIdx]);

  // Announce phase on entry
  const lastSpoken = useRef(-1);
  useEffect(() => {
    if (running && lastSpoken.current !== phaseIdx) {
      speak(phase.voice);
      lastSpoken.current = phaseIdx;
    }
  }, [running, phaseIdx, phase, speak]);

  // Violation + auto-advance logic
  useEffect(() => {
    if (!running) return;
    let v = null;
    const t = phase.target;
    if (simRpm > RULES.maxRpm) v = RULES.violations.overRpm;
    else if (currentSpeedMph > RULES.maxSpeedMph) v = RULES.violations.overSpeed;
    else if (t.type === "stationary" && currentSpeedMph > 2 && elapsed > 2) v = RULES.violations.moved;
    else if (t.type === "speed" && elapsed > 10 && (currentSpeedMph < t.min - 2 || currentSpeedMph > t.max + 2)) v = RULES.violations.outOfBand;
    setViolation(v);
  }, [currentSpeedMph, simRpm, elapsed, phase, running]);

  // On violation: auto-restart phase
  const restartedAt = useRef(-1);
  useEffect(() => {
    if (!running) return;
    if (violation && restartedAt.current !== elapsed) {
      speak("Phase violation. Restarting phase.");
      restartedAt.current = elapsed;
      const tm = setTimeout(() => {
        setElapsed(0);
        restartedAt.current = -1;
      }, 1500);
      return () => clearTimeout(tm);
    }
  }, [violation, running, elapsed, speak]);

  // Auto-advance when timer hits target AND conditions are met
  useEffect(() => {
    if (!running || violation) { setAdvanceCountdown(null); return; }
    if (elapsed >= phase.duration) {
      // Start 5s countdown
      if (advanceCountdown == null) setAdvanceCountdown(5);
    }
  }, [elapsed, phase, running, violation]);

  useEffect(() => {
    if (advanceCountdown == null) return;
    if (advanceCountdown <= 0) {
      if (phaseIdx < PHASES.length - 1) {
        setPhaseIdx(phaseIdx + 1);
        setElapsed(0);
        setAdvanceCountdown(null);
      } else {
        setCompleted(true);
        setRunning(false);
        speak("Drive cycle complete. You may switch off the engine.");
        setAdvanceCountdown(null);
      }
      return;
    }
    const t = setTimeout(() => setAdvanceCountdown(advanceCountdown - 1), 1000);
    return () => clearTimeout(t);
  }, [advanceCountdown, phaseIdx, speak]);

  // ------- Tweaks host protocol -------
  useEffect(() => {
    const onMsg = (e) => {
      const d = e.data || {};
      if (d.type === "__activate_edit_mode") setEditMode(true);
      else if (d.type === "__deactivate_edit_mode") setEditMode(false);
    };
    window.addEventListener("message", onMsg);
    window.parent.postMessage({ type: "__edit_mode_available" }, "*");
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const setTweak = (key, value) => {
    setTweaks((t) => ({ ...t, [key]: value }));
    window.parent.postMessage({ type: "__edit_mode_set_keys", edits: { [key]: value } }, "*");
  };

  // ------- Derived -------
  const phaseRemaining = Math.max(0, phase.duration - elapsed);
  const phaseProgress = Math.min(1, elapsed / phase.duration);
  const totalDuration = PHASES.reduce((a, p) => a + p.duration, 0);
  const totalElapsed = PHASES.slice(0, phaseIdx).reduce((a, p) => a + p.duration, 0) + Math.min(elapsed, phase.duration);
  const overallProgress = totalElapsed / totalDuration;

  // ------- Handlers -------
  const start = () => { setRunning(true); setElapsed(0); setCompleted(false); lastSpoken.current = -1; };
  const pauseResume = () => setRunning((r) => !r);
  const reset = () => { setRunning(false); setPhaseIdx(0); setElapsed(0); setCompleted(false); setAdvanceCountdown(null); lastSpoken.current = -1; };
  const skipNext = () => {
    if (phaseIdx < PHASES.length - 1) { setPhaseIdx(phaseIdx + 1); setElapsed(0); setAdvanceCountdown(null); }
  };
  const prevPhase = () => {
    if (phaseIdx > 0) { setPhaseIdx(phaseIdx - 1); setElapsed(0); setAdvanceCountdown(null); }
  };

  // ------- Render -------
  return (
    <div style={{ ...rootStyle(theme), "--accent": theme.accent, "--ink": theme.ink }}>
      {/* Top bar */}
      <TopBar theme={theme} phaseIdx={phaseIdx} total={PHASES.length} gps={gps} useManual={useManual} setUseManual={setUseManual} running={running} completed={completed} overallProgress={overallProgress} />

      {/* Main 3-column */}
      <div style={bodyStyle}>
        <LeftPhaseList theme={theme} phaseIdx={phaseIdx} />

        <CenterStage
          theme={theme}
          phase={phase}
          phaseIdx={phaseIdx}
          running={running}
          completed={completed}
          phaseRemaining={phaseRemaining}
          phaseProgress={phaseProgress}
          violation={violation}
          advanceCountdown={advanceCountdown}
          timerScale={tweaks.timerScale}
          onStart={start}
          onPauseResume={pauseResume}
          onReset={reset}
          onNext={skipNext}
          onPrev={prevPhase}
        />

        <RightConditions
          theme={theme}
          phase={phase}
          currentSpeedMph={currentSpeedMph}
          units={tweaks.units}
          simRpm={simRpm}
          setSimRpm={setSimRpm}
          useManual={useManual}
          manualSpeed={manualSpeed}
          setManualSpeed={setManualSpeed}
        />
      </div>

      {/* Bottom status bar */}
      <BottomBar theme={theme} violation={violation} advanceCountdown={advanceCountdown} phase={phase} running={running} completed={completed} />

      {/* Tweaks panel */}
      {editMode && (
        <TweaksPanel theme={theme} tweaks={tweaks} setTweak={setTweak} />
      )}
    </div>
  );
}

// ---------- Sub-components ----------

function TopBar({ theme, phaseIdx, total, gps, useManual, setUseManual, running, completed, overallProgress }) {
  return (
    <div style={{ display: "flex", alignItems: "stretch", borderBottom: `2px solid ${theme.line}`, background: theme.surface }}>
      <div style={{ padding: "14px 24px", borderRight: `2px solid ${theme.line}`, display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 14, height: 14, background: running ? theme.go : (completed ? theme.accent : theme.dim), borderRadius: 2, boxShadow: running ? `0 0 12px ${theme.go}` : "none" }} />
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: 2, color: theme.ink }}>
          DRIVE CYCLE · BMW FEDERAL
        </div>
      </div>
      <div style={{ flex: 1, padding: "0 24px", display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: theme.dim, letterSpacing: 1 }}>
          PHASE <span style={{ color: theme.accent, fontWeight: 700 }}>{String(phaseIdx + 1).padStart(2, "0")}</span> <span style={{ opacity: 0.4 }}>/ {String(total).padStart(2, "0")}</span>
        </div>
        <div style={{ flex: 1, height: 8, background: theme.surface2, borderRadius: 0, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, background: `repeating-linear-gradient(90deg, ${theme.line} 0, ${theme.line} 1px, transparent 1px, transparent calc(100% / 6))` }} />
          <div style={{ width: `${Math.min(100, overallProgress * 100)}%`, height: "100%", background: theme.accent, transition: "width 0.5s linear" }} />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", borderLeft: `2px solid ${theme.line}` }}>
        <button
          onClick={() => setUseManual(false)}
          style={topBtnStyle(theme, !useManual)}
          title="Use GPS"
        >
          <span style={{ display: "inline-block", width: 8, height: 8, background: gps.active && !useManual ? theme.go : theme.dim, borderRadius: "50%", marginRight: 8, boxShadow: gps.active && !useManual ? `0 0 8px ${theme.go}` : "none" }} />
          GPS {gps.active ? "LOCK" : "—"}
        </button>
        <button
          onClick={() => setUseManual(true)}
          style={topBtnStyle(theme, useManual)}
          title="Manual speed input"
        >
          MANUAL
        </button>
      </div>
    </div>
  );
}

function topBtnStyle(theme, active) {
  return {
    border: "none",
    borderLeft: `2px solid ${theme.line}`,
    background: active ? theme.accent : "transparent",
    color: active ? theme.accentInk : theme.ink,
    padding: "0 20px",
    height: "100%",
    fontFamily: "'Barlow Condensed', sans-serif",
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: 2,
    cursor: "pointer",
    whiteSpace: "nowrap",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

function LeftPhaseList({ theme, phaseIdx }) {
  return (
    <div style={{ width: 300, borderRight: `2px solid ${theme.line}`, padding: "16px 0", display: "flex", flexDirection: "column", background: theme.bg }}>
      <div style={{ padding: "0 20px 12px", fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, color: theme.dim, letterSpacing: 2 }}>SEQUENCE</div>
      {PHASES.map((p, i) => {
        const done = i < phaseIdx;
        const active = i === phaseIdx;
        return (
          <div key={p.id} style={{
            padding: "12px 16px 12px 20px",
            borderLeft: `4px solid ${active ? theme.accent : (done ? theme.dim : "transparent")}`,
            background: active ? theme.surface : "transparent",
            opacity: done ? 0.5 : 1,
            position: "relative",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, color: active ? theme.accent : theme.dim, fontWeight: 700, flex: "0 0 auto" }}>
              {String(p.number).padStart(2, "0")}
            </div>
            <div style={{
              fontFamily: "'Barlow Condensed', sans-serif", fontSize: 19, fontWeight: 700,
              color: theme.ink, letterSpacing: 1, lineHeight: 1.05, flex: 1, minWidth: 0,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {p.name.toUpperCase()}
            </div>
            <div style={{
              fontSize: 13, color: active ? theme.accent : theme.dim,
              fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1,
              flex: "0 0 auto", fontWeight: 700,
            }}>
              {done ? "✓" : fmtTime(p.duration)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CenterStage({ theme, phase, phaseIdx, running, completed, phaseRemaining, phaseProgress, violation, advanceCountdown, timerScale, onStart, onPauseResume, onReset, onNext, onPrev }) {
  const status = completed ? "DONE" : violation ? "HOLD" : (advanceCountdown != null ? "GO" : (running ? "RUN" : "READY"));
  const statusColor = completed ? theme.accent : violation ? theme.alert : (advanceCountdown != null || running) ? theme.go : theme.accent;
  const timerFontSize = `calc(${14 * (timerScale || 1)}vw)`;

  return (
    <div style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column", background: theme.bg, overflow: "hidden" }}>
      {/* Phase heading */}
      <div style={{ padding: "18px 28px", borderBottom: `1px solid ${theme.line}`, display: "flex", alignItems: "baseline", gap: 20 }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 44, fontWeight: 800, color: theme.ink, letterSpacing: 2, lineHeight: 1 }}>
          {phase.name.toUpperCase()}
        </div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, color: theme.accent, letterSpacing: 2 }}>
          {phase.short}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 14, height: 14, background: statusColor, boxShadow: `0 0 14px ${statusColor}`, animation: running && !violation ? "pulse 1.2s infinite" : "none" }} />
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 30, fontWeight: 800, color: statusColor, letterSpacing: 3 }}>{status}</div>
        </div>
      </div>

      {/* Timer */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative", padding: "0 28px" }}>
        {/* Corner tick marks */}
        <CornerTicks theme={theme} />

        {/* Big timer */}
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: timerFontSize,
          fontWeight: 700,
          color: violation ? theme.alert : theme.ink,
          lineHeight: 0.9,
          letterSpacing: -4,
          textShadow: violation ? `0 0 40px ${theme.alert}44` : "none",
          fontVariantNumeric: "tabular-nums",
        }}>
          {fmtTime(phaseRemaining)}
        </div>
        <div style={{ marginTop: 10, fontFamily: "'Barlow Condensed', sans-serif", fontSize: 22, color: theme.dim, letterSpacing: 4 }}>
          REMAINING · TARGET {fmtTime(phase.duration)}
        </div>

        {/* Horizontal progress bar */}
        <div style={{ width: "100%", maxWidth: 900, marginTop: 30, height: 14, background: theme.surface2, position: "relative", border: `1px solid ${theme.line}` }}>
          <div style={{ position: "absolute", inset: 0, background: `repeating-linear-gradient(90deg, ${theme.line} 0, ${theme.line} 1px, transparent 1px, transparent 10%)` }} />
          <div style={{
            width: `${Math.min(100, phaseProgress * 100)}%`,
            height: "100%",
            background: violation ? theme.alert : theme.accent,
            transition: "width 0.5s linear",
          }} />
        </div>

        {/* Auto-advance banner */}
        {advanceCountdown != null && (
          <div style={{
            marginTop: 20, padding: "14px 28px",
            background: theme.go, color: "#000",
            fontFamily: "'Barlow Condensed', sans-serif",
            fontWeight: 800, fontSize: 32, letterSpacing: 3,
          }}>
            ✓ PHASE CLEAR — ADVANCING IN {advanceCountdown}…
          </div>
        )}
        {completed && (
          <div style={{
            marginTop: 20, padding: "18px 32px",
            background: theme.accent, color: theme.accentInk,
            fontFamily: "'Barlow Condensed', sans-serif",
            fontWeight: 800, fontSize: 38, letterSpacing: 3,
          }}>
            ✓ DRIVE CYCLE COMPLETE — KEY OFF
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div style={{ borderTop: `2px solid ${theme.line}`, display: "flex", background: theme.surface }}>
        {!running && !completed ? (
          <button onClick={onStart} style={bigBtn(theme, "primary")}>
            <span style={{ fontSize: 40 }}>▶</span>
            <span>START CYCLE</span>
          </button>
        ) : (
          <>
            <button onClick={onPrev} style={bigBtn(theme, "ghost", 120)} disabled={phaseIdx === 0}>◀ PREV</button>
            <button onClick={onPauseResume} style={bigBtn(theme, running ? "warn" : "primary")}>
              {running ? "❚❚ PAUSE" : "▶ RESUME"}
            </button>
            <button onClick={onNext} style={bigBtn(theme, "ghost", 120)}>SKIP ▶</button>
            <button onClick={onReset} style={bigBtn(theme, "danger", 150)}>RESET</button>
          </>
        )}
      </div>
    </div>
  );
}

function CornerTicks({ theme }) {
  const t = { position: "absolute", width: 28, height: 28, border: `3px solid ${theme.accent}` };
  return (
    <>
      <div style={{ ...t, top: 18, left: 18, borderRight: "none", borderBottom: "none" }} />
      <div style={{ ...t, top: 18, right: 18, borderLeft: "none", borderBottom: "none" }} />
      <div style={{ ...t, bottom: 18, left: 18, borderRight: "none", borderTop: "none" }} />
      <div style={{ ...t, bottom: 18, right: 18, borderLeft: "none", borderTop: "none" }} />
    </>
  );
}

function bigBtn(theme, kind, flex) {
  const base = {
    flex: flex ? `0 0 ${flex}px` : 1,
    padding: "20px 24px",
    border: "none",
    borderRight: `2px solid ${theme.line}`,
    fontFamily: "'Barlow Condensed', sans-serif",
    fontSize: 30,
    fontWeight: 800,
    letterSpacing: 3,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  };
  if (kind === "primary") return { ...base, background: theme.accent, color: theme.accentInk };
  if (kind === "warn") return { ...base, background: theme.surface2, color: theme.accent, border: `2px solid ${theme.accent}` };
  if (kind === "danger") return { ...base, background: "transparent", color: theme.alert };
  return { ...base, background: "transparent", color: theme.ink };
}

function RightConditions({ theme, phase, currentSpeedMph, units, simRpm, setSimRpm, useManual, manualSpeed, setManualSpeed }) {
  const t = phase.target;
  const inBand = useMemo(() => {
    if (t.type === "stationary") return currentSpeedMph <= 2;
    if (t.type === "speed") return currentSpeedMph >= t.min && currentSpeedMph <= t.max;
    if (t.type === "decel") return true;
    return true;
  }, [t, currentSpeedMph]);

  return (
    <div style={{ width: 340, borderLeft: `2px solid ${theme.line}`, background: theme.bg, display: "flex", flexDirection: "column" }}>
      {/* Speed gauge */}
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${theme.line}` }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, color: theme.dim, letterSpacing: 2 }}>CURRENT SPEED</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 700,
            fontSize: 96,
            lineHeight: 0.95,
            color: inBand ? theme.go : theme.accent,
            fontVariantNumeric: "tabular-nums",
          }}>
            {fmtSpeed(currentSpeedMph, units)}
          </div>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 22, color: theme.dim, letterSpacing: 2 }}>{speedLabel(units)}</div>
        </div>

        {/* Target band */}
        <SpeedBand theme={theme} phase={phase} currentSpeedMph={currentSpeedMph} units={units} />

        {/* Manual slider */}
        {useManual && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: theme.dim, fontFamily: "'JetBrains Mono', monospace", marginBottom: 6, letterSpacing: 1 }}>MANUAL ENTRY (DRAG)</div>
            <input type="range" min="0" max="80" value={manualSpeed} onChange={(e) => setManualSpeed(+e.target.value)}
              style={{ width: "100%", accentColor: theme.accent }} />
          </div>
        )}
      </div>

      {/* Instruction */}
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${theme.line}` }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, color: theme.dim, letterSpacing: 2 }}>INSTRUCTION</div>
        <div style={{ marginTop: 6, fontFamily: "'Barlow Condensed', sans-serif", fontSize: 22, fontWeight: 500, color: theme.ink, lineHeight: 1.2, letterSpacing: 0.5 }}>
          {phase.instruction}
        </div>
      </div>

      {/* RPM + Rules */}
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${theme.line}` }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, color: theme.dim, letterSpacing: 2 }}>RPM LIMIT</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 2 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 38, color: simRpm > 3000 ? theme.alert : theme.ink, fontVariantNumeric: "tabular-nums" }}>{simRpm}</div>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, color: theme.dim, letterSpacing: 2 }}>/ 3000 RPM MAX</div>
        </div>
        <div style={{ fontSize: 11, color: theme.dim, fontFamily: "'JetBrains Mono', monospace", marginTop: 2, letterSpacing: 1 }}>SIM · DRAG TO TEST VIOLATIONS</div>
        <input type="range" min="600" max="4000" value={simRpm} onChange={(e) => setSimRpm(+e.target.value)} style={{ width: "100%", accentColor: simRpm > 3000 ? theme.alert : theme.accent, marginTop: 4 }} />
      </div>

      <div style={{ padding: "16px 20px", flex: 1, overflow: "auto" }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, color: theme.dim, letterSpacing: 2 }}>CONDITIONS</div>
        <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0 0", display: "grid", gap: 4 }}>
          {phase.conditions.map((c, i) => (
            <li key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "'Barlow Condensed', sans-serif", fontSize: 18, color: theme.ink, letterSpacing: 0.5 }}>
              <span style={{ display: "inline-block", width: 6, height: 6, background: theme.accent }} />
              {c}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function SpeedBand({ theme, phase, currentSpeedMph, units }) {
  const t = phase.target;
  const maxScale = 80; // mph
  const pct = (mph) => Math.max(0, Math.min(100, (mph / maxScale) * 100));
  let bandStart = 0, bandEnd = 0;
  if (t.type === "speed") { bandStart = t.min; bandEnd = t.max; }
  else if (t.type === "stationary") { bandStart = 0; bandEnd = 2; }
  else if (t.type === "decel") { bandStart = 0; bandEnd = t.max; }

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: theme.dim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>
        <span>TARGET</span>
        <span>
          {t.type === "speed" && `${fmtSpeed(t.min, units)}–${fmtSpeed(t.max, units)} ${speedLabel(units)}`}
          {t.type === "stationary" && `0 ${speedLabel(units)}`}
          {t.type === "decel" && `COAST ≤ ${fmtSpeed(t.max, units)} ${speedLabel(units)}`}
        </span>
      </div>
      <div style={{ position: "relative", height: 22, background: theme.surface2, marginTop: 4, border: `1px solid ${theme.line}` }}>
        {/* target band */}
        <div style={{
          position: "absolute", top: 0, bottom: 0,
          left: `${pct(bandStart)}%`,
          width: `${pct(bandEnd) - pct(bandStart)}%`,
          background: `${theme.go}33`,
          borderLeft: `2px solid ${theme.go}`,
          borderRight: `2px solid ${theme.go}`,
        }} />
        {/* over-speed zone */}
        <div style={{
          position: "absolute", top: 0, bottom: 0,
          left: `${pct(60)}%`, right: 0,
          background: `${theme.alert}22`,
          borderLeft: `2px dashed ${theme.alert}`,
        }} />
        {/* needle */}
        <div style={{
          position: "absolute", top: -4, bottom: -4,
          left: `${pct(currentSpeedMph)}%`,
          width: 3, background: theme.ink, transform: "translateX(-1px)",
          boxShadow: `0 0 8px ${theme.ink}`,
        }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2, fontSize: 10, color: theme.dim, fontFamily: "'JetBrains Mono', monospace" }}>
        <span>0</span><span>20</span><span>40</span><span>60</span><span>80</span>
      </div>
    </div>
  );
}

function BottomBar({ theme, violation, advanceCountdown, phase, running, completed }) {
  let content, bg, color;
  if (completed) {
    bg = theme.accent; color = theme.accentInk;
    content = "DRIVE CYCLE COMPLETE · BRING TO STATIONARY SHOP FOR OBD-II SCAN";
  } else if (violation) {
    bg = theme.alert; color = "#fff";
    content = `⚠ VIOLATION: ${violation} — PHASE WILL RESTART`;
  } else if (advanceCountdown != null) {
    bg = theme.go; color = "#000";
    content = `✓ CONDITIONS MET — ADVANCING IN ${advanceCountdown}`;
  } else if (running) {
    bg = theme.surface; color = theme.ink;
    content = `HOLD: ${phase.target.label} · KEEP RPM < 3000 · SPEED ≤ 60 MPH`;
  } else {
    bg = theme.surface; color = theme.dim;
    content = "READY — PROP YOUR PHONE IN LANDSCAPE, ENABLE GPS, AND PRESS START";
  }
  return (
    <div style={{
      borderTop: `2px solid ${theme.line}`,
      background: bg, color,
      padding: "12px 24px",
      fontFamily: "'Barlow Condensed', sans-serif",
      fontWeight: 700,
      fontSize: 24,
      letterSpacing: 3,
      textAlign: "center",
    }}>
      {content}
    </div>
  );
}

function TweaksPanel({ theme, tweaks, setTweak }) {
  return (
    <div style={{
      position: "fixed", bottom: 72, right: 20, width: 280,
      background: "#0a0a0a", border: `2px solid ${theme.accent}`,
      padding: 16, zIndex: 1000,
      fontFamily: "'Barlow Condensed', sans-serif",
      color: theme.ink,
      boxShadow: `0 8px 40px rgba(0,0,0,0.6)`,
    }}>
      <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 3, color: theme.accent, marginBottom: 12 }}>TWEAKS</div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: "#888", letterSpacing: 2, marginBottom: 6 }}>THEME</div>
        <div style={{ display: "flex", gap: 6 }}>
          {["hivis", "dark", "amber"].map(k => (
            <button key={k} onClick={() => setTweak("theme", k)}
              style={{
                flex: 1, padding: "8px 4px", background: tweaks.theme === k ? theme.accent : "transparent",
                color: tweaks.theme === k ? theme.accentInk : "#ccc",
                border: `1px solid ${tweaks.theme === k ? theme.accent : "#333"}`,
                fontFamily: "inherit", fontWeight: 700, letterSpacing: 1, fontSize: 13, cursor: "pointer",
              }}>{k.toUpperCase()}</button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: "#888", letterSpacing: 2, marginBottom: 6 }}>TIMER SIZE · {tweaks.timerScale.toFixed(1)}×</div>
        <input type="range" min="0.7" max="1.4" step="0.1" value={tweaks.timerScale}
          onChange={(e) => setTweak("timerScale", +e.target.value)}
          style={{ width: "100%", accentColor: theme.accent }} />
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: "#888", letterSpacing: 2, marginBottom: 6 }}>UNITS</div>
        <div style={{ display: "flex", gap: 6 }}>
          {["mph", "kph"].map(k => (
            <button key={k} onClick={() => setTweak("units", k)}
              style={{
                flex: 1, padding: "8px 4px", background: tweaks.units === k ? theme.accent : "transparent",
                color: tweaks.units === k ? theme.accentInk : "#ccc",
                border: `1px solid ${tweaks.units === k ? theme.accent : "#333"}`,
                fontFamily: "inherit", fontWeight: 700, letterSpacing: 1, fontSize: 13, cursor: "pointer",
              }}>{k.toUpperCase()}</button>
          ))}
        </div>
      </div>

      <div>
        <button onClick={() => setTweak("audioOn", !tweaks.audioOn)}
          style={{
            width: "100%", padding: "10px", background: tweaks.audioOn ? theme.accent : "transparent",
            color: tweaks.audioOn ? theme.accentInk : "#ccc",
            border: `1px solid ${tweaks.audioOn ? theme.accent : "#333"}`,
            fontFamily: "inherit", fontWeight: 700, letterSpacing: 2, fontSize: 14, cursor: "pointer",
          }}>
          VOICE PROMPTS: {tweaks.audioOn ? "ON" : "OFF"}
        </button>
      </div>
    </div>
  );
}

// ---------- styles ----------
function rootStyle(theme) {
  return {
    position: "fixed", inset: 0,
    background: theme.bg, color: theme.ink,
    display: "flex", flexDirection: "column",
    fontFamily: "'Barlow Condensed', 'Helvetica Neue', sans-serif",
    overflow: "hidden",
  };
}
const bodyStyle = { flex: 1, display: "flex", minHeight: 0 };

// Mount
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
