import React, { useState, useEffect, useCallback, useMemo } from "react";
import type { AppSettings, SettingsContextType, Theme } from "../types/settings";
import { getSettings, setSettings } from "../utils/storage";
import { SettingsContext } from "./SettingsContextTypes";

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettingsState] = useState<AppSettings>(() =>
    getSettings(),
  );
  const [isInitialized, setIsInitialized] = useState(false);

  // Track system theme preference
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  );

  // Listen for system theme changes
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Compute resolved theme
  const resolvedTheme = settings.theme === "system" ? systemTheme : settings.theme;

  // Initialize settings on client side (handles migration automatically)
  useEffect(() => {
    const initialSettings = getSettings();
    setSettingsState(initialSettings);
    setIsInitialized(true);
  }, []);

  // Apply theme changes to document when settings change
  useEffect(() => {
    if (!isInitialized) return;

    const root = window.document.documentElement;

    if (resolvedTheme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    // Save settings to storage
    setSettings(settings);
  }, [settings, resolvedTheme, isInitialized]);

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettingsState((prev) => ({ ...prev, ...updates }));
  }, []);

  const setTheme = useCallback((theme: Theme) => {
    updateSettings({ theme });
  }, [updateSettings]);

  const toggleTheme = useCallback(() => {
    // Three-state cycle: light → dark → system
    const next: Record<Theme, Theme> = { light: "dark", dark: "system", system: "light" };
    updateSettings({ theme: next[settings.theme] });
  }, [settings.theme, updateSettings]);

  const toggleEnterBehavior = useCallback(() => {
    updateSettings({
      enterBehavior: settings.enterBehavior === "send" ? "newline" : "send",
    });
  }, [settings.enterBehavior, updateSettings]);

  const toggleShowToolCalls = useCallback(() => {
    updateSettings({
      showToolCalls: !settings.showToolCalls,
    });
  }, [settings.showToolCalls, updateSettings]);

  const toggleAutoExpandThinking = useCallback(() => {
    updateSettings({
      autoExpandThinking: !settings.autoExpandThinking,
    });
  }, [settings.autoExpandThinking, updateSettings]);

  const setFontSize = useCallback(
    (fontSize: "sm" | "md" | "lg") => {
      updateSettings({ fontSize });
    },
    [updateSettings],
  );

  const setProfileNickname = useCallback(
    (profileNickname: string) => {
      updateSettings({ profileNickname });
    },
    [updateSettings],
  );

  const value = useMemo(
    (): SettingsContextType => ({
      settings,
      theme: settings.theme,
      resolvedTheme,
      enterBehavior: settings.enterBehavior,
      showToolCalls: settings.showToolCalls,
      autoExpandThinking: settings.autoExpandThinking,
      fontSize: settings.fontSize,
      profileNickname: settings.profileNickname,
      sidebarDefaultOpen: settings.sidebarDefaultOpen,
      setTheme,
      toggleTheme,
      toggleEnterBehavior,
      toggleShowToolCalls,
      toggleAutoExpandThinking,
      setFontSize,
      setProfileNickname,
      updateSettings,
    }),
    [
      settings,
      resolvedTheme,
      setTheme,
      toggleTheme,
      toggleEnterBehavior,
      toggleShowToolCalls,
      toggleAutoExpandThinking,
      setFontSize,
      setProfileNickname,
      updateSettings,
    ],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}
