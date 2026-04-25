/**
 * Shared helpers for Groq chat-completion calls from our API routes.
 *
 * We proxy through our own routes rather than calling Groq directly from
 * the browser so that Stage 4 (streaming chat) has the same surface.
 * Non-streaming JSON calls (suggestions, summary) also live here.
 */

export const GROQ_CHAT_URL =
  "https://api.groq.com/openai/v1/chat/completions";

export const SUGGESTIONS_MODEL = "openai/gpt-oss-120b";
export const SUMMARY_MODEL = "openai/gpt-oss-120b";
export const CHAT_MODEL = "openai/gpt-oss-120b";

export interface GroqMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GroqChatRequest {
  model: string;
  messages: GroqMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" };
  stream?: boolean;
}

export interface GroqChatResponse {
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
}

export function extractBearer(auth: string | null): string | null {
  if (!auth?.startsWith("Bearer ")) return null;
  const key = auth.slice(7).trim();
  return key || null;
}

export async function callGroq(
  apiKey: string,
  body: GroqChatRequest,
): Promise<Response> {
  return fetch(GROQ_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
}
