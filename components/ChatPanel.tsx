"use client";

import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Check, Copy, MessageSquare, Send, Square } from "lucide-react";
import clsx from "clsx";
import { useChatStore } from "@/store/useChatStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import type { ChatMessage } from "@/types";
import MarkdownMessage from "@/components/MarkdownMessage";

interface ChatPanelProps {
  onSend: (text: string) => void;
  onStop: () => void;
}

export default function ChatPanel({ onSend, onStop }: ChatPanelProps) {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const lastError = useChatStore((s) => s.lastError);
  const setError = useChatStore((s) => s.setError);
  const hasApiKey = useSettingsStore((s) => Boolean(s.groqApiKey));

  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, autoScroll]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || isStreaming || !hasApiKey) return;
    onSend(text);
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const placeholder = hasApiKey
    ? "Ask anything about this meeting…"
    : "Add a Groq API key in Settings to chat";

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--panel-border)] px-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
          Chat
        </h2>
        {isStreaming && (
          <span className="flex items-center gap-1.5 text-[11px] text-[var(--accent)]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
            generating…
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="scrollbar-thin flex-1 overflow-y-auto p-4"
      >
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-4">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
          </div>
        )}
      </div>

      {lastError && (
        <div className="flex items-start justify-between gap-2 border-t border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300">
          <span>{lastError}</span>
          <button
            onClick={() => setError(null)}
            className="shrink-0 rounded px-2 py-0.5 text-[11px] text-red-200 hover:bg-red-500/20"
          >
            Dismiss
          </button>
        </div>
      )}

      <form
        onSubmit={submit}
        className="border-t border-[var(--panel-border)] p-3"
      >
        <div className="flex items-center gap-2 rounded-lg border border-[var(--panel-border)] bg-[var(--background)] p-2 focus-within:border-[var(--accent)]/60">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={!hasApiKey}
            rows={1}
            placeholder={placeholder}
            className="scrollbar-thin max-h-32 flex-1 resize-none bg-transparent text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]/70 focus:outline-none disabled:cursor-not-allowed"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              className="rounded-md bg-red-500/20 p-1.5 text-red-300 ring-1 ring-red-400/30 hover:bg-red-500/30"
              title="Stop generating"
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!draft.trim() || !hasApiKey}
              className={clsx(
                "rounded-md p-1.5 text-white transition",
                draft.trim() && hasApiKey
                  ? "bg-[var(--accent)] hover:bg-[var(--accent-hover)]"
                  : "bg-[var(--accent)]/30 cursor-not-allowed",
              )}
              title="Send"
            >
              <Send size={14} />
            </button>
          )}
        </div>
        <p className="mt-2 text-[11px] text-[var(--muted)]/70">
          Enter = sends | Shift+Enter = newline
        </p>
      </form>
    </section>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const streamingId = useChatStore((s) => s.streamingId);
  const isStillStreaming =
    !isUser && streamingId === message.id && message.content.length > 0;

  return (
    <div
      className={clsx(
        "flex flex-col",
        isUser ? "items-end" : "items-start",
      )}
    >
      <div
        className={clsx(
          "max-w-[92%] rounded-lg px-3 py-2 text-sm leading-relaxed",
          isUser
            ? "bg-[var(--accent)]/15 text-[var(--foreground)] ring-1 ring-[var(--accent)]/30"
            : "bg-[var(--background)] text-[var(--foreground)] ring-1 ring-[var(--panel-border)]",
        )}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap">{message.content}</div>
        ) : (
          <div>
            {message.content ? (
              <MarkdownMessage content={message.content} />
            ) : (
              streamingId === message.id && (
                <span className="text-[var(--muted)]">…</span>
              )
            )}
            {isStillStreaming && (
              <span className="ml-0.5 inline-block h-3 w-1.5 -translate-y-[1px] animate-pulse bg-[var(--accent)]" />
            )}
          </div>
        )}
      </div>
      {!isUser && message.content.length > 0 && (
        <CopyButton text={message.content} />
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — clipboard blocked in some contexts
    }
  };
  return (
    <button
      onClick={onClick}
      className="mt-1 flex items-center gap-1 text-[10px] text-[var(--muted)]/60 hover:text-[var(--muted)]"
      title="Copy"
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center text-[var(--muted)]">
      <MessageSquare size={32} className="mb-3 opacity-40" />
      <p className="text-sm">Click a suggestion to expand</p>
      <p className="mt-1 text-xs opacity-70">
        Or type your own question below
      </p>
    </div>
  );
}
