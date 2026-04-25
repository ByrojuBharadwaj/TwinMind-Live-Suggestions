/**
 * Pre-flight gate run before the microphone starts.
 *
 * A fresh user who clicks "Start mic" should not have to wait 30 seconds for
 * the first transcription call to fail before learning that their browser
 * is unsupported, their mic is unplugged, or their Groq key is invalid.
 *
 * Checks are ordered cheapest → most expensive so we fail fast:
 *   1. Browser capability    (sync, 0ms)
 *   2. Secure context        (sync, 0ms)
 *   3. Microphone hardware   (async, ~10ms)
 *   4. Groq key validity     (network, ~300ms)
 *
 * Returns a discriminated union so callers can show a precise error message
 * plus an optional hint without resorting to try/catch string matching.
 */
export type PreflightResult =
  | { ok: true }
  | { ok: false; reason: string; hint?: string };

export interface PreflightOptions {
  apiKey: string;
  /** Override fetch for testing. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export async function runPreflight(
  opts: PreflightOptions,
): Promise<PreflightResult> {
  // 1. Browser capability -----------------------------------------------------
  if (typeof window === "undefined") {
    return {
      ok: false,
      reason: "Recording must be started from the browser.",
    };
  }

  if (typeof window.MediaRecorder === "undefined") {
    return {
      ok: false,
      reason: "This browser doesn't support audio recording.",
      hint: "Please use a recent version of Chrome, Edge, or Firefox.",
    };
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return {
      ok: false,
      reason: "Microphone access isn't available in this browser.",
      hint: "Use Chrome, Edge, or Firefox on HTTPS or localhost.",
    };
  }

  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    return {
      ok: false,
      reason: "This browser is too old to run the app reliably.",
      hint: "Please update to a recent version.",
    };
  }

  // 2. Secure context ---------------------------------------------------------
  // getUserMedia is only allowed on HTTPS or localhost. Calling it on plain
  // HTTP throws a confusing "permission denied" error, so we surface the
  // real cause up front.
  if (typeof window.isSecureContext === "boolean" && !window.isSecureContext) {
    return {
      ok: false,
      reason: "Microphone access requires a secure connection.",
      hint: "Open the app over HTTPS, or run it on localhost.",
    };
  }

  // 3. Microphone hardware ----------------------------------------------------
  // Before HTTPS + permissions are granted, device labels are empty but the
  // kind/deviceId are still populated, so this check works even on a fresh
  // page load.
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const hasInput = devices.some((d) => d.kind === "audioinput");
    if (!hasInput) {
      return {
        ok: false,
        reason: "No microphone detected on this device.",
        hint: "Plug in a mic (or enable your system input) and try again.",
      };
    }
  } catch {
    // enumerateDevices rarely throws; don't block on it.
  }

  // 4. Groq key validity ------------------------------------------------------
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl("/api/validate-key", {
      method: "GET",
      headers: { Authorization: `Bearer ${opts.apiKey}` },
    });

    if (res.status === 401) {
      return {
        ok: false,
        reason: "Your Groq API key is invalid or expired.",
        hint: "Open Settings and paste a working key from console.groq.com.",
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        reason: "Couldn't reach Groq to validate your key.",
        hint: "Check your internet connection and try again.",
      };
    }
  } catch {
    return {
      ok: false,
      reason: "Network error while validating your Groq API key.",
      hint: "Check your internet connection and try again.",
    };
  }

  return { ok: true };
}
