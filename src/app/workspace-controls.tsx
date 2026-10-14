"use client";

import { useEffect, useState } from "react";
import { Moon, RefreshCw, Sun } from "lucide-react";

const themeKey = "command-center.theme";
const refreshKey = "command-center.auto-refresh";

export function useWorkspacePreferences() {
  const [darkMode, setDarkMode] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    const applyStored = () => {
      let dark = false;
      let automatic = true;
      try {
        dark = window.localStorage.getItem(themeKey) === "dark";
        automatic = window.localStorage.getItem(refreshKey) !== "off";
      } catch { /* Appearance preferences are optional. */ }
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      setDarkMode(dark);
      setAutoRefresh(automatic);
    };
    applyStored();
    window.addEventListener("storage", applyStored);
    return () => window.removeEventListener("storage", applyStored);
  }, []);

  function toggleDarkMode() {
    setDarkMode(previous => {
      const next = !previous;
      document.documentElement.dataset.theme = next ? "dark" : "light";
      try { window.localStorage.setItem(themeKey, next ? "dark" : "light"); } catch { /* Appearance preference is optional. */ }
      return next;
    });
  }

  function toggleAutoRefresh() {
    setAutoRefresh(previous => {
      const next = !previous;
      try { window.localStorage.setItem(refreshKey, next ? "on" : "off"); } catch { /* Appearance preference is optional. */ }
      return next;
    });
  }

  return { darkMode, autoRefresh, toggleDarkMode, toggleAutoRefresh };
}

export function WorkspaceControls({
  darkMode,
  autoRefresh,
  toggleDarkMode,
  toggleAutoRefresh,
  onRefresh,
}: {
  darkMode: boolean;
  autoRefresh: boolean;
  toggleDarkMode: () => void;
  toggleAutoRefresh: () => void;
  onRefresh: () => Promise<unknown> | unknown;
}) {
  const [refreshing, setRefreshing] = useState(false);
  async function refreshNow() {
    if (refreshing) return;
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  }

  return <div className="workspace-controls" aria-label="Workspace display and refresh controls">
    <button className={`workspace-tool-button ${refreshing ? "is-refreshing" : ""}`} type="button" onClick={() => void refreshNow()} disabled={refreshing} aria-label="Refresh workspace data" title="Refresh workspace data">
      <RefreshCw size={16} />
    </button>
    <button className="workspace-auto-toggle" type="button" role="switch" aria-checked={autoRefresh} onClick={toggleAutoRefresh} title={`Automatic refresh ${autoRefresh ? "on" : "off"}`}>
      <span className={`workspace-switch-track ${autoRefresh ? "on" : ""}`}><span /></span><span>Auto</span>
    </button>
    <button className="workspace-tool-button" type="button" onClick={toggleDarkMode} aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"} aria-pressed={darkMode} title={darkMode ? "Switch to light mode" : "Switch to dark mode"}>
      {darkMode ? <Sun size={17} /> : <Moon size={17} />}
    </button>
    <span className="sr-only" aria-live="polite">{refreshing ? "Refreshing workspace data" : ""}</span>
  </div>;
}
