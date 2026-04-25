import { NextRequest, NextResponse } from "next/server";
import { extractBearer } from "@/lib/groq";

/**
 * Lightweight pre-flight check for a user-supplied Groq API key.
 *
 * Calls Groq's public `/models` endpoint — the cheapest authenticated call
 * available — and maps the response to a simple `{ ok }` payload so the
 * client can run this before starting the recorder without leaking
 * provider-specific details into the UI.
 */

export const runtime = "nodejs";

const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";

export async function GET(req: NextRequest) {
  const apiKey =
    extractBearer(req.headers.get("authorization")) ??
    process.env.GROQ_API_KEY ??
    null;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "Missing Groq API key." },
      { status: 401 },
    );
  }

  try {
    const res = await fetch(GROQ_MODELS_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (res.status === 401 || res.status === 403) {
      return NextResponse.json(
        { ok: false, error: "Invalid Groq API key." },
        { status: 401 },
      );
    }

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `Groq returned ${res.status}.` },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "Network error contacting Groq.",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
