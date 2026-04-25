"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, Mic } from "lucide-react";
import clsx from "clsx";
import { useSessionStore } from "@/store/useSessionStore";
import type { TranscriptChunkWithStatus } from "@/store/useSessionStore";
import { formatClock } from "@/lib/time";

export default function TranscriptPanel() {
  const chunks = useSessionStore((s) => s.chunks);
  const isRecording = useSessionStore((s) => s.isRecording);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chunks, autoScroll]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(nearBottom);
  };

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--panel-border)] px-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
          Transcript
        </h2>
        {isRecording && (
          <span className="flex items-center gap-1.5 text-[11px] text-red-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
            recording
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="scrollbar-thin flex-1 overflow-y-auto p-4"
      >
        {chunks.length === 0 ? (
          <EmptyState isRecording={isRecording} />
        ) : (
          <div className="space-y-3">
            {chunks.map((c) => (
              <ChunkRow key={c.id} chunk={c} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ChunkRow({ chunk }: { chunk: TranscriptChunkWithStatus }) {
  return (
    <div className="text-sm leading-relaxed">
      <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-[var(--muted)]/70">
        <span className="font-mono tabular-nums">
          {formatClock(chunk.startedAt)}
        </span>
        {chunk.status === "transcribing" && (
          <span className="flex items-center gap-1 text-[var(--accent)]">
            <Loader2 size={10} className="animate-spin" />
            transcribing…
          </span>
        )}
        {chunk.status === "error" && (
          <span
            className="flex items-center gap-1 text-red-300"
            title={chunk.error}
          >
            <AlertCircle size={10} />
            failed
          </span>
        )}
      </div>
      <p
        className={clsx(
          "whitespace-pre-wrap",
          chunk.status === "transcribing" && "text-[var(--muted)]/60 italic",
          chunk.status === "error" && "text-red-300/70 italic",
        )}
      >
        {chunk.status === "done"
          ? chunk.text || <span className="opacity-40">(silence)</span>
          : chunk.status === "transcribing"
            ? "…"
            : chunk.error || "Transcription failed."}
      </p>
    </div>
  );
}

function EmptyState({ isRecording }: { isRecording: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center pb-[90px] text-center text-[var(--muted)]">
      <Mic size={32} className="mb-3 opacity-40" />
      {isRecording ? (
        <>
          <p className="text-sm">Listening…</p>
          <p className="mt-1 text-xs opacity-70">
            First transcript arrives in ~30 seconds
          </p>
        </>
      ) : (
        <>
          <p className="text-sm">
            Click <span className="font-medium text-white">Start mic</span> to
            begin
          </p>
          <p className="mt-1 text-xs opacity-70">
            Transcription arrives in ~30-second chunks
          </p>
        </>
      )}
    </div>
  );
}
