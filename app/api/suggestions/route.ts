import { NextRequest, NextResponse } from "next/server";
import {
  callGroq,
  extractBearer,
  SUGGESTIONS_MODEL,
  type GroqChatResponse,
} from "@/lib/groq";
import type { Suggestion, SuggestionType } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_TYPES: SuggestionType[] = [
  "question_to_ask",
  "talking_point",
  "answer_to_recent_question",
  "fact_check",
  "clarifier",
];

interface RequestBody {
  systemPrompt: string;
  recentTranscript: string;
  sessionSummary: string;
  recentTitles: string[];
}

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

  const userMessage = buildUserMessage(body);

  const groqRes = await callGroq(apiKey, {
    model: SUGGESTIONS_MODEL,
    temperature: 0.5,
    max_tokens: 900,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: body.systemPrompt },
      { role: "user", content: userMessage },
    ],
  });

  if (!groqRes.ok) {
    const detail = await groqRes.text().catch(() => "");
    return NextResponse.json(
      {
        error: `Groq error (${groqRes.status}).`,
        detail: detail.slice(0, 500),
      },
      { status: groqRes.status },
    );
  }

  const data = (await groqRes.json()) as GroqChatResponse;
  const content = data.choices?.[0]?.message?.content ?? "";

  const parsed = safeParse(content);
  if (!parsed) {
    return NextResponse.json(
      { error: "Model returned invalid JSON.", detail: content.slice(0, 500) },
      { status: 502 },
    );
  }

  const suggestions = normalize(parsed);
  if (suggestions.length !== 3) {
    return NextResponse.json(
      {
        error: `Expected 3 suggestions, got ${suggestions.length}.`,
        detail: content.slice(0, 500),
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ suggestions });
}

function buildUserMessage(b: RequestBody): string {
  const summary = b.sessionSummary.trim() || "(none yet)";
  const transcript = b.recentTranscript.trim() || "(silence)";
  const titles =
    b.recentTitles.length > 0
      ? b.recentTitles.map((t) => `- ${t}`).join("\n")
      : "(none)";

  return [
    `SESSION_SUMMARY:\n${summary}`,
    `RECENT_TRANSCRIPT:\n${transcript}`,
    `RECENT_TITLES (do NOT repeat or paraphrase):\n${titles}`,
    `Return exactly 3 suggestions as strict JSON per the schema.`,
  ].join("\n\n");
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Fallback: try to pull the first {...} block out of the string
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function normalize(raw: unknown): Omit<Suggestion, "id">[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as { suggestions?: unknown };
  if (!Array.isArray(obj.suggestions)) return [];

  return obj.suggestions
    .slice(0, 3)
    .map((s): Omit<Suggestion, "id"> | null => {
      if (!s || typeof s !== "object") return null;
      const record = s as Record<string, unknown>;
      const type = record.type;
      const title = record.title;
      const preview = record.preview;
      const reasoning = record.reasoning;

      if (
        typeof type !== "string" ||
        !VALID_TYPES.includes(type as SuggestionType) ||
        typeof title !== "string" ||
        typeof preview !== "string"
      ) {
        return null;
      }

      return {
        type: type as SuggestionType,
        title: title.trim().slice(0, 140),
        preview: preview.trim().slice(0, 400),
        reasoning:
          typeof reasoning === "string" ? reasoning.trim().slice(0, 240) : "",
      };
    })
    .filter((s): s is Omit<Suggestion, "id"> => s !== null);
}
