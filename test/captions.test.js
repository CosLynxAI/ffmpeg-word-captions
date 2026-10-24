const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { wordsOf, readWords } = require("../src/transcript");
const { buildAss, chunks, assColor, stamp } = require("../src/ass");

const plain = (ws) => ws.map((x) => [x.w, x.start, x.end]);

test("transcripts from each tool read to the same words", () => {
  const want = [["Hello", 0.5, 0.9], ["world.", 1, 1.4]];
  const whisper = { segments: [{ words: [{ word: " Hello", start: 0.5, end: 0.9 }, { word: " world.", start: 1.0, end: 1.4 }] }] };
  const whisperx = { segments: [], word_segments: [{ word: "Hello", start: 0.5, end: 0.9, score: 0.9 }, { word: "world.", start: 1.0, end: 1.4 }] };
  const cpp = { transcription: [{ tokens: [{ text: "[_BEG_]", offsets: { from: 0, to: 0 } }, { text: " Hel", offsets: { from: 500, to: 700 } }, { text: "lo", offsets: { from: 700, to: 900 } }, { text: " world", offsets: { from: 1000, to: 1300 } }, { text: ".", offsets: { from: 1300, to: 1400 } }] }] };
  const deepgram = { results: { channels: [{ alternatives: [{ words: [{ word: "hello", punctuated_word: "Hello", start: 0.5, end: 0.9 }, { word: "world", punctuated_word: "world.", start: 1.0, end: 1.4 }] }] }] } };
  const assembly = { status: "completed", audio_duration: 2, text: "Hello world.", words: [{ text: "Hello", start: 500, end: 900, confidence: 0.9 }, { text: "world.", start: 1000, end: 1400, confidence: 0.9 }] };
  const scribe = { text: "Hello world.", words: [{ text: "Hello", start: 0.5, end: 0.9, type: "word" }, { text: " ", start: 0.9, end: 1.0, type: "spacing" }, { text: "world.", start: 1.0, end: 1.4, type: "word" }] };
  const list = [{ word: "Hello", start: "0.5", end: "0.9" }, { word: "world.", start: 1, end: 1.4 }];
  const shortAssembly = { status: "completed", words: [{ text: "Hi", start: 100, end: 600, confidence: 1 }] };
  assert.deepEqual(plain(wordsOf(shortAssembly)), [["Hi", 0.1, 0.6]], "a clip under a second is still in ms");
  for (const [name, j] of Object.entries({ whisper, whisperx, cpp, deepgram, assembly, scribe, list })) assert.deepEqual(plain(wordsOf(j)), want, name);
  assert.throws(() => wordsOf({ text: "no timings" }), /no word timings/);
});

test("overlapping or backwards word times are mended", () => {
  const w = wordsOf([{ word: "b", start: 1, end: 0.5 }, { word: "a", start: 0, end: 2 }]);
  assert.deepEqual(plain(w), [["a", 0, 1], ["b", 1, 1.01]]);
});

test("the shipped example reads", () => {
  assert.equal(readWords(path.join(__dirname, "..", "examples", "whisper.json")).length, 19);
});

const seq = (text, gap = 0.05, len = 0.3) => text.split(" ").map((w, i) => ({ w, start: i * (len + gap), end: i * (len + gap) + len }));

test("lines break at sentence ends, pauses and commas, never ending on a little word", () => {
  const words = seq("This is the first one. And then a second line, with a comma and more words to come after the");
  const lines = chunks(words, { maxWords: 7, maxChars: 32 }).map((c) => c.map((x) => x.w).join(" "));
  assert.equal(lines[0], "This is the first one.");
  assert.equal(lines[1], "And then a second line,");
  for (const l of lines.slice(0, -1)) assert.ok(!/ (the|a|and|with|to)$/.test(l), l);
  const paused = [...seq("one two"), ...seq("three four").map((x) => ({ ...x, start: x.start + 2, end: x.end + 2 }))];
  assert.deepEqual(chunks(paused).map((c) => c.length), [2, 2]);
});

test("a line broken for length never leaves one or two words alone", () => {
  const lines = chunks(seq("burned in with one ffmpeg command."), { maxChars: 30 }).map((c) => c.map((x) => x.w).join(" "));
  assert.ok(lines.every((l) => l.split(" ").length >= 2), lines.join(" | "));
});

test("colours become ASS &HAABBGGRR", () => {
  assert.equal(assColor("#ffd400"), "&H0000D4FF");
  assert.equal(assColor("#00000080"), "&H7F000000");
  assert.throws(() => assColor("yellow"));
  assert.equal(stamp(3725.456), "1:02:05.46");
});

test("karaoke: one line an event, each word's sweep lasting until the next word", () => {
  const ass = buildAss(seq("one two three"), { style: "karaoke", width: 1920, height: 1080 });
  assert.match(ass, /PlayResX: 1920\nPlayResY: 1080/);
  const ev = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
  assert.equal(ev.length, 1);
  assert.equal(ev[0], "Dialogue: 0,0:00:00.00,0:00:01.40,Word,,0,0,0,,{\\kf35}one {\\kf35}two {\\kf30}three");
});

test("highlight: one event a word, the said word coloured and larger", () => {
  const ev = buildAss(seq("one two"), { style: "highlight", highlight: "#ff0000" }).split("\n").filter((l) => l.startsWith("Dialogue:"));
  assert.equal(ev.length, 2);
  assert.match(ev[1], /0:00:00\.35,.*one \{\\1c&H000000FF\\fscx112\\fscy112\}two/);
});

test("reveal hides unsaid words; pop shows one word at a time in the middle", () => {
  const reveal = buildAss(seq("one two"), { style: "reveal" });
  assert.match(reveal, /Style: Word,Arial,\d+,&H00FFFFFF,&HFF000000,/);
  assert.match(reveal, /\{\\ko35\}one \{\\ko30\}two/);
  const pop = buildAss(seq("one two"), { style: "pop" });
  assert.equal(pop.split("\n").filter((l) => l.startsWith("Dialogue:")).length, 2);
  assert.match(pop, /,5,\d+,\d+,0,1\n/, "alignment 5: the middle");
});

test("braces and backslashes in words cannot inject override tags", () => {
  const ass = buildAss([{ w: "{\\b1}bold\\N", start: 0, end: 1 }], { style: "karaoke" });
  assert.match(ass, /\{\\kf100\}b1boldN$/m);
  assert.throws(() => buildAss(seq("a"), { style: "sparkle" }), /--style takes/);
});

const ffmpeg = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-version"]).status === 0 && spawnSync(process.env.FFPROBE_PATH || "ffprobe", ["-version"]).status === 0;

test("the CLI burns every style into a video with ffmpeg", { skip: !ffmpeg && "ffmpeg is not installed" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fwc-"));
  try {
    const video = path.join(dir, "in.mp4");
    assert.equal(spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0x223344:s=320x180:d=2:r=10", "-pix_fmt", "yuv420p", video]).status, 0);
    const words = path.join(dir, "words.json");
    fs.writeFileSync(words, JSON.stringify(seq("one two three four")));
    for (const style of ["karaoke", "highlight", "reveal", "pop"]) {
      const out = path.join(dir, `${style}.mp4`);
      const r = spawnSync(process.execPath, [path.join(__dirname, "..", "bin", "cli.js"), words, "--style", style, "--video", video, "--burn", out, "-o", path.join(dir, `${style}.ass`)], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      assert.match(fs.readFileSync(path.join(dir, `${style}.ass`), "utf8"), /PlayResX: 320\nPlayResY: 180/);
      assert.ok(fs.statSync(out).size > 1000);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
