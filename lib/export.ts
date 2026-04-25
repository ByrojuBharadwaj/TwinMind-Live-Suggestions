/**
 * Session export — produces a JSON or plain-text dump of everything
 * that happened during the session: transcript, every suggestion batch,
 * and the full chat history, all with timestamps.
 *
 * The assignment reviewers use this to evaluate submissions, so it
 * includes both the rolling session summary and the per-chunk status
 * (done / transcribing / error) for full fidelity.
 */

import { useSessionStore } from "@/store/useSessionStore";
import { useSuggestionsStore } from "@/store/useSuggestionsStore";
import { useChatStore } from "@/store/useChatStore";
import { formatClock } from "@/lib/time";

export interface ExportPayload {
  app: "TwinMind Live Suggestions";
  exportedAt: string;
  session: {
    startedAt: string | null;
    chunkCount: number;
    suggestionBatchCount: number;
    chatMessageCount: number;
  };
  transcript: Array<{
    id: string;
    startedAt: string;
    endedAt: string;
    status: "transcribing" | "done" | "error";
    text: string;
    error?: string;
  }>;
  suggestionBatches: Array<{
    id: string;
    createdAt: string;
    status: "pending" | "done" | "error";
    suggestions: Array<{
      id: string;
      type: string;
      title: string;
      preview: string;
      reasoning: string;
    }>;
    error?: string;
  }>;
  chat: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    createdAt: string;
    sourceSuggestionId?: string;
  }>;
  sessionSummary: string;
}

export function buildExportPayload(): ExportPayload {
  const session = useSessionStore.getState();
  const suggestions = useSuggestionsStore.getState();
  const chat = useChatStore.getState();

  return {
    app: "TwinMind Live Suggestions",
    exportedAt: new Date().toISOString(),
    session: {
      startedAt: session.startedAt
        ? new Date(session.startedAt).toISOString()
        : null,
      chunkCount: session.chunks.length,
      suggestionBatchCount: suggestions.batches.length,
      chatMessageCount: chat.messages.length,
    },
    transcript: session.chunks.map((c) => ({
      id: c.id,
      startedAt: new Date(c.startedAt).toISOString(),
      endedAt: new Date(c.endedAt).toISOString(),
      status: c.status,
      text: c.text,
      error: c.error,
    })),
    // Reverse so exports are oldest-first — easier to read top-down.
    suggestionBatches: [...suggestions.batches]
      .reverse()
      .map((b) => ({
        id: b.id,
        createdAt: new Date(b.createdAt).toISOString(),
        status: b.status,
        suggestions: b.suggestions.map((s) => ({
          id: s.id,
          type: s.type,
          title: s.title,
          preview: s.preview,
          reasoning: s.reasoning,
        })),
        error: b.error,
      })),
    chat: chat.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: new Date(m.createdAt).toISOString(),
      sourceSuggestionId: m.sourceSuggestionId,
    })),
    sessionSummary: suggestions.sessionSummary,
  };
}

export function renderPayloadAsText(p: ExportPayload): string {
  const lines: string[] = [];
  lines.push("TwinMind — Live Suggestions Session Export");
  lines.push(
    `Exported:   ${new Date(p.exportedAt).toLocaleString()}`,
  );
  lines.push(
    `Started:    ${p.session.startedAt ? new Date(p.session.startedAt).toLocaleString() : "—"}`,
  );
  lines.push(
    `Counts:     ${p.session.chunkCount} transcript chunks · ${p.session.suggestionBatchCount} suggestion batches · ${p.session.chatMessageCount} chat messages`,
  );
  lines.push("");

  if (p.sessionSummary) {
    lines.push(sep("SESSION SUMMARY"));
    lines.push(p.sessionSummary);
    lines.push("");
  }

  lines.push(sep("TRANSCRIPT"));
  if (p.transcript.length === 0) lines.push("(empty)");
  for (const c of p.transcript) {
    const t = formatClock(new Date(c.startedAt).getTime());
    const status =
      c.status === "done"
        ? ""
        : c.status === "error"
          ? ` [ERROR: ${c.error ?? "unknown"}]`
          : " [transcribing…]";
    lines.push(`[${t}]${status} ${c.text}`);
  }
  lines.push("");

  lines.push(sep("SUGGESTION BATCHES"));
  if (p.suggestionBatches.length === 0) lines.push("(empty)");
  for (const b of p.suggestionBatches) {
    const t = formatClock(new Date(b.createdAt).getTime());
    lines.push(`-- Batch @ ${t} (${b.status}) --`);
    if (b.status === "error") {
      lines.push(`  ERROR: ${b.error ?? "unknown"}`);
    }
    for (const s of b.suggestions) {
      lines.push(`  [${s.type}] ${s.title}`);
      lines.push(`    preview:   ${s.preview}`);
      if (s.reasoning) lines.push(`    reasoning: ${s.reasoning}`);
    }
    lines.push("");
  }

  lines.push(sep("CHAT"));
  if (p.chat.length === 0) lines.push("(empty)");
  for (const m of p.chat) {
    const t = formatClock(new Date(m.createdAt).getTime());
    const src = m.sourceSuggestionId ? " [from suggestion]" : "";
    lines.push(
      `[${t}] ${m.role.toUpperCase()}${src}: ${m.content.replace(/\n/g, "\n    ")}`,
    );
    lines.push("");
  }

  return lines.join("\n");
}

function sep(title: string): string {
  return `===== ${title} ${"=".repeat(Math.max(0, 60 - title.length))}`;
}

export function downloadFile(
  filename: string,
  contents: string,
  mime: string,
): void {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Let the browser finish the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function exportSession(format: "json" | "text"): void {
  const payload = buildExportPayload();
  const stamp = formatStamp();
  if (format === "json") {
    downloadFile(
      `twinmind-session-${stamp}.json`,
      JSON.stringify(payload, null, 2),
      "application/json",
    );
  } else {
    downloadFile(
      `twinmind-session-${stamp}.txt`,
      renderPayloadAsText(payload),
      "text/plain;charset=utf-8",
    );
  }
}

export function sessionHasContent(): boolean {
  const session = useSessionStore.getState();
  const suggestions = useSuggestionsStore.getState();
  const chat = useChatStore.getState();
  return (
    session.chunks.length > 0 ||
    suggestions.batches.length > 0 ||
    chat.messages.length > 0
  );
}

function formatStamp(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
