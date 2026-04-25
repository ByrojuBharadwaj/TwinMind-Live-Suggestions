"use client";

import { AlertCircle, RefreshCw, Sparkles } from "lucide-react";
import clsx from "clsx";
import { useSuggestionsStore } from "@/store/useSuggestionsStore";
import { useSessionStore } from "@/store/useSessionStore";
import type { Suggestion, SuggestionType } from "@/types";
import type { BatchWithStatus } from "@/store/useSuggestionsStore";
import { formatClock } from "@/lib/time";

interface SuggestionsPanelProps {
  onRefresh: () => void;
  onSelectSuggestion: (s: Suggestion) => void;
}

export default function SuggestionsPanel({
  onRefresh,
  onSelectSuggestion,
}: SuggestionsPanelProps) {
  const batches = useSuggestionsStore((s) => s.batches);
  const isGenerating = useSuggestionsStore((s) => s.isGenerating);
  const isRecording = useSessionStore((s) => s.isRecording);

  const refreshDisabled = isGenerating || (!isRecording && batches.length === 0);

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--panel-border)] px-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
          Live Suggestions
        </h2>
        <button
          onClick={onRefresh}
          disabled={refreshDisabled}
          className={clsx(
            "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition",
            refreshDisabled
              ? "text-[var(--muted)] opacity-40"
              : "text-[var(--muted)] hover:bg-white/5 hover:text-white",
          )}
          title={
            isGenerating
              ? "Generating…"
              : isRecording
                ? "Refresh suggestions now"
                : "Start the mic first"
          }
        >
          <RefreshCw
            size={12}
            className={clsx(isGenerating && "animate-spin")}
          />
          Refresh
        </button>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto p-4">
        {batches.length === 0 ? (
          <EmptyState isRecording={isRecording} />
        ) : (
          <div className="space-y-5">
            {batches.map((batch) => (
              <BatchBlock
                key={batch.id}
                batch={batch}
                onSelectSuggestion={onSelectSuggestion}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function BatchBlock({
  batch,
  onSelectSuggestion,
}: {
  batch: BatchWithStatus;
  onSelectSuggestion: (s: Suggestion) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-[var(--muted)]/60">
        <span className="font-mono tabular-nums">
          {formatClock(batch.createdAt)}
        </span>
        <div className="h-px flex-1 bg-[var(--panel-border)]" />
      </div>

      {batch.status === "pending" && <BatchSkeleton />}

      {batch.status === "error" && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Suggestions failed</div>
            <div className="mt-0.5 opacity-80">
              {batch.error ?? "Unknown error"}
            </div>
          </div>
        </div>
      )}

      {batch.status === "done" && (
        <div className="space-y-2">
          {batch.suggestions.map((s) => (
            <SuggestionCard
              key={s.id}
              suggestion={s}
              onClick={() => onSelectSuggestion(s)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SuggestionCard({
  suggestion,
  onClick,
}: {
  suggestion: Suggestion;
  onClick: () => void;
}) {
  const meta = TYPE_META[suggestion.type];
  return (
    <button
      onClick={onClick}
      title={suggestion.reasoning || undefined}
      className="group w-full rounded-lg border border-[var(--panel-border)] bg-[var(--background)] p-3 text-left transition hover:-translate-y-[1px] hover:border-[var(--accent)]/50 hover:shadow-[0_2px_16px_rgba(124,92,255,0.08)]"
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className={clsx(
            "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ring-1",
            meta.badge,
          )}
        >
          {meta.label}
        </span>
      </div>
      <div className="text-sm font-medium leading-snug text-white">
        {suggestion.title}
      </div>
      <div className="mt-1 text-xs leading-relaxed text-[var(--muted)] group-hover:text-[var(--foreground)]/80">
        {suggestion.preview}
      </div>
    </button>
  );
}

function BatchSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="animate-pulse rounded-lg border border-[var(--panel-border)] bg-[var(--background)] p-3"
        >
          <div className="mb-2 h-3 w-16 rounded bg-white/5" />
          <div className="mb-1.5 h-3.5 w-3/4 rounded bg-white/10" />
          <div className="h-3 w-full rounded bg-white/5" />
          <div className="mt-1 h-3 w-5/6 rounded bg-white/5" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ isRecording }: { isRecording: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center pb-[90px] text-center text-[var(--muted)]">
      <Sparkles size={32} className="mb-3 opacity-40" />
      {isRecording ? (
        <>
          <p className="text-sm">Listening for context…</p>
          <p className="mt-1 text-xs opacity-70">
            3 suggestions will appear once transcript lands
          </p>
        </>
      ) : (
        <>
          <p className="text-sm">No suggestions yet</p>
          <p className="mt-1 text-xs opacity-70">
            Start recording - 3 fresh cards every ~30 seconds
          </p>
        </>
      )}
    </div>
  );
}

const TYPE_META: Record<
  SuggestionType,
  { label: string; badge: string }
> = {
  question_to_ask: {
    label: "Ask",
    badge: "bg-sky-500/10 text-sky-300 ring-sky-400/30",
  },
  talking_point: {
    label: "Point",
    badge: "bg-violet-500/10 text-violet-300 ring-violet-400/30",
  },
  answer_to_recent_question: {
    label: "Answer",
    badge: "bg-emerald-500/10 text-emerald-300 ring-emerald-400/30",
  },
  fact_check: {
    label: "Fact-check",
    badge: "bg-amber-500/10 text-amber-300 ring-amber-400/30",
  },
  clarifier: {
    label: "Clarify",
    badge: "bg-fuchsia-500/10 text-fuchsia-300 ring-fuchsia-400/30",
  },
};
