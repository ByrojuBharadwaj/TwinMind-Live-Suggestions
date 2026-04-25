"use client";

import { useEffect, useRef, useState } from "react";
import {
  Circle,
  Download,
  FileJson,
  FileText,
  Mic,
  MicOff,
  Settings,
} from "lucide-react";
import clsx from "clsx";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useSessionStore } from "@/store/useSessionStore";
import { useSuggestionsStore } from "@/store/useSuggestionsStore";
import { useChatStore } from "@/store/useChatStore";
import { formatElapsed } from "@/lib/time";

interface HeaderProps {
  isRecording: boolean;
  onToggleRecording: () => void;
  onOpenSettings: () => void;
  onExport: (format: "json" | "text") => void;
}

export default function Header({
  isRecording,
  onToggleRecording,
  onOpenSettings,
  onExport,
}: HeaderProps) {
  const hasApiKey = useSettingsStore((s) => Boolean(s.groqApiKey));
  const startedAt = useSessionStore((s) => s.startedAt);

  const chunkCount = useSessionStore((s) => s.chunks.length);
  const batchCount = useSuggestionsStore((s) => s.batches.length);
  const chatCount = useChatStore((s) => s.messages.length);
  const canExport = chunkCount + batchCount + chatCount > 0;

  return (
    <header className="flex items-center justify-between border-b border-[var(--panel-border)] bg-[var(--panel)] px-5 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--accent)] to-[#4a3bd4] text-sm font-bold">
          TM
        </div>
        <div>
          <h1 className="text-sm font-semibold tracking-tight">
            TwinMind
            <span className="ml-2 text-[var(--muted)] font-normal">
              Live Suggestions
            </span>
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {isRecording && startedAt && <RecordingTimer startedAt={startedAt} />}

        {!hasApiKey && (
          <button
            onClick={onOpenSettings}
            className="rounded-md bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 ring-1 ring-amber-400/30 hover:bg-amber-500/20"
          >
            Add Groq API key
          </button>
        )}

        <button
          onClick={onToggleRecording}
          disabled={!hasApiKey}
          className={clsx(
            "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition",
            isRecording
              ? "bg-red-500/15 text-red-300 ring-1 ring-red-400/40 hover:bg-red-500/25"
              : "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]",
            !hasApiKey && "cursor-not-allowed opacity-40",
          )}
          title={hasApiKey ? undefined : "Add a Groq API key to start"}
        >
          {isRecording ? (
            <>
              <Circle
                size={10}
                className="fill-red-400 text-red-400 animate-pulse"
              />
              <MicOff size={16} />
              Stop
            </>
          ) : (
            <>
              <Mic size={16} />
              Start mic
            </>
          )}
        </button>

        <ExportMenu disabled={!canExport} onExport={onExport} />

        <button
          onClick={onOpenSettings}
          className="rounded-md p-2 text-[var(--muted)] hover:bg-white/5 hover:text-white"
          title="Settings"
        >
          <Settings size={16} />
        </button>
      </div>
    </header>
  );
}

function ExportMenu({
  disabled,
  onExport,
}: {
  disabled: boolean;
  onExport: (format: "json" | "text") => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    window.addEventListener("keydown", keyHandler);
    return () => {
      window.removeEventListener("mousedown", handler);
      window.removeEventListener("keydown", keyHandler);
    };
  }, [open]);

  const choose = (format: "json" | "text") => {
    setOpen(false);
    onExport(format);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={clsx(
          "rounded-md p-2 text-[var(--muted)] transition",
          disabled
            ? "cursor-not-allowed opacity-40"
            : "hover:bg-white/5 hover:text-white",
        )}
        title={disabled ? "Nothing to export yet" : "Export session"}
      >
        <Download size={16} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] shadow-xl">
          <button
            onClick={() => choose("json")}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-white/5"
          >
            <FileJson size={14} className="text-[var(--accent)]" />
            <div>
              <div className="font-medium">Export as JSON</div>
              <div className="text-[10px] text-[var(--muted)]/70">
                Full structured session
              </div>
            </div>
          </button>
          <button
            onClick={() => choose("text")}
            className="flex w-full items-center gap-2 border-t border-[var(--panel-border)] px-3 py-2 text-left text-xs hover:bg-white/5"
          >
            <FileText size={14} className="text-[var(--accent)]" />
            <div>
              <div className="font-medium">Export as plain text</div>
              <div className="text-[10px] text-[var(--muted)]/70">
                Readable transcript + cards + chat
              </div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}

function RecordingTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="font-mono text-xs tabular-nums text-[var(--muted)]">
      {formatElapsed(now - startedAt)}
    </span>
  );
}
