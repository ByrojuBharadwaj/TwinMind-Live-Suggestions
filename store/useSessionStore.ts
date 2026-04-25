"use client";

import { create } from "zustand";
import type { TranscriptChunk } from "@/types";

/**
 * Per-session state — NOT persisted across reloads by design.
 * (Reloading a meeting should start fresh; only settings persist.)
 */

export type ChunkStatus = "transcribing" | "done" | "error";

export interface TranscriptChunkWithStatus extends TranscriptChunk {
  status: ChunkStatus;
  error?: string;
}

interface SessionState {
  isRecording: boolean;
  startedAt: number | null;
  chunks: TranscriptChunkWithStatus[];

  setRecording: (isRecording: boolean, startedAt?: number | null) => void;

  /** Inserts a placeholder chunk that will be filled in once Whisper responds. */
  addPendingChunk: (args: {
    id: string;
    startedAt: number;
    endedAt: number;
  }) => void;
  resolveChunk: (id: string, text: string) => void;
  failChunk: (id: string, error: string) => void;

  reset: () => void;

  /** Concatenated text of all done chunks — used by suggestion + chat prompts. */
  fullTranscriptText: () => string;

  /** Chunks within the last `seconds` — used for the live-suggestions window. */
  recentTranscriptText: (seconds: number) => string;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  isRecording: false,
  startedAt: null,
  chunks: [],

  setRecording: (isRecording, startedAt) =>
    set({
      isRecording,
      startedAt:
        startedAt !== undefined
          ? startedAt
          : isRecording
            ? Date.now()
            : get().startedAt,
    }),

  addPendingChunk: ({ id, startedAt, endedAt }) =>
    set((state) => ({
      chunks: [
        ...state.chunks,
        { id, text: "", startedAt, endedAt, status: "transcribing" },
      ],
    })),

  resolveChunk: (id, text) =>
    set((state) => ({
      chunks: state.chunks.map((c) =>
        c.id === id ? { ...c, text, status: "done" } : c,
      ),
    })),

  failChunk: (id, error) =>
    set((state) => ({
      chunks: state.chunks.map((c) =>
        c.id === id ? { ...c, status: "error", error } : c,
      ),
    })),

  reset: () => set({ isRecording: false, startedAt: null, chunks: [] }),

  fullTranscriptText: () =>
    get()
      .chunks.filter((c) => c.status === "done")
      .map((c) => c.text)
      .join(" ")
      .trim(),

  recentTranscriptText: (seconds) => {
    const cutoff = Date.now() - seconds * 1000;
    return get()
      .chunks.filter((c) => c.status === "done" && c.endedAt >= cutoff)
      .map((c) => c.text)
      .join(" ")
      .trim();
  },
}));
