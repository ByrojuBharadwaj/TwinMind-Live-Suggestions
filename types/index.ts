/**
 * Shared types used across the TwinMind Live Suggestions app.
 * Stage 1 defines the skeleton; individual panels fill these in later stages.
 */

export type SuggestionType =
  | "question_to_ask"
  | "talking_point"
  | "answer_to_recent_question"
  | "fact_check"
  | "clarifier";

export interface Suggestion {
  id: string;
  type: SuggestionType;
  title: string;
  preview: string;
  reasoning: string;
}

export interface SuggestionBatch {
  id: string;
  createdAt: number;
  suggestions: Suggestion[];
}

export interface TranscriptChunk {
  id: string;
  text: string;
  startedAt: number;
  endedAt: number;
}

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  /**
   * When a chat message was created by clicking a suggestion card,
   * we keep a back-reference so the export stays faithful.
   */
  sourceSuggestionId?: string;
}

export interface AppSettings {
  groqApiKey: string;
  liveSuggestionsPrompt: string;
  detailedAnswerPrompt: string;
  chatPrompt: string;
  suggestionContextWindowSec: number;
  expandedAnswerContextWindowSec: number;
  refreshIntervalSec: number;
}
