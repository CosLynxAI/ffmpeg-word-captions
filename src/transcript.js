// Word timings from the transcripts speech-to-text tools write, as [{ w, start, end }] in seconds, in time order.
//  - OpenAI Whisper and faster-whisper (word_timestamps): segments[].words[] { word, start, end }
//  - WhisperX: segments[].words[] or word_segments[] { word, start, end }
//  - whisper.cpp (--output-json-full): transcription[].tokens[] { text, offsets: { from, to } in ms }
//  - Deepgram: results.channels[0].alternatives[0].words[] { word, punctuated_word, start, end }
//  - AssemblyAI: words[] { text, start, end } in ms
//  - ElevenLabs Scribe: words[] { text, start, end, type: "word" | "spacing" | "audio_event" }
//  - a plain list: [{ word | text | w, start, end }] (seconds), alone or as { words: [...] }
const fs = require("fs");

const num = (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v);

function fromList(list, { ms = false } = {}) {
  const sec = (v) => (ms ? num(v) / 1000 : num(v));
  return list
    .filter((x) => x && (x.type === undefined || x.type === "word"))
    .map((x) => ({ w: String(x.punctuated_word ?? x.word ?? x.text ?? x.w ?? "").trim(), start: sec(x.start), end: sec(x.end) }))
    .filter((x) => x.w && Number.isFinite(x.start) && Number.isFinite(x.end));
}

// whisper.cpp splits words into tokens: a token starting with a space starts a word; [_BEG_]-style tokens are skipped
function fromWhisperCpp(segments) {
  const out = [];
  for (const seg of segments) {
    for (const t of seg.tokens || []) {
      const text = String(t.text ?? "");
      if (!text.trim() || /^\[_?[A-Z_]+_?\]$|^<\|.*\|>$/.test(text.trim())) continue;
      const from = t.offsets?.from / 1000, to = t.offsets?.to / 1000;
      const last = out[out.length - 1];
      if (last && !/^\s/.test(text)) { last.w += text; last.end = Math.max(last.end, to); } else out.push({ w: text.trim(), start: from, end: to });
    }
  }
  return out.filter((x) => x.w && Number.isFinite(x.start) && Number.isFinite(x.end));
}

/** The words of a parsed transcript (any of the shapes above); throws when it holds none. */
function wordsOf(j) {
  let words = null;
  if (Array.isArray(j)) words = fromList(j);
  else if (Array.isArray(j?.transcription)) words = fromWhisperCpp(j.transcription);
  else if (Array.isArray(j?.results?.channels)) words = fromList(j.results.channels[0]?.alternatives?.[0]?.words || []);
  else if (Array.isArray(j?.segments) && j.segments.some((s) => Array.isArray(s.words))) words = fromList(j.segments.flatMap((s) => s.words || []));
  else if (Array.isArray(j?.word_segments)) words = fromList(j.word_segments);
  else if (Array.isArray(j?.words)) {
    // (AssemblyAI counts in milliseconds: its transcript carries a status and an audio_duration, or failing those its
    // words have no type, as Scribe's do, and whole-number times past any speech's seconds)
    const untyped = j.words.every((x) => !("type" in (x || {})));
    const ms = untyped && (j.audio_duration !== undefined || j.status !== undefined || j.words.some((x) => Number.isInteger(x?.start) && Number.isInteger(x?.end) && x.end > 1000));
    words = fromList(j.words, { ms });
  }
  if (!words || !words.length) throw new Error("no word timings found: give a transcript with word timestamps (Whisper with word_timestamps, WhisperX, whisper.cpp -ojf, Deepgram, AssemblyAI, ElevenLabs Scribe, or [{ word, start, end }])");
  // (some tools leave a word's end before its start, or overlap the next: each word ends by the next one's start)
  words.sort((a, b) => a.start - b.start);
  return words.map((x, i) => ({ ...x, end: Math.max(x.start + 0.01, Math.min(x.end, words[i + 1]?.start ?? x.end)) }));
}

const readWords = (file) => wordsOf(JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")));

module.exports = { wordsOf, readWords };
