"use client";

import { useCallback, useRef } from "react";
import { useChatStore } from "@/store/useChatStore";
import { useSessionStore } from "@/store/useSessionStore";
import { useSettingsStore, SERVER_KEY_AVAILABLE } from "@/store/useSettingsStore";
import { useSuggestionsStore } from "@/store/useSuggestionsStore";
import type { Suggestion } from "@/types";

/**
 * Orchestrates sending messages to /api/chat and streaming deltas into
 * the chat store. Exposes:
 *
 *   • sendMessage(text)     — free-form question from the composer
 *   • expandSuggestion(s)   — user clicked a suggestion card
 *   • stopGeneration()      — cancels an in-flight stream
 */
export function useChatController() {
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const chat = useChatStore.getState();
    if (chat.isStreaming) return;

    chat.addUserMessage(trimmed);
    await streamAssistantResponse({
      mode: "chat",
      userMessage: trimmed,
      abortRef,
    });
  }, []);

  const expandSuggestion = useCallback(async (s: Suggestion) => {
    const chat = useChatStore.getState();
    if (chat.isStreaming) return;

    const userContent = `Expand: ${s.title}`;
    chat.addUserMessage(userContent, s.id);

    await streamAssistantResponse({
      mode: "detailed",
      userMessage: userContent,
      suggestion: s,
      abortRef,
    });
  }, []);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const resetChat = useCallback(() => {
    abortRef.current?.abort();
    useChatStore.getState().reset();
  }, []);

  return { sendMessage, expandSuggestion, stopGeneration, resetChat };
}

interface StreamArgs {
  mode: "chat" | "detailed";
  userMessage: string;
  suggestion?: Suggestion;
  abortRef: React.MutableRefObject<AbortController | null>;
}

async function streamAssistantResponse({
  mode,
  userMessage,
  suggestion,
  abortRef,
}: StreamArgs): Promise<void> {
  const chat = useChatStore.getState();
  const settings = useSettingsStore.getState();
  const session = useSessionStore.getState();
  const suggestions = useSuggestionsStore.getState();

  if (!settings.groqApiKey && !SERVER_KEY_AVAILABLE) {
    chat.setError("Add your Groq API key in Settings first.");
    return;
  }

  const assistantId = chat.beginAssistantMessage();

  // Fresh controller per request; store on ref so stop() can abort it.
  abortRef.current?.abort();
  const controller = new AbortController();
  abortRef.current = controller;

  const transcriptContext =
    settings.expandedAnswerContextWindowSec > 0
      ? session.recentTranscriptText(settings.expandedAnswerContextWindowSec)
      : session.fullTranscriptText();

  const body = {
    mode,
    systemPrompt:
      mode === "detailed"
        ? settings.detailedAnswerPrompt
        : settings.chatPrompt,
    sessionSummary: suggestions.sessionSummary,
    transcriptContext,
    suggestion: suggestion
      ? {
          type: suggestion.type,
          title: suggestion.title,
          preview: suggestion.preview,
          reasoning: suggestion.reasoning,
        }
      : undefined,
    history: chat.historyForRequest(),
    userMessage,
  };

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(settings.groqApiKey
          ? { Authorization: `Bearer ${settings.groqApiKey}` }
          : {}),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      useChatStore
        .getState()
        .failAssistantMessage(
          assistantId,
          errBody.error ?? `HTTP ${res.status}`,
        );
      return;
    }

    if (!res.body) {
      useChatStore
        .getState()
        .failAssistantMessage(assistantId, "Empty response from server.");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (chunk) {
        useChatStore.getState().appendAssistantDelta(assistantId, chunk);
      }
    }

    useChatStore.getState().finalizeAssistantMessage(assistantId);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      // User-initiated stop; treat the current content as final.
      useChatStore.getState().finalizeAssistantMessage(assistantId);
      return;
    }
    useChatStore
      .getState()
      .failAssistantMessage(
        assistantId,
        err instanceof Error ? err.message : "Network error.",
      );
  }
}
