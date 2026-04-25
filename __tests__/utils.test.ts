import { describe, it, expect } from "vitest";
import { formatElapsed, formatClock } from "@/lib/time";
import { extractBearer } from "@/lib/groq";
import { renderPayloadAsText } from "@/lib/export";
import type { ExportPayload } from "@/lib/export";

// ─── 1. formatElapsed ────────────────────────────────────────────────────────

describe("formatElapsed", () => {
  it("formats zero milliseconds as 0:00", () => {
    expect(formatElapsed(0)).toBe("0:00");
  });

  it("pads single-digit seconds with a leading zero", () => {
    expect(formatElapsed(65_000)).toBe("1:05");
  });

  it("handles negative input by clamping to 0:00", () => {
    expect(formatElapsed(-5000)).toBe("0:00");
  });

  it("formats large durations without truncating minutes", () => {
    // 3661 seconds = 61 minutes 1 second
    expect(formatElapsed(3_661_000)).toBe("61:01");
  });
});

// ─── 2. formatClock ──────────────────────────────────────────────────────────

describe("formatClock", () => {
  it("returns a string with two colons (hh:mm:ss shape)", () => {
    const result = formatClock(Date.now());
    expect(result.split(":")).toHaveLength(3);
  });

  it("produces consistent output for the same timestamp", () => {
    const ts = new Date("2026-04-24T14:08:30").getTime();
    expect(formatClock(ts)).toBe(formatClock(ts));
  });
});

// ─── 3. extractBearer ────────────────────────────────────────────────────────

describe("extractBearer", () => {
  it("extracts the token from a well-formed Authorization header", () => {
    expect(extractBearer("Bearer gsk_abc123")).toBe("gsk_abc123");
  });

  it("returns null when the header is missing", () => {
    expect(extractBearer(null)).toBeNull();
  });

  it("returns null when the header is not a Bearer token", () => {
    expect(extractBearer("Basic dXNlcjpwYXNz")).toBeNull();
  });

  it("returns null when the token value is an empty string after the prefix", () => {
    expect(extractBearer("Bearer ")).toBeNull();
  });
});

// ─── 4. renderPayloadAsText ──────────────────────────────────────────────────

describe("renderPayloadAsText", () => {
  const minimal: ExportPayload = {
    app: "TwinMind Live Suggestions",
    exportedAt: new Date("2026-04-24T10:00:00Z").toISOString(),
    session: {
      startedAt: new Date("2026-04-24T09:00:00Z").toISOString(),
      chunkCount: 1,
      suggestionBatchCount: 1,
      chatMessageCount: 1,
    },
    transcript: [
      {
        id: "c1",
        startedAt: new Date("2026-04-24T09:00:00Z").toISOString(),
        endedAt: new Date("2026-04-24T09:00:30Z").toISOString(),
        status: "done",
        text: "Hello world",
      },
    ],
    suggestionBatches: [
      {
        id: "b1",
        createdAt: new Date("2026-04-24T09:00:32Z").toISOString(),
        status: "done",
        suggestions: [
          {
            id: "s1",
            type: "question_to_ask",
            title: "What is the deadline?",
            preview: "No deadline has been mentioned yet.",
            reasoning: "Decisions pending",
          },
        ],
      },
    ],
    chat: [
      {
        id: "m1",
        role: "user",
        content: "Can you summarise?",
        createdAt: new Date("2026-04-24T09:01:00Z").toISOString(),
      },
    ],
    sessionSummary: "• Meeting about project scope",
  };

  it("includes the TRANSCRIPT section header", () => {
    expect(renderPayloadAsText(minimal)).toContain("TRANSCRIPT");
  });

  it("includes the SUGGESTION BATCHES section header", () => {
    expect(renderPayloadAsText(minimal)).toContain("SUGGESTION BATCHES");
  });

  it("includes the CHAT section header", () => {
    expect(renderPayloadAsText(minimal)).toContain("CHAT");
  });

  it("includes the transcript text in the output", () => {
    expect(renderPayloadAsText(minimal)).toContain("Hello world");
  });

  it("includes the session summary when present", () => {
    expect(renderPayloadAsText(minimal)).toContain("Meeting about project scope");
  });
});
