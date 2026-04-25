import { NextRequest, NextResponse } from "next/server";
import {
  callGroq,
  extractBearer,
  SUMMARY_MODEL,
  type GroqChatResponse,
} from "@/lib/groq";
import { SUMMARY_SYSTEM_PROMPT } from "@/config/prompts";

export const runtime = "nodejs";
export const maxDuration = 30;

interface RequestBody {
  transcript: string;
  previousSummary?: string;
}

export async function POST(req: NextRequest) {
  const apiKey = extractBearer(req.headers.get("authorization"));
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

  const transcript = body.transcript.trim();
  if (!transcript) {
    return NextResponse.json({ summary: "" });
  }

  const user = body.previousSummary
    ? `PREVIOUS_SUMMARY:\n${body.previousSummary}\n\nFULL_TRANSCRIPT:\n${transcript}\n\nRegenerate the running summary with any new content.`
    : `TRANSCRIPT:\n${transcript}\n\nWrite the running summary.`;

  const groqRes = await callGroq(apiKey, {
    model: SUMMARY_MODEL,
    temperature: 0.2,
    max_tokens: 500,
    messages: [
      { role: "system", content: SUMMARY_SYSTEM_PROMPT },
      { role: "user", content: user },
    ],
  });

  if (!groqRes.ok) {
    const detail = await groqRes.text().catch(() => "");
    return NextResponse.json(
      { error: `Groq error (${groqRes.status}).`, detail: detail.slice(0, 500) },
      { status: groqRes.status },
    );
  }

  const data = (await groqRes.json()) as GroqChatResponse;
  const summary = (data.choices?.[0]?.message?.content ?? "").trim();

  return NextResponse.json({ summary });
}
