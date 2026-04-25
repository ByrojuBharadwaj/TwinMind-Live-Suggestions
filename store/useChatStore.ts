"use client";

import { create } from "zustand";
import type { ChatMessage } from "@/types";

/**
 * Chat state for the current session. Not persisted across reloads.
 * Messages are stored in the order they were produced (oldest first).
 */

interface ChatState {
  messages: ChatMessage[];
  /** True while an assistant message is still being streamed. */
  isStreaming: boolean;
  /** ID of the currently-streaming assistant message, if any. */
  streamingId: string | null;
  /** Last error surfaced to the user (e.g. Groq failure). */
  lastError: string | null;

  addUserMessage: (content: string, sourceSuggestionId?: string) => string;
  beginAssistantMessage: () => string;
  appendAssistantDelta: (id: string, delta: string) => void;
  finalizeAssistantMessage: (id: string) => void;
  failAssistantMessage: (id: string, error: string) => void;

  setError: (error: string | null) => void;
  reset: () => void;

  /** Recent history in OpenAI chat format for the next API call. */
  historyForRequest: (max?: number) => Array<{
    role: "user" | "assistant";
    content: string;
  }>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  streamingId: null,
  lastError: null,

  addUserMessage: (content, sourceSuggestionId) => {
    const id = crypto.randomUUID();
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id,
          role: "user",
          content,
          createdAt: Date.now(),
          sourceSuggestionId,
        },
      ],
    }));
    return id;
  },

  beginAssistantMessage: () => {
    const id = crypto.randomUUID();
    set((state) => ({
      isStreaming: true,
      streamingId: id,
      lastError: null,
      messages: [
        ...state.messages,
        { id, role: "assistant", content: "", createdAt: Date.now() },
      ],
    }));
    return id;
  },

  appendAssistantDelta: (id, delta) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, content: m.content + delta } : m,
      ),
    })),

  finalizeAssistantMessage: (id) =>
    set((state) => ({
      isStreaming: false,
      streamingId: state.streamingId === id ? null : state.streamingId,
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, content: m.content.trim() } : m,
      ),
    })),

  failAssistantMessage: (id, error) =>
    set((state) => ({
      isStreaming: false,
      streamingId: state.streamingId === id ? null : state.streamingId,
      lastError: error,
      messages: state.messages.map((m) =>
        m.id === id
          ? {
              ...m,
              content: m.content || `⚠ ${error}`,
            }
          : m,
      ),
    })),

  setError: (error) => set({ lastError: error }),

  reset: () =>
    set({
      messages: [],
      isStreaming: false,
      streamingId: null,
      lastError: null,
    }),

  historyForRequest: (max = 12) => {
    // Take the last N messages, excluding the currently-streaming one.
    const { messages, streamingId } = get();
    const filtered = messages.filter(
      (m) => m.id !== streamingId && m.content.length > 0,
    );
    const sliced = filtered.slice(-max);
    return sliced.map((m) => ({
      role: m.role,
      content: m.content,
    }));
  },
}));
