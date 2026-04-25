"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { DEFAULTS } from "@/config/defaults";
import type { AppSettings } from "@/types";

interface SettingsState extends AppSettings {
  setApiKey: (key: string) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  resetToDefaults: () => void;
}

const INITIAL: AppSettings = {
  groqApiKey: "",
  liveSuggestionsPrompt: DEFAULTS.liveSuggestionsPrompt,
  detailedAnswerPrompt: DEFAULTS.detailedAnswerPrompt,
  chatPrompt: DEFAULTS.chatPrompt,
  suggestionContextWindowSec: DEFAULTS.suggestionContextWindowSec,
  expandedAnswerContextWindowSec: DEFAULTS.expandedAnswerContextWindowSec,
  refreshIntervalSec: DEFAULTS.refreshIntervalSec,
};

/**
 * Persists settings to localStorage so the API key and prompt edits
 * survive reloads. No data is ever sent to a server we own — the key
 * is attached to Groq requests via a per-request header.
 */
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...INITIAL,
      setApiKey: (key) => set({ groqApiKey: key.trim() }),
      updateSettings: (patch) => set((state) => ({ ...state, ...patch })),
      resetToDefaults: () =>
        set((state) => ({
          ...state,
          liveSuggestionsPrompt: DEFAULTS.liveSuggestionsPrompt,
          detailedAnswerPrompt: DEFAULTS.detailedAnswerPrompt,
          chatPrompt: DEFAULTS.chatPrompt,
          suggestionContextWindowSec: DEFAULTS.suggestionContextWindowSec,
          expandedAnswerContextWindowSec:
            DEFAULTS.expandedAnswerContextWindowSec,
          refreshIntervalSec: DEFAULTS.refreshIntervalSec,
        })),
    }),
    {
      name: "twinmind-settings",
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);
