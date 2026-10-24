// Word-timed captions as an ASS subtitle file, which ffmpeg burns in with its `ass` filter (libass).
//   karaoke    the line is up; each word fills with the highlight colour as it is said (\kf sweep)
//   highlight  the line is up; only the word being said is in the highlight colour, a little larger
//   reveal     words appear one by one as they are said, the line building up
//   pop        one word at a time, big, in the middle, popping in

// Little words a line broken for length should not end on: they open the next line.
const FUNCTION_WORD = /^(and|or|but|nor|so|the|a|an|of|to|in|on|at|for|with|between|from|by|as|that|its|their|than|into|onto|about|over|under|through|across|after|before|within|without|your|my|our|his|her|this|these|those|every|each)$/i;
const STYLES = ["karaoke", "highlight", "reveal", "pop"];

/**
 * Groups words into caption lines the way a subtitler would: up to `maxWords` words or `maxChars` characters, broken at
 * sentence ends, at a pause, and at a comma once the line has some length. A line broken for length never ends on a
 * little word, and a break that would leave one or two words alone splits the pair of lines evenly instead.
 */
function chunks(words, { maxWords = 7, maxChars = 32, pause = 0.45 } = {}) {
  maxWords ||= 7; maxChars ||= 32;
  const out = [], forLength = new Set();
  let cur = [];
  const flush = (long = false) => { if (cur.length) { out.push(cur); if (long) forLength.add(cur); } cur = []; };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    const chars = cur.reduce((n, x) => n + x.w.length + 1, 0) + w.w.length;
    if (prev && (w.start - prev.end > pause || /[.!?;:]$/.test(prev.w) || (/,$/.test(prev.w) && cur.length >= 3))) flush();
    else if (prev && (cur.length >= maxWords || chars > maxChars)) {
      const carry = [];
      while (cur.length > 2 && carry.length < 2 && FUNCTION_WORD.test(cur[cur.length - 1].w)) carry.unshift(cur.pop());
      flush(true);
      cur.push(...carry);
    }
    cur.push(w);
  }
  flush();
  for (let i = 1; i < out.length; i++) {
    if (out[i].length > 2 || !forLength.has(out[i - 1])) continue;
    const both = [...out[i - 1], ...out[i]];
    // (the middle, moved back off a little word, or forward when going back would leave one word alone)
    const ok = (c) => !FUNCTION_WORD.test(both[c - 1].w);
    const mid = Math.ceil(both.length / 2);
    let cut = mid;
    while (cut > 2 && !ok(cut)) cut--;
    if (!ok(cut)) for (cut = mid; cut < both.length - 1 && !ok(cut); cut++);
    out.splice(i - 1, 2, both.slice(0, cut), both.slice(cut));
  }
  return out;
}

/** "#rrggbb" (or "#rrggbbaa", aa = opacity) as ASS's &HAABBGGRR, where AA is transparency. */
function assColor(hex) {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(hex).trim());
  if (!m) throw new Error(`not a colour: ${hex} (use #rrggbb or #rrggbbaa)`);
  const [r, g, b] = [0, 2, 4].map((i) => m[1].slice(i, i + 2));
  const a = (255 - parseInt(m[2] ?? "ff", 16)).toString(16).padStart(2, "0");
  return `&H${a}${b}${g}${r}`.toUpperCase();
}

