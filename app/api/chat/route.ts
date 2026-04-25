import { NextRequest, NextResponse } from "next/server";
import {
  GROQ_CHAT_URL,
  CHAT_MODEL,
  extractBearer,
  type GroqMessage,
} from "@/lib/groq";
import type { Suggestion } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RequestBody {
  mode: "chat" | "detailed";
  systemPrompt: string;
  sessionSummary: string;
  transcriptContext: string;
  suggestion?: Pick<Suggestion, "type" | "title" | "preview" | "reasoning">;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
}

/**
 * Streaming chat endpoint.
 *
 *   - Parses Groq's OpenAI-style SSE upstream and emits raw text deltas to
 *     the browser as plain text (not SSE). The client just reads the stream.
 *   - Aborts the Groq request if the client disconnects.
 *   - Shape supports two modes with the same infrastructure:
 *       "chat"     — free-form question from the user's textarea
 *       "detailed" — a suggestion card was clicked; we frame the prompt
 *                    using the tuned detailed-answer system prompt
 */
export async function POST(req: NextRequest) {
  const apiKey =
    extractBearer(req.headers.get("authorization")) ??
    process.env.GROQ_API_KEY ??
    null;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing Groq API key." },
      { status: 401 },
    );
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const messages = buildMessages(body);

  const upstream = await fetch(GROQ_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      temperature: body.mode === "detailed" ? 0.4 : 0.5,
      max_tokens: 1500,
      stream: true,
      messages,
    }),
    signal: req.signal,
  }).catch((err) => {
    return new Response(
      JSON.stringify({
        error: "Network error contacting Groq.",
        detail: err instanceof Error ? err.message : String(err),
      }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: `Groq error (${upstream.status}).`, detail: detail.slice(0, 500) },
      { status: upstream.status },
    );
  }

  if (!upstream.body) {
    return NextResponse.json(
      { error: "Groq returned an empty stream." },
      { status: 502 },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = "";

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Groq SSE frames are "\n\n"-separated; each starts with "data: ".
          let sep: number;
          while ((sep = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, sep).trim();
            buffer = buffer.slice(sep + 2);
            if (!frame.startsWith("data:")) continue;

            const payload = frame.slice(5).trim();
            if (payload === "[DONE]") {
              controller.close();
              return;
            }

            try {
              const json = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) controller.enqueue(encoder.encode(delta));
            } catch {
              // Ignore malformed frames — keep streaming.
            }
          }
        }
        controller.close();
      } catch (err) {
        // Client abort is expected; surface any other error as a terminal text.
        if (
          err instanceof Error &&
          (err.name === "AbortError" || req.signal.aborted)
        ) {
          // swallow
        } else {
          const msg =
            "\n\n[stream interrupted: " +
            (err instanceof Error ? err.message : "unknown") +
            "]";
          controller.enqueue(new TextEncoder().encode(msg));
        }
        controller.close();
      } finally {
        reader.releaseLock();
      }
    },
    cancel() {
      // Client disconnected — upstream is aborted via req.signal wiring above.
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-content-type-options": "nosniff",
    },
  });
}

function buildMessages(b: RequestBody): GroqMessage[] {
  const summary = b.sessionSummary.trim();
  const transcript = b.transcriptContext.trim();

  const contextLines: string[] = [];
  if (summary) contextLines.push(`SESSION_SUMMARY:\n${summary}`);
  contextLines.push(
    `TRANSCRIPT_CONTEXT:\n${transcript || "(meeting has just started or is silent)"}`,
  );

  if (b.mode === "detailed" && b.suggestion) {
    contextLines.push(
      `SELECTED_SUGGESTION:\ntype: ${b.suggestion.type}\ntitle: ${b.suggestion.title}\npreview: ${b.suggestion.preview}\nreasoning: ${b.suggestion.reasoning}`,
    );
  }

  const system =
    b.systemPrompt.trim() + "\n\n---\n\n" + contextLines.join("\n\n");

  const messages: GroqMessage[] = [{ role: "system", content: system }];
  for (const h of b.history) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: "user", content: b.userMessage });
  return messages;
}
