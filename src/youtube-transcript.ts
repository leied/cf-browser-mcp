import type { Env } from "./types";

interface TranscriptCue {
  text: string;
  start: string;
  dur: string;
}

interface TranscriptTrack {
  language: string;
  transcript: TranscriptCue[];
}

interface TranscriptApiResult {
  id: string;
  title?: string;
  tracks?: TranscriptTrack[];
  error?: string;
}

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

/** Accepts a raw video ID or a full YouTube URL (watch/shorts/youtu.be). */
export function extractVideoId(input: string): string {
  if (VIDEO_ID_RE.test(input)) return input;

  try {
    const url = new URL(input);
    const v = url.searchParams.get("v");
    if (v && VIDEO_ID_RE.test(v)) return v;

    const segments = url.pathname.split("/").filter(Boolean);
    for (const key of ["shorts", "embed", "live"]) {
      const idx = segments.indexOf(key);
      if (idx !== -1 && segments[idx + 1] && VIDEO_ID_RE.test(segments[idx + 1])) {
        return segments[idx + 1];
      }
    }
    if (url.hostname === "youtu.be" && segments[0] && VIDEO_ID_RE.test(segments[0])) {
      return segments[0];
    }
  } catch {
    // not a URL — fall through
  }

  throw new Error(`Could not extract a YouTube video ID from "${input}"`);
}

export interface TranscriptResult {
  videoId: string;
  title?: string;
  language?: string;
  text: string;
}

export async function fetchYoutubeTranscript(
  env: Env,
  videoIdOrUrl: string,
): Promise<TranscriptResult> {
  if (!env.YT_TRANSCRIPT_API_TOKEN) {
    throw new Error("YT_TRANSCRIPT_API_TOKEN is not configured");
  }

  const videoId = extractVideoId(videoIdOrUrl);

  const res = await fetch("https://www.youtube-transcript.io/api/transcripts", {
    method: "POST",
    headers: {
      Authorization: `Basic ${env.YT_TRANSCRIPT_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ids: [videoId] }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `youtube-transcript.io request failed (${res.status}): ${body}`,
    );
  }

  const data = (await res.json()) as TranscriptApiResult[];
  const entry = data[0];
  if (!entry) {
    throw new Error(`No transcript data returned for video ${videoId}`);
  }
  if (entry.error) {
    throw new Error(`youtube-transcript.io error: ${entry.error}`);
  }

  const track = entry.tracks?.[0];
  if (!track || track.transcript.length === 0) {
    throw new Error(`No transcript available for video ${videoId}`);
  }

  const text = track.transcript.map((cue) => cue.text).join(" ");

  return {
    videoId,
    title: entry.title,
    language: track.language,
    text,
  };
}
