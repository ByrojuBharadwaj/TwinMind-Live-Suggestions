"use client";

import { useCallback, useEffect, useRef } from "react";
import { useSessionStore } from "@/store/useSessionStore";
import { useSettingsStore, SERVER_KEY_AVAILABLE } from "@/store/useSettingsStore";
import { useSuggestionsStore } from "@/store/useSuggestionsStore";
import { DEFAULTS } from "@/config/defaults";
import type { Suggestion } from "@/types";

/**
 * Orchestrates the live-suggestions loop.
 *
 *   • Auto-refresh every `refreshIntervalSec` while recording, guarded by
 *     "has the transcript actually changed since the last batch?"
 *   • Manual refresh flushes the current audio chunk, waits briefly for
 *     it to finish transcribing, then generates — matching the spec's
 *     "updates transcript then suggestions" requirement.
 *   • Every Nth successful batch, regenerates the rolling session summary
 *     in the background so long meetings stay coherent without blowing
 *     the live-suggestion context window.
 */

const RECENT_TITLES_COUNT = 6; // last 2 batches × 3 suggestions
const FLUSH_WAIT_MAX_MS = 8_000;
const FLUSH_WAIT_POLL_MS = 250;

type FlushFn = () => void;

export function useSuggestionsController(flush: FlushFn) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTranscriptLengthRef = useRef(0);

  const { batches, isGenerating, doneBatchCount } = useSuggestionsStore();
  const { beginBatch, resolveBatch, failBatch } = useSuggestionsStore();
  const resetSuggestions = useSuggestionsStore((s) => s.reset);
  const recentTitlesSelector = useSuggestionsStore((s) => s.recentTitles);

  const generate = useCallback(
    async (opts?: { manual?: boolean }) => {
      const settings = useSettingsStore.getState();
      const session = useSessionStore.getState();
      const suggestions = useSuggestionsStore.getState();

      if (!settings.groqApiKey && !SERVER_KEY_AVAILABLE) return;
      if (suggestions.isGenerating) return;

      const recentText = session.recentTranscriptText(
        settings.suggestionContextWindowSec,
      );

      // Auto-refresh guard: skip if no new transcript since the last call.
      if (!opts?.manual && recentText.length <= lastTranscriptLengthRef.current)
        return;
      lastTranscriptLengthRef.current = recentText.length;

      const batchId = crypto.randomUUID();
      beginBatch(batchId);

      const titles = recentTitlesSelector(RECENT_TITLES_COUNT);

      try {
        const res = await fetch("/api/suggestions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(settings.groqApiKey
              ? { Authorization: `Bearer ${settings.groqApiKey}` }
              : {}),
          },
          body: JSON.stringify({
            systemPrompt: settings.liveSuggestionsPrompt,
            recentTranscript: recentText,
            sessionSummary: suggestions.sessionSummary,
            recentTitles: titles,
          }),
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          failBatch(batchId, body.error ?? `HTTP ${res.status}`);
          return;
        }

        const data = (await res.json()) as {
          suggestions: Array<Omit<Suggestion, "id">>;
        };
        const withIds: Suggestion[] = data.suggestions.map((s) => ({
          ...s,
          id: crypto.randomUUID(),
        }));
        resolveBatch(batchId, withIds);

        // Fire-and-forget summary refresh on every Nth done batch.
        const nextCount = useSuggestionsStore.getState().doneBatchCount;
        if (
          nextCount > 0 &&
          nextCount % DEFAULTS.summaryRefreshEveryNBatches === 0
        ) {
          void refreshSummary();
        }
      } catch (err) {
        failBatch(
          batchId,
          err instanceof Error ? err.message : "Network error",
        );
      }
    },
    [beginBatch, resolveBatch, failBatch, recentTitlesSelector],
  );

  const refresh = useCallback(async () => {
    const session = useSessionStore.getState();
    if (session.isRecording) {
      flush();
      await waitForNoPendingChunks();
    }
    await generate({ manual: true });
  }, [flush, generate]);

  // Auto-refresh interval — only active while recording.
  const isRecording = useSessionStore((s) => s.isRecording);
  useEffect(() => {
    if (!isRecording) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Reset tracking when a new session starts.
    lastTranscriptLengthRef.current = 0;
    resetSuggestions();

    const settings = useSettingsStore.getState();
    const ms = Math.max(5_000, settings.refreshIntervalSec * 1000);

    intervalRef.current = setInterval(() => {
      void generate();
    }, ms);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isRecording, generate, resetSuggestions]);

  // Unsub cleanup on unmount.
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return {
    batches,
    isGenerating,
    doneBatchCount,
    refresh,
  };
}

async function waitForNoPendingChunks(): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < FLUSH_WAIT_MAX_MS) {
    const pending = useSessionStore
      .getState()
      .chunks.some((c) => c.status === "transcribing");
    if (!pending) return;
    await sleep(FLUSH_WAIT_POLL_MS);
  }
}

async function refreshSummary(): Promise<void> {
  const settings = useSettingsStore.getState();
  const session = useSessionStore.getState();
  const existingSummary = useSuggestionsStore.getState().sessionSummary;

  const transcript = session.fullTranscriptText();
  if (!transcript) return;

  try {
    const res = await fetch("/api/summary", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(settings.groqApiKey
          ? { Authorization: `Bearer ${settings.groqApiKey}` }
          : {}),
      },
      body: JSON.stringify({
        transcript,
        previousSummary: existingSummary || undefined,
      }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { summary?: string };
    if (data.summary) {
      useSuggestionsStore.getState().setSessionSummary(data.summary);
    }
  } catch {
    // summary is best-effort background; swallow
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