const stamp = (t) => {
  const cs = Math.max(0, Math.round(t * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor((cs % 360000) / 6000)).padStart(2, "0")}:${String(Math.floor((cs % 6000) / 100)).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};
/** The face captions default to: Anton (SIL OFL 1.1), shipped in fonts/ so --burn finds it without installing it. */
const DEFAULT_FONT = "Anton";
// (braces and backslashes would be read as override tags)
const clean = (w) => String(w).replace(/[{}\\]/g, "");

/**
 * The ASS file for `words` ([{ w, start, end }], seconds). Options: style (STYLES), width/height (the video's, so
 * sizes and margins are in its pixels), font (default Anton), size (px; default 7% of the shorter side, 1.6x that for pop), color,
 * highlight, outline (colour), outlineWidth, box (an opaque box behind the line instead of an outline), position
 * (bottom, middle, top), uppercase, maxWords, maxChars, linger (s a line stays after its last word).
 */
function buildAss(words, o = {}) {
  const style = o.style || "karaoke";
  if (!STYLES.includes(style)) throw new Error(`--style takes ${STYLES.join(", ")}`);
  const W = o.width || 1080, H = o.height || 1920, short = Math.min(W, H);
  const size = Math.round(o.size || short * (style === "pop" ? 0.11 : 0.07));
  const align = { bottom: 2, middle: 5, top: 8 }[style === "pop" && !o.position ? "middle" : o.position || "bottom"];
  if (!align) throw new Error("--position takes bottom, middle, top");
  const base = assColor(o.color || "#ffffff"), hi = assColor(o.highlight || "#ffd400"), line = assColor(o.outline || "#000000");
  const ow = o.outlineWidth ?? Math.max(2, Math.round(size * 0.08));
  const linger = o.linger ?? 0.4;
  const text = (w) => clean(o.uppercase ? w.toUpperCase() : w);
  // karaoke: the unsaid part is Secondary, the said part Primary; reveal: unsaid words fully transparent (\ko keeps their outline off too)
  const [primary, secondary] = style === "karaoke" ? [hi, base] : style === "reveal" ? [base, "&HFF000000"] : [base, base];
  const head = [
    "[Script Info]", "; Written by ffmpeg-word-captions", "ScriptType: v4.00+", `PlayResX: ${W}`, `PlayResY: ${H}`, "WrapStyle: 2", "ScaledBorderAndShadow: yes", "YCbCr Matrix: None", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Word,${o.font || DEFAULT_FONT},${size},${primary},${secondary},${line},${o.box ? line : "&H80000000"},${o.font ? -1 : 0},0,0,0,100,100,0,0,${o.box ? 3 : 1},${o.box ? Math.round(size * 0.18) : ow},${o.box || style === "reveal" ? 0 : Math.max(1, Math.round(size * 0.04))},${align},${Math.round(W * 0.08)},${Math.round(W * 0.08)},${Math.round(H * (align === 5 ? 0 : 0.12))},1`,
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const events = [];
  const ev = (from, to, body) => { if (to - from >= 0.02) events.push(`Dialogue: 0,${stamp(from)},${stamp(to)},Word,,0,0,0,,${body}`); };
  // (a wide frame takes longer lines than a tall one)
  const groups = style === "pop" ? words.map((w) => [w]) : chunks(words, { maxWords: o.maxWords, maxChars: o.maxChars || (W > H ? 42 : 28) });
  groups.forEach((g, gi) => {
    const next = groups[gi + 1]?.[0].start ?? Infinity;
    const from = g[0].start, to = Math.min(next, g[g.length - 1].end + linger);
    if (style === "karaoke" || style === "reveal") {
      // each word's \k length runs from its start to the next word's start, so the sweep never waits or jumps
      const tag = style === "karaoke" ? "kf" : "ko";
      const body = g.map((w, i) => `{\\${tag}${Math.max(1, Math.round(((g[i + 1]?.start ?? w.end) - w.start) * 100))}}${text(w.w)}`).join(" ");
      ev(from, to, body);
    } else if (style === "highlight") {
      g.forEach((w, i) => {
        const body = g.map((x, j) => (j === i ? `{\\1c${hi}\\fscx112\\fscy112}${text(x.w)}{\\1c${base}\\fscx100\\fscy100}` : text(x.w))).join(" ");
        ev(i === 0 ? from : w.start, g[i + 1]?.start ?? to, body);
      });
    } else {
      ev(from, to, `{\\fscx70\\fscy70\\t(0,90,\\fscx112\\fscy112)\\t(90,170,\\fscx100\\fscy100)}${text(g[0].w)}`);
    }
  });
  return `${[...head, ...events].join("\n")}\n`;
}

module.exports = { buildAss, chunks, assColor, stamp, STYLES };
