#!/usr/bin/env node
/**
 * Deterministic converter: daily/*.md  ->  data/<date>.json + data/index.json
 *
 * The daily cloud routine writes human-readable Markdown lessons into daily/.
 * This script parses them into the structured JSON the web app consumes, so
 * the site never has to parse Markdown in the browser and generation stays
 * reliable (AI writes prose; this code produces the data).
 *
 * Run:  node scripts/build-data.mjs
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dailyDir = join(root, "daily");
const dataDir = join(root, "data");

// A word entry looks like:
//   3. **Diligent** (DIL-ih-junt) — Working hard and carefully.
//      *Example:* A diligent student finishes homework before watching TV.
const WORD_RE = /^\s*\d+\.\s+\*\*(.+?)\*\*\s*(?:\(([^)]*)\))?\s*[—–-]\s*(.+?)\s*$/;
const EXAMPLE_RE = /^\s*\*Example:\*\s*(.+?)\s*$/i;

function stripQuotes(s) {
  return s.replace(/^[“"']+/, "").replace(/[”"']+$/, "").trim();
}

function parseLesson(md) {
  const lines = md.split(/\r?\n/);
  const words = [];
  let current = null;
  for (const line of lines) {
    const w = line.match(WORD_RE);
    if (w) {
      current = {
        word: w[1].trim(),
        pron: (w[2] || "").trim(),
        meaning: w[3].replace(/\s+$/, "").trim(),
        example: "",
      };
      words.push(current);
      continue;
    }
    const ex = line.match(EXAMPLE_RE);
    if (ex && current) current.example = stripQuotes(ex[1]);
  }
  return words;
}

function main() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  const files = readdirSync(dailyDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort();

  const index = [];
  for (const file of files) {
    const date = file.replace(/\.md$/, "");
    const md = readFileSync(join(dailyDir, file), "utf8");
    const words = parseLesson(md);
    if (words.length === 0) {
      console.warn(`! ${file}: no words parsed, skipping`);
      continue;
    }
    const out = { date, count: words.length, words };
    writeFileSync(join(dataDir, `${date}.json`), JSON.stringify(out, null, 2) + "\n");
    index.push({ date, count: words.length });
    console.log(`✓ ${date}: ${words.length} words`);
  }

  // newest first for the app
  index.sort((a, b) => (a.date < b.date ? 1 : -1));
  writeFileSync(join(dataDir, "index.json"), JSON.stringify({ days: index }, null, 2) + "\n");
  console.log(`✓ index.json: ${index.length} day(s)`);
}

main();
