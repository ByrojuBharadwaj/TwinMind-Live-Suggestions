"use client";

import { create } from "zustand";
import type { SuggestionBatch, Suggestion } from "@/types";

/**
 * Suggestion batches + rolling session summary.
 * Per-session, not persisted across reloads (matches assignment note).
 */

export type BatchStatus = "pending" | "done" | "error";

export interface BatchWithStatus extends SuggestionBatch {
  status: BatchStatus;
  error?: string;
}

interface SuggestionsState {
  batches: BatchWithStatus[];
  /** Rolling bullet-point summary of the session so far. */
  sessionSummary: string;
  /** True while a generate call is in flight. Used to disable refresh. */
  isGenerating: boolean;
  /** How many done batches have been produced this session. */
  doneBatchCount: number;

  beginBatch: (id: string) => void;
  resolveBatch: (id: string, suggestions: Suggestion[]) => void;
  failBatch: (id: string, error: string) => void;
  setSessionSummary: (summary: string) => void;
  reset: () => void;

  /** Titles of the most recent N done batches, flattened. Used for anti-repetition. */
  recentTitles: (n: number) => string[];
}

export const useSuggestionsStore = create<SuggestionsState>((set, get) => ({
  batches: [],
  sessionSummary: "",
  isGenerating: false,
  doneBatchCount: 0,

  beginBatch: (id) =>
    set((state) => ({
      isGenerating: true,
      batches: [
        {
          id,
          createdAt: Date.now(),
          suggestions: [],
          status: "pending",
        },
        ...state.batches,
      ],
    })),

  resolveBatch: (id, suggestions) =>
    set((state) => ({
      isGenerating: false,
      doneBatchCount: state.doneBatchCount + 1,
      batches: state.batches.map((b) =>
        b.id === id ? { ...b, suggestions, status: "done" } : b,
      ),
    })),

  failBatch: (id, error) =>
    set((state) => ({
      isGenerating: false,
      batches: state.batches.map((b) =>
        b.id === id ? { ...b, status: "error", error } : b,
      ),
    })),

  setSessionSummary: (summary) => set({ sessionSummary: summary }),

  reset: () =>
    set({
      batches: [],
      sessionSummary: "",
      isGenerating: false,
      doneBatchCount: 0,
    }),

  recentTitles: (n) => {
    const titles: string[] = [];
    for (const b of get().batches) {
      if (b.status !== "done") continue;
      for (const s of b.suggestions) titles.push(s.title);
      if (titles.length >= n) break;
    }
    return titles.slice(0, n);
  },
}));
