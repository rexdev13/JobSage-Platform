import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BRAND } from "./lib/brand";
import {
  getEnvSettings,
  saveEnvSettings,
  normalizeOrigin,
  activeOrigin,
  PROD_ORIGIN,
  DEFAULT_DEV_ORIGIN,
  type ExtensionEnv,
} from "./lib/env";

// ---------------------------------------------------------------------------
// Messaging helpers
// ---------------------------------------------------------------------------

function sendMessage<T>(msg: unknown): Promise<T> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response: T) => {
      if (chrome.runtime.lastError) {
        resolve({} as T);
        return;
      }
      resolve(response);
    });
  });
}

async function loadSuppressedHostnames(): Promise<string[]> {
  try {
    const resp = await sendMessage<{ hostnames?: string[] }>({ type: "GET_ALL_SUPPRESSIONS" });
    return resp.hostnames ?? [];
  } catch {
    return [];
  }
}

async function clearSuppression(hostname: string): Promise<void> {
  try {
    await sendMessage({ type: "CLEAR_SUPPRESSION", hostname });
  } catch {
    // non-critical
  }
}

// ---------------------------------------------------------------------------
// Popup
// ---------------------------------------------------------------------------

function Popup() {
  const [env, setEnv] = useState<ExtensionEnv>("production");
  const [devOrigin, setDevOrigin] = useState(DEFAULT_DEV_ORIGIN);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [suppressedHostnames, setSuppressedHostnames] = useState<string[]>([]);

  useEffect(() => {
    Promise.all([getEnvSettings(), loadSuppressedHostnames()]).then(([s, hostnames]) => {
      setEnv(s.env);
      setDevOrigin(s.devOrigin);
      setSuppressedHostnames(hostnames);
      setLoaded(true);
    });
  }, []);

  const flashSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const switchEnv = async (next: ExtensionEnv) => {
    setEnv(next);
    await saveEnvSettings({ env: next });
    flashSaved();
  };

  const commitDevOrigin = async () => {
    const normalized = normalizeOrigin(devOrigin) || DEFAULT_DEV_ORIGIN;
    setDevOrigin(normalized);
    await saveEnvSettings({ devOrigin: normalized });
    flashSaved();
  };

  const handleReEnable = async (hostname: string) => {
    await clearSuppression(hostname);
    setSuppressedHostnames((prev) => prev.filter((h) => h !== hostname));
  };

  const target = activeOrigin({ env, devOrigin });

  const segBtn = (value: ExtensionEnv, label: string) => {
    const active = env === value;
    return (
      <button
        onClick={() => switchEnv(value)}
        style={{
          flex: 1,
          padding: "8px 0",
          fontSize: 13,
          fontWeight: 600,
          fontFamily: BRAND.fontSans,
          color: active ? "#fff" : BRAND.text,
          background: active ? BRAND.primary : "transparent",
          border: "none",
          borderRadius: BRAND.radiusSm - 2,
          cursor: "pointer",
          transition: "background 0.15s",
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div
      style={{
        width: 320,
        padding: 16,
        background: BRAND.bg,
        fontFamily: BRAND.fontSans,
        color: BRAND.text,
        boxSizing: "border-box",
      }}
    >
      {/* Header */}
      <div
        style={{
          fontFamily: BRAND.fontDisplay,
          fontSize: 15,
          fontWeight: 700,
          letterSpacing: "-0.01em",
          marginBottom: 2,
        }}
      >
        JOB<span style={{ color: BRAND.primary }}>SAGE</span> Smart Apply
      </div>
      <div style={{ fontSize: 12, color: BRAND.textMuted, marginBottom: 14 }}>
        Choose which JOBSAGE environment the extension talks to.
      </div>

      {/* Environment selector */}
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: 4,
          background: BRAND.inputBg,
          border: `1px solid ${BRAND.border}`,
          borderRadius: BRAND.radiusSm,
          marginBottom: 12,
        }}
      >
        {segBtn("production", "Production")}
        {segBtn("development", "Development")}
      </div>

      {env === "development" && (
        <div style={{ marginBottom: 12 }}>
          <label
            style={{
              display: "block",
              fontSize: 11,
              fontWeight: 600,
              color: BRAND.text,
              marginBottom: 4,
            }}
          >
            Development server URL
          </label>
          <input
            type="text"
            value={devOrigin}
            onChange={(e) => setDevOrigin(e.target.value)}
            onBlur={commitDevOrigin}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitDevOrigin();
            }}
            placeholder="https://your-app.replit.dev"
            spellCheck={false}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "7px 10px",
              fontSize: 12,
              fontFamily: BRAND.fontSans,
              color: BRAND.text,
              background: BRAND.surface,
              border: `1px solid ${BRAND.border}`,
              borderRadius: BRAND.radiusSm,
              outline: "none",
            }}
          />
        </div>
      )}

      {/* Active environment badge */}
      <div
        style={{
          padding: "8px 10px",
          background: env === "production" ? BRAND.primarySoft : BRAND.successBg,
          borderRadius: BRAND.radiusSm,
          fontSize: 11,
          color: env === "production" ? BRAND.primary : BRAND.successText,
          fontWeight: 500,
          lineHeight: 1.5,
          wordBreak: "break-all",
        }}
      >
        {loaded ? (
          <>
            Active: <strong>{target}</strong>
            {saved && <span style={{ float: "right" }}>✓ Saved</span>}
          </>
        ) : (
          "Loading…"
        )}
      </div>

      {/* Suppressed sites */}
      {loaded && suppressedHostnames.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: BRAND.text,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 6,
            }}
          >
            Hidden on these sites
          </div>
          <div
            style={{
              border: `1px solid ${BRAND.border}`,
              borderRadius: BRAND.radiusSm,
              overflow: "hidden",
            }}
          >
            {suppressedHostnames.map((hostname, i) => (
              <div
                key={hostname}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "7px 10px",
                  borderTop: i > 0 ? `1px solid ${BRAND.border}` : "none",
                  background: BRAND.inputBg,
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    color: BRAND.text,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                  }}
                >
                  {hostname}
                </span>
                <button
                  onClick={() => void handleReEnable(hostname)}
                  style={{
                    flexShrink: 0,
                    padding: "3px 8px",
                    fontSize: 11,
                    fontWeight: 600,
                    color: BRAND.primary,
                    background: BRAND.primarySoft,
                    border: `1px solid ${BRAND.primary}`,
                    borderRadius: BRAND.radiusSm - 2,
                    cursor: "pointer",
                    fontFamily: BRAND.fontSans,
                  }}
                >
                  Re-enable
                </button>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10.5, color: BRAND.textMuted, marginTop: 6, lineHeight: 1.5 }}>
            Re-enabling takes effect on the next page load.
          </div>
        </div>
      )}

      <div style={{ fontSize: 10.5, color: BRAND.textMuted, marginTop: 12, lineHeight: 1.5 }}>
        Changes apply instantly — no reinstall needed. Make sure you're signed in to JOBSAGE on the
        selected environment.
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Popup />);
