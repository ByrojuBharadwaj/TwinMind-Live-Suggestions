/**
 * ChunkedRecorder
 * ----------------
 * Wraps MediaRecorder and emits a fresh, standalone WebM/Opus blob every
 * `chunkMs` milliseconds by *restarting* the underlying recorder. Each
 * blob is a complete file (with headers), which is the format Groq's
 * Whisper endpoint expects.
 *
 * We deliberately avoid the alternative approach — MediaRecorder.start(ms)
 * with a single session — because subsequent timeslice blobs lack the
 * WebM initialization segment and require server-side stitching.
 *
 * Known tradeoff: we lose a tiny slice of audio (~50-150ms) at each
 * chunk boundary during the stop/start handoff. Good enough for Stage 2;
 * Stage 5 can revisit with a parallel-recorder overlap strategy if needed.
 */

export interface ChunkedRecorderOptions {
  chunkMs: number;
  onChunk: (blob: Blob, startedAt: number, endedAt: number) => void;
  onError: (err: Error) => void;
  mimeType?: string;
}

const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const m of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return undefined;
}

export class ChunkedRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private currentChunkStart = 0;
  private stopping = false;
  private readonly options: ChunkedRecorderOptions;
  private readonly mimeType: string | undefined;

  constructor(options: ChunkedRecorderOptions) {
    this.options = options;
    this.mimeType = options.mimeType ?? pickMimeType();
  }

  async start(): Promise<void> {
    if (this.stream) return;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
    } catch (err) {
      throw new Error(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Microphone permission denied."
          : "Could not access microphone.",
      );
    }

    this.startNewRecorder();

    this.intervalId = setInterval(() => {
      this.rotateChunk();
    }, this.options.chunkMs);
  }

  stop(): void {
    this.stopping = true;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.recorder && this.recorder.state !== "inactive") {
      try {
        this.recorder.stop();
      } catch {
        /* ignore */
      }
    }

    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }

    this.recorder = null;
  }

  /**
   * Forces the current chunk to close NOW and starts a fresh recorder.
   * Used by the manual refresh button so that the latest audio is turned
   * into a transcript chunk before suggestions regenerate.
   */
  flush(): void {
    if (!this.recorder || this.recorder.state === "inactive") return;
    // Reset the rotation timer so we don't immediately re-rotate.
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = setInterval(
        () => this.rotateChunk(),
        this.options.chunkMs,
      );
    }
    this.rotateChunk();
  }

  private rotateChunk(): void {
    if (!this.recorder || this.recorder.state === "inactive") return;
    try {
      this.recorder.stop();
    } catch (err) {
      this.options.onError(
        err instanceof Error ? err : new Error("Recorder rotate failed"),
      );
    }
  }

  private startNewRecorder(): void {
    if (!this.stream) return;

    const chunks: BlobPart[] = [];
    const startedAt = Date.now();
    this.currentChunkStart = startedAt;

    let rec: MediaRecorder;
    try {
      rec = this.mimeType
        ? new MediaRecorder(this.stream, { mimeType: this.mimeType })
        : new MediaRecorder(this.stream);
    } catch (err) {
      this.options.onError(
        err instanceof Error
          ? err
          : new Error("Could not initialize MediaRecorder."),
      );
      return;
    }

    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    };

    rec.onerror = (ev: Event) => {
      const err =
        (ev as unknown as { error?: Error }).error ??
        new Error("Recorder error");
      this.options.onError(err);
    };

    rec.onstop = () => {
      const endedAt = Date.now();
      const blob = new Blob(chunks, {
        type: rec.mimeType || "audio/webm",
      });
      if (blob.size > 0) {
        this.options.onChunk(blob, this.currentChunkStart, endedAt);
      }
      if (!this.stopping && this.stream) {
        this.startNewRecorder();
      }
    };

    rec.start();
    this.recorder = rec;
  }
}
