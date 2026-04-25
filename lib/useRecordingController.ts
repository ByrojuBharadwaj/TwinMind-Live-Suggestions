"use client";

import { useCallback, useEffect, useRef } from "react";
import { useSessionStore } from "@/store/useSessionStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { ChunkedRecorder } from "@/lib/recorder";
import { runPreflight } from "@/lib/preflight";

const CHUNK_MS = 30_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [300, 1_200, 4_800];

/**
 * Orchestrates the microphone lifecycle:
 *   - Starts/stops a ChunkedRecorder
 *   - On each 30s chunk, POSTs it to /api/transcribe with the user's key
 *   - Updates the session store (pending → done/error) per chunk
 *   - Retries with exponential backoff on 429 / 5xx
 */
export function useRecordingController() {
  const recorderRef = useRef<ChunkedRecorder | null>(null);

  const {
    isRecording,
    setRecording,
    addPendingChunk,
    resolveChunk,
    failChunk,
    reset,
  } = useSessionStore();

  const start = useCallback(async () => {
    if (recorderRef.current) return;

    const apiKey = useSettingsStore.getState().groqApiKey;
    if (!apiKey) {
      throw new Error("Add your Groq API key in Settings first.");
    }

    // Pre-flight gate: browser capability, mic hardware, and key validity.
    // Runs before we touch the microphone so the user sees an actionable
    // error instantly instead of a cryptic failure 30 seconds later.
    const check = await runPreflight({ apiKey });
    if (!check.ok) {
      const msg = check.hint ? `${check.reason} ${check.hint}` : check.reason;
      throw new Error(msg);
    }

    reset();
    setRecording(true, Date.now());

    const recorder = new ChunkedRecorder({
      chunkMs: CHUNK_MS,
      onChunk: (blob, startedAt, endedAt) => {
        const id = crypto.randomUUID();
        addPendingChunk({ id, startedAt, endedAt });
        void transcribeWithRetry({
          id,
          blob,
          apiKey,
          onDone: (text) => resolveChunk(id, text),
          onFail: (error) => failChunk(id, error),
        });
      },
      onError: (err) => {
        console.error("[recorder]", err);
      },
    });

    try {
      await recorder.start();
      recorderRef.current = recorder;
    } catch (err) {
      setRecording(false);
      throw err;
    }
  }, [addPendingChunk, failChunk, resolveChunk, reset, setRecording]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }, [setRecording]);

  /**
   * Forces the current audio chunk to close immediately. Called by the
   * Suggestions panel's refresh button so the freshest audio lands in
   * the transcript before suggestions regenerate. No-op if not recording.
   */
  const flush = useCallback(() => {
    recorderRef.current?.flush();
  }, []);

  useEffect(() => {
    return () => {
      recorderRef.current?.stop();
      recorderRef.current = null;
    };
  }, []);

  return { isRecording, start, stop, flush };
}

interface TranscribeArgs {
  id: string;
  blob: Blob;
  apiKey: string;
  onDone: (text: string) => void;
  onFail: (error: string) => void;
}

async function transcribeWithRetry({
  blob,
  apiKey,
  onDone,
  onFail,
}: TranscribeArgs) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const fd = new FormData();
      fd.append("file", blob, "chunk.webm");

      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: fd,
      });

      if (res.ok) {
        const data = (await res.json()) as { text?: string };
        onDone((data.text ?? "").trim());
        return;
      }

      const retriable = res.status === 429 || res.status >= 500;
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!retriable || attempt === MAX_ATTEMPTS - 1) {
        onFail(body.error ?? `HTTP ${res.status}`);
        return;
      }
    } catch (err) {
      if (attempt === MAX_ATTEMPTS - 1) {
        onFail(err instanceof Error ? err.message : "Network error");
        return;
      }
    }

    await sleep(BACKOFF_MS[attempt]);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
