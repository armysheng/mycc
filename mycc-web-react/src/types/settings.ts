export type Theme = "light" | "dark";
export type EnterBehavior = "send" | "newline";
export type FontSize = "sm" | "md" | "lg";

export interface AppSettings {
  theme: Theme;
  enterBehavior: EnterBehavior;
  showToolCalls: boolean;
  autoExpandThinking: boolean;
  fontSize: FontSize;
  profileNickname: string;
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
  profileNickname: string;
  toggleTheme: () => void;
  toggleEnterBehavior: () => void;
  toggleShowToolCalls: () => void;
  toggleAutoExpandThinking: () => void;
  setFontSize: (size: FontSize) => void;
  setProfileNickname: (nickname: string) => void;
  updateSettings: (updates: Partial<AppSettings>) => void;
}

// Default settings
export const DEFAULT_SETTINGS: AppSettings = {
  theme: "light",
  enterBehavior: "send",
  showToolCalls: true,
  autoExpandThinking: false,
  fontSize: "md",
  profileNickname: "",
  version: 2,
};

// Current settings version for migration
export const CURRENT_SETTINGS_VERSION = 2;
