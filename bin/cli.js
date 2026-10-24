#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { parseArgs } = require("util");
const { spawnSync } = require("child_process");
const { readWords } = require("../src/transcript");
const { buildAss, STYLES } = require("../src/ass");

/** The fonts shipped with the tool (Anton, the default face), for --burn when no --fonts-dir is given. */
const FONTS = path.join(__dirname, "..", "fonts");

const HELP = `ffmpeg-word-captions: word-timed captions (ASS karaoke) from a transcript, for ffmpeg to burn in

  ffmpeg-word-captions <transcript.json> [-o captions.ass] [--style karaoke] [--video in.mp4 [--burn out.mp4]]

Transcripts: Whisper / faster-whisper / WhisperX (word timestamps), whisper.cpp -ojf, Deepgram, AssemblyAI,
ElevenLabs Scribe, or a plain [{ "word", "start", "end" }] list in seconds.

  --style        ${STYLES.join(", ")} (default karaoke)
  --video        the video the captions are for: sizes are read from it (else --frame, default 1080x1920)
  --frame        WxH when there is no --video
  --burn         write the video with the captions burned in (needs --video and ffmpeg)
  --font         font family (default Anton, shipped) --fonts-dir  a folder of .ttf/.otf files for --burn
  --font-size    px (default 7% of the short side; pop 11%)
  --color        #rrggbb words (default #ffffff)    --highlight   #rrggbb said word (default #ffd400)
  --outline      #rrggbb outline (default #000000)  --box         an opaque box instead of an outline
  --position     bottom, middle or top               --uppercase
  --max-words    words a line (default 7)            --max-chars   characters a line (default 28 tall, 42 wide)`;

function probeSize(video) {
  const r = spawnSync(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:stream_side_data=rotation:stream_tags=rotate", "-of", "json", video], { encoding: "utf8", windowsHide: true });
  if (r.error) throw new Error("ffprobe was not found: install ffmpeg (https://ffmpeg.org/download.html) or pass --frame WxH");
  const s = JSON.parse(r.stdout || "{}").streams?.[0];
  if (r.status !== 0 || !s?.width) throw new Error(`ffprobe could not read ${video}`);
  const rot = Math.abs(Number(s.tags?.rotate || s.side_data_list?.[0]?.rotation || 0)) % 180 === 90;
  return rot ? { width: s.height, height: s.width } : { width: s.width, height: s.height };
}

/** The filter's option value: libass reads the path relative to ffmpeg's folder, so no drive colon needs escaping. */
function filterPath(p, cwd) {
  const rel = path.relative(cwd, p).split(path.sep).join("/") || ".";
  if (/['\\:]/.test(rel)) throw new Error(`a path ffmpeg's filter cannot take: ${rel} (keep it on the same drive, without quotes)`);
  return `'${rel}'`;
}

function main(argv) {
  const { values: o, positionals: [input] } = parseArgs({
    args: argv, allowPositionals: true,
    options: {
      out: { type: "string", short: "o" }, style: { type: "string", default: "karaoke" }, video: { type: "string" }, frame: { type: "string" }, burn: { type: "string" },
      font: { type: "string" }, "fonts-dir": { type: "string" }, "font-size": { type: "string" }, color: { type: "string" }, highlight: { type: "string" }, outline: { type: "string" },
      box: { type: "boolean" }, position: { type: "string" }, uppercase: { type: "boolean" }, "max-words": { type: "string" }, "max-chars": { type: "string" }, help: { type: "boolean", short: "h" },
    },
  });
  if (o.help || !input) return console.log(HELP);
  if (o.burn && !o.video) throw new Error("--burn needs --video");
  const frame = o.video ? probeSize(o.video) : (([w, h]) => ({ width: w, height: h }))((o.frame || "1080x1920").split("x").map(Number));
  if (!(frame.width > 0 && frame.height > 0)) throw new Error("--frame takes WxH, such as 1920x1080");
  const words = readWords(input);
  const ass = buildAss(words, {
    style: o.style, ...frame, font: o.font, size: o["font-size"] && Number(o["font-size"]), color: o.color, highlight: o.highlight, outline: o.outline,
    box: o.box, position: o.position, uppercase: o.uppercase, maxWords: o["max-words"] && Number(o["max-words"]), maxChars: o["max-chars"] && Number(o["max-chars"]),
  });
  const out = path.resolve(o.out || input.replace(/(\.[^./\\]+)?$/, ".ass"));
  fs.writeFileSync(out, ass);
  console.log(`wrote ${path.relative(process.cwd(), out) || out}: ${words.length} words, style ${o.style}, ${frame.width}x${frame.height}`);
  if (!o.burn) {
    console.log(`burn it in:  ffmpeg -i ${o.video || "input.mp4"} -vf "ass=${path.basename(out)}" -c:a copy output.mp4   (run in ${path.dirname(out)})`);
    return;
  }
  const cwd = path.dirname(out);
  const vf = `ass=filename=${filterPath(out, cwd)}:fontsdir=${filterPath(o["fonts-dir"] ? path.resolve(o["fonts-dir"]) : FONTS, cwd)}`;
  const r = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-y", "-i", path.resolve(o.video), "-vf", vf, "-c:a", "copy", path.resolve(o.burn)], { cwd, stdio: "inherit", windowsHide: true });
  if (r.error) throw new Error("ffmpeg was not found: install it (https://ffmpeg.org/download.html)");
  if (r.status !== 0) throw new Error("ffmpeg could not burn the captions in");
  console.log(`wrote ${o.burn}`);
}

try { main(process.argv.slice(2)); } catch (e) { console.error(`ffmpeg-word-captions: ${e.message}`); process.exit(1); }
