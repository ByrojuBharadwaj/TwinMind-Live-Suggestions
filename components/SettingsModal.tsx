"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, RotateCcw, X } from "lucide-react";
import { useSettingsStore, SERVER_KEY_AVAILABLE } from "@/store/useSettingsStore";
import type { AppSettings } from "@/types";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const settings = useSettingsStore();
  const [draft, setDraft] = useState<AppSettings>(toPlain(settings));
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (open) setDraft(toPlain(settings));
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const save = () => {
    settings.updateSettings(draft);
    onClose();
  };

  const reset = () => {
    settings.resetToDefaults();
    setDraft(toPlain({ ...settings, ...useSettingsStore.getState() }));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-2xl rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-5 py-3.5">
          <h2 className="text-sm font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-[var(--muted)] hover:bg-white/5 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <div className="scrollbar-thin max-h-[70vh] overflow-y-auto px-5 py-4">
          <Section
            title="Groq API Key"
            help={
              SERVER_KEY_AVAILABLE
                ? "A server key is pre-configured — the app works without one. Paste your own key here to override it."
                : "Paste your own Groq key. Stored only in this browser (localStorage)."
            }
          >
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={draft.groqApiKey}
                onChange={(e) =>
                  setDraft({ ...draft, groqApiKey: e.target.value })
                }
                placeholder="gsk_..."
                className="w-full rounded-md border border-[var(--panel-border)] bg-[var(--background)] px-3 py-2 pr-10 font-mono text-sm focus:border-[var(--accent)]/60 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--muted)] hover:text-white"
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </Section>

          <Section
            title="Context windows"
            help="How much transcript the prompts see. Tune these for latency vs. depth."
          >
            <div className="grid grid-cols-3 gap-3">
              <NumberField
                label="Live suggestions (sec)"
                value={draft.suggestionContextWindowSec}
                onChange={(v) =>
                  setDraft({ ...draft, suggestionContextWindowSec: v })
                }
              />
              <NumberField
                label="Expanded answer (sec)"
                hint="0 = full transcript"
                value={draft.expandedAnswerContextWindowSec}
                onChange={(v) =>
                  setDraft({ ...draft, expandedAnswerContextWindowSec: v })
                }
              />
              <NumberField
                label="Refresh interval (sec)"
                value={draft.refreshIntervalSec}
                onChange={(v) =>
                  setDraft({ ...draft, refreshIntervalSec: v })
                }
              />
            </div>
          </Section>

          <Section
            title="Live suggestions prompt"
            help="System prompt for the 3-cards generator. Finalized in Stage 3."
          >
            <PromptArea
              value={draft.liveSuggestionsPrompt}
              onChange={(v) =>
                setDraft({ ...draft, liveSuggestionsPrompt: v })
              }
            />
          </Section>

          <Section
            title="Detailed answer prompt"
            help="Used when a suggestion card is clicked."
          >
            <PromptArea
              value={draft.detailedAnswerPrompt}
              onChange={(v) => setDraft({ ...draft, detailedAnswerPrompt: v })}
            />
          </Section>

          <Section
            title="Chat prompt"
            help="Used for user-typed chat questions."
          >
            <PromptArea
              value={draft.chatPrompt}
              onChange={(v) => setDraft({ ...draft, chatPrompt: v })}
            />
          </Section>
        </div>

        <div className="flex items-center justify-between border-t border-[var(--panel-border)] px-5 py-3">
          <button
            onClick={reset}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-[var(--muted)] hover:bg-white/5 hover:text-white"
          >
            <RotateCcw size={12} />
            Reset to defaults
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-[var(--muted)] hover:bg-white/5 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  help,
  children,
}: {
  title: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
          {title}
        </h3>
        {help && (
          <p className="mt-0.5 text-[11px] text-[var(--muted)]/70">{help}</p>
        )}
      </div>
      {children}
    </div>
  );
}

function NumberField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] text-[var(--muted)]">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="mt-1 w-full rounded-md border border-[var(--panel-border)] bg-[var(--background)] px-2.5 py-1.5 text-sm focus:border-[var(--accent)]/60 focus:outline-none"
      />
      {hint && (
        <span className="mt-1 block text-[10px] text-[var(--muted)]/70">
          {hint}
        </span>
      )}
    </label>
  );
}

function PromptArea({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={5}
      className="scrollbar-thin w-full resize-y rounded-md border border-[var(--panel-border)] bg-[var(--background)] px-3 py-2 font-mono text-xs leading-relaxed focus:border-[var(--accent)]/60 focus:outline-none"
    />
  );
}

function toPlain(s: AppSettings): AppSettings {
  return {
    groqApiKey: s.groqApiKey,
    liveSuggestionsPrompt: s.liveSuggestionsPrompt,
    detailedAnswerPrompt: s.detailedAnswerPrompt,
    chatPrompt: s.chatPrompt,
    suggestionContextWindowSec: s.suggestionContextWindowSec,
    expandedAnswerContextWindowSec: s.expandedAnswerContextWindowSec,
    refreshIntervalSec: s.refreshIntervalSec,
  };
}
