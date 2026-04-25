"use client";

import { useState } from "react";
import Header from "@/components/Header";
import TranscriptPanel from "@/components/TranscriptPanel";
import SuggestionsPanel from "@/components/SuggestionsPanel";
import ChatPanel from "@/components/ChatPanel";
import SettingsModal from "@/components/SettingsModal";
import { useRecordingController } from "@/lib/useRecordingController";
import { useSuggestionsController } from "@/lib/useSuggestionsController";
import { useChatController } from "@/lib/useChatController";
import { exportSession } from "@/lib/export";
import type { Suggestion } from "@/types";

export default function Home() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);

  const { isRecording, start, stop, flush } = useRecordingController();
  const { refresh } = useSuggestionsController(flush);
  const { sendMessage, expandSuggestion, stopGeneration } = useChatController();

  const onToggleRecording = async () => {
    setRecordError(null);
    try {
      if (isRecording) {
        stop();
      } else {
        await start();
      }
    } catch (err) {
      setRecordError(err instanceof Error ? err.message : "Failed to start.");
    }
  };

  const onSelectSuggestion = (s: Suggestion) => {
    void expandSuggestion(s);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Header
        isRecording={isRecording}
        onToggleRecording={onToggleRecording}
        onOpenSettings={() => setSettingsOpen(true)}
        onExport={(format) => exportSession(format)}
      />

      {recordError && (
        <div className="flex items-center justify-between border-b border-red-500/30 bg-red-500/10 px-5 py-2 text-xs text-red-300">
          <span>{recordError}</span>
          <button
            onClick={() => setRecordError(null)}
            className="rounded px-2 py-0.5 text-[11px] text-red-200 hover:bg-red-500/20"
          >
            Dismiss
          </button>
        </div>
      )}

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 bg-[var(--background)] p-3 md:grid-cols-3 md:gap-4 md:p-4">
        <TranscriptPanel />
        <SuggestionsPanel
          onRefresh={() => {
            void refresh();
          }}
          onSelectSuggestion={onSelectSuggestion}
        />
        <ChatPanel
          onSend={(text) => {
            void sendMessage(text);
          }}
          onStop={stopGeneration}
        />
      </main>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
