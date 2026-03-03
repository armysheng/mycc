export type Theme = "light" | "dark" | "system";
export type EnterBehavior = "send" | "newline";
export type FontSize = "sm" | "md" | "lg";

export interface AppSettings {
  theme: Theme;
  enterBehavior: EnterBehavior;
  showToolCalls: boolean;
  autoExpandThinking: boolean;
  fontSize: FontSize;
  sidebarDefaultOpen: boolean;
  version: number;
}

export interface LegacySettings {
  theme?: Theme;
  enterBehavior?: EnterBehavior;
}

export interface SettingsContextType {
  settings: AppSettings;
  theme: Theme;
  enterBehavior: EnterBehavior;
  showToolCalls: boolean;
  autoExpandThinking: boolean;
  fontSize: FontSize;
  sidebarDefaultOpen: boolean;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  toggleEnterBehavior: () => void;
  toggleShowToolCalls: () => void;
  toggleAutoExpandThinking: () => void;
  setFontSize: (size: FontSize) => void;
  updateSettings: (updates: Partial<AppSettings>) => void;
}

// Default settings
export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  enterBehavior: "send",
  showToolCalls: true,
  autoExpandThinking: false,
  fontSize: "md",
  sidebarDefaultOpen: true,
  version: 3,
};

// Current settings version for migration
export const CURRENT_SETTINGS_VERSION = 3;
