/**
 * Default settings for TwinMind Live Suggestions.
 *
 * The long-form prompt text lives in `config/prompts.ts` to keep this file
 * skimmable. Numeric parameters and re-exports live here.
 *
 * Users can override any of these from the Settings modal; overrides
 * persist to localStorage via the Zustand `persist` middleware.
 */

import {
  LIVE_SUGGESTIONS_PROMPT,
  DETAILED_ANSWER_PROMPT,
  CHAT_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
} from "./prompts";

export const DEFAULT_LIVE_SUGGESTIONS_PROMPT = LIVE_SUGGESTIONS_PROMPT;
export const DEFAULT_DETAILED_ANSWER_PROMPT = DETAILED_ANSWER_PROMPT;
export const DEFAULT_CHAT_PROMPT = CHAT_PROMPT;
export const DEFAULT_SUMMARY_SYSTEM_PROMPT = SUMMARY_SYSTEM_PROMPT;

export const DEFAULTS = {
  liveSuggestionsPrompt: LIVE_SUGGESTIONS_PROMPT,
  detailedAnswerPrompt: DETAILED_ANSWER_PROMPT,
  chatPrompt: CHAT_PROMPT,

  // Seconds of recent transcript passed to the live-suggestion prompt.
  suggestionContextWindowSec: 90,

  // Seconds of transcript passed when expanding a suggestion or chatting.
  // 0 = use the full session transcript.
  expandedAnswerContextWindowSec: 0,

  // How often the suggestion engine runs automatically.
  refreshIntervalSec: 30,

  // Regenerate the rolling session summary every Nth suggestion batch.
  summaryRefreshEveryNBatches: 3,
} as const;

export type Defaults = typeof DEFAULTS;
