import { NextRequest, NextResponse } from "next/server";
import { extractBearer } from "@/lib/groq";

export const runtime = "nodejs";
export const maxDuration = 60;

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL = "whisper-large-v3";

export async function POST(req: NextRequest) {
  const apiKey =
    extractBearer(req.headers.get("authorization")) ??
    process.env.GROQ_API_KEY ??
    null;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing Groq API key. Add one in Settings." },
      { status: 401 },
    );
  }

  let incoming: FormData;
  try {
    incoming = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data body." },
      { status: 400 },
    );
  }

  const file = incoming.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json(
      { error: "Missing or empty audio file." },
      { status: 400 },
    );
  }

  const language = incoming.get("language");

  // Rebuild the multipart body for Groq. We give the file an explicit
  // name + extension so Groq's content-type sniffing is happy.
  const outgoing = new FormData();
  outgoing.append("file", file, "chunk.webm");
  outgoing.append("model", MODEL);
  outgoing.append("response_format", "json");
  outgoing.append("temperature", "0");
  if (typeof language === "string" && language.length > 0) {
    outgoing.append("language", language);
  }

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: outgoing,
    });

    if (!res.ok) {
      const detail = await safeText(res);
      return NextResponse.json(
        {
          error: `Groq transcription failed (${res.status}).`,
          detail,
        },
        { status: res.status },
      );
    }

    const data = (await res.json()) as { text?: string };
    return NextResponse.json({ text: (data.text ?? "").trim() });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Network error contacting Groq.",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}
