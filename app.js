/* WordNest — app logic (vanilla, no build step) */
"use strict";

const PLAYERS = [
  { id: 0, key: "shabil", name: "Shabil", ava: "S", cls: "p0" },
  { id: 1, key: "nefny",  name: "Nefny",  ava: "N", cls: "p1" },
];
const QUESTIONS_PER_QUIZ = 12;

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z]/g, "");

const state = {
  days: [],        // [{date,count}]
  current: null,   // selected date
  words: [],       // words for current
  player: 0,       // active player index
  quiz: null,      // {date, questions:[...], answers:[...], i}
  scores: [],      // cached [{date,player,score,total}]
  cards: [],       // active player's flashcard deck [{date,word,pron,meaning,example}]
  deckIdx: 0,      // card currently shown in the deck
};

/* ---------- seeded RNG (same quiz for both players on a date) ---------- */
function seedFrom(str) { let h = 1779033703 ^ str.length; for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); } return h >>> 0; }
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffled(arr, rnd) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---------- data ---------- */
async function fetchJSON(path) { const r = await fetch(path, { cache: "no-cache" }); if (!r.ok) throw new Error(path + " " + r.status); return r.json(); }

async function loadIndex() { const d = await fetchJSON("data/index.json"); state.days = d.days || []; }
async function loadDay(date) { const d = await fetchJSON("data/" + date + ".json"); state.current = date; state.words = d.words || []; }

/* ---------- identity ---------- */
async function loadIdentity() {
  try {
    const me = await fetchJSON("api/me");
    if (me && me.player) { const idx = PLAYERS.findIndex((p) => p.key === me.player); if (idx >= 0) { state.player = idx; state.identityLocked = true; return; } }
  } catch (_) { /* no backend yet — fall back to local pick */ }
  try { const v = localStorage.getItem("wn_player"); if (v != null) state.player = Number(v) || 0; } catch (_) {}
}
async function setPlayer(idx) {
  state.player = idx; try { localStorage.setItem("wn_player", String(idx)); } catch (_) {}
  renderWhoami(); renderLeaderboard();
  await Cards.list(); renderWords(); renderDeckEntry();
}

/* ---------- scores (API with localStorage fallback) ---------- */
const Scores = {
  async list() {
    try { const d = await fetchJSON("api/scores"); const s = d.scores || []; state.scores = s; cacheWrite(s); return s; }
    catch (_) { const s = cacheRead(); state.scores = s; return s; }
  },
  async save(entry) {
    // keep only the best score per (date, player) locally for instant UI
    mergeLocal(entry);
    try {
      const r = await fetch("api/scores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry) });
      if (r.ok) { const d = await r.json(); if (d.scores) { state.scores = d.scores; cacheWrite(d.scores); } }
    } catch (_) { /* offline / no backend — local cache already updated */ }
  },
};
function cacheRead() { try { return JSON.parse(localStorage.getItem("wn_scores") || "[]"); } catch (_) { return []; } }
function cacheWrite(s) { try { localStorage.setItem("wn_scores", JSON.stringify(s)); } catch (_) {} }
function mergeLocal(entry) {
  const s = cacheRead();
  const i = s.findIndex((x) => x.date === entry.date && x.player === entry.player);
  if (i >= 0) { if (entry.score >= s[i].score) s[i] = entry; } else s.push(entry);
  cacheWrite(s); state.scores = s;
}

/* ---------- flashcards (API with per-player localStorage fallback) ---------- */
const cardKey = (c) => c.date + "|" + c.word;
const Cards = {
  storeKey() { return "wn_cards_" + PLAYERS[state.player].key; },
  readLocal() { try { return JSON.parse(localStorage.getItem(this.storeKey()) || "[]"); } catch (_) { return []; } },
  writeLocal(c) { try { localStorage.setItem(this.storeKey(), JSON.stringify(c)); } catch (_) {} },
  has(c) { return state.cards.some((x) => cardKey(x) === cardKey(c)); },
  async list() {
    try { const d = await fetchJSON("api/flashcards?player=" + PLAYERS[state.player].key); state.cards = d.cards || []; this.writeLocal(state.cards); }
    catch (_) { state.cards = this.readLocal(); }
    return state.cards;
  },
  async sync(method, card) {
    try {
      const r = await fetch("api/flashcards", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...card, player: PLAYERS[state.player].key }) });
      if (r.ok) { const d = await r.json(); if (d.cards) { state.cards = d.cards; this.writeLocal(d.cards); } }
    } catch (_) { /* offline / no backend — local copy already updated */ }
  },
  async add(card) {
    if (!this.has(card)) { state.cards = state.cards.concat([card]); this.writeLocal(state.cards); }
    await this.sync("POST", card);
  },
  async remove(card) {
    state.cards = state.cards.filter((x) => cardKey(x) !== cardKey(card)); this.writeLocal(state.cards);
    await this.sync("DELETE", card);
  },
};

/* ---------- score analysis ---------- */
function scoreFor(date, playerKey) { const r = state.scores.find((s) => s.date === date && s.player === playerKey); return r || null; }
function dailyWinner(date) {
  const a = scoreFor(date, PLAYERS[0].key), b = scoreFor(date, PLAYERS[1].key);
  if (!a && !b) return null;
  if (a && !b) return { player: 0, sole: true };
  if (b && !a) return { player: 1, sole: true };
  if (a.score === b.score) return { tie: true };
  return { player: a.score > b.score ? 0 : 1 };
}
function longestStreak(playerKey) {
  const dates = state.scores.filter((s) => s.player === playerKey).map((s) => s.date).sort();
  let best = 0, run = 0, prev = null;
  for (const d of dates) {
    if (prev && dayDiff(prev, d) === 1) run += 1; else run = 1;
    best = Math.max(best, run); prev = d;
  }
  return best;
}
function dayDiff(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }

/* ---------- quiz building ---------- */
function buildQuiz(words, date) {
  const rnd = mulberry32(seedFrom(date));
  const pool = shuffled(words, rnd);
  const picks = pool.slice(0, Math.min(QUESTIONS_PER_QUIZ, pool.length));
  const types = ["word", "meaning", "fill"];
  const questions = picks.map((w, i) => {
    const type = types[i % types.length];
    const others = shuffled(words.filter((x) => x.word !== w.word), rnd);
    if (type === "meaning") {
      const opts = shuffled([w].concat(others.slice(0, 3)), rnd);
      return { type, word: w.word, prompt: `What does <b>${w.word}</b> mean?`, options: opts.map((o) => o.meaning), answer: opts.findIndex((o) => o.word === w.word) };
    } else if (type === "word") {
      const opts = shuffled([w].concat(others.slice(0, 3)), rnd);
      return { type, word: w.word, prompt: `Which word means &ldquo;${w.meaning}&rdquo;?`, options: opts.map((o) => o.word), answer: opts.findIndex((o) => o.word === w.word) };
    } else {
      const opts = shuffled([w].concat(others.slice(0, 3)), rnd);
      const re = new RegExp("\\b" + w.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
      const sentence = (w.example && re.test(w.example))
        ? w.example.replace(re, "<span class='blank'>&nbsp;&nbsp;&nbsp;&nbsp;</span>")
        : `<span class='blank'>&nbsp;&nbsp;&nbsp;&nbsp;</span> &mdash; ${w.meaning}`;
      return { type, word: w.word, prompt: `Fill the blank:<br>${sentence}`, options: opts.map((o) => o.word), answer: opts.findIndex((o) => o.word === w.word) };
    }
  });
  return { date, questions, answers: new Array(questions.length).fill(null), i: 0 };
}

/* ---------- views ---------- */
function show(view) { ["home", "quiz", "result", "review", "cards"].forEach((v) => { $("#view-" + v).hidden = v !== view; }); window.scrollTo({ top: 0 }); }

function renderWhoami() {
  const p = PLAYERS[state.player];
  $("#whoAva").className = "ava " + p.cls; $("#whoAva").textContent = p.ava; $("#whoName").textContent = p.name;
}

function fmtDate(d) { const dt = new Date(d + "T00:00:00"); return dt.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }); }
function fmtShort(d) { const dt = new Date(d + "T00:00:00"); return { day: dt.getDate(), mon: dt.toLocaleDateString(undefined, { month: "short" }) }; }

function renderWords() {
  const isToday = state.current === state.days[0]?.date;
  $("#homeDate").textContent = (isToday ? "Today · " : "") + fmtDate(state.current);
  $("#startLabel").textContent = isToday ? "Start today's quiz" : "Quiz for " + fmtDate(state.current);
  const box = $("#wordList"); box.innerHTML = "";
  state.words.forEach((w) => {
    const card = { date: state.current, word: w.word, pron: w.pron || "", meaning: w.meaning, example: w.example || "" };
    const saved = Cards.has(card);
    const c = el("div", "word");
    c.innerHTML = `<div class="top"><span class="w">${w.word}</span>${w.pron ? `<span class="say">${w.pron}</span>` : ""}</div>
      <div class="mean">${w.meaning}</div>${w.example ? `<div class="ex">“${w.example}”</div>` : ""}
      <button class="save${saved ? " on" : ""}" aria-pressed="${saved}" aria-label="${saved ? "Remove from" : "Add to"} flashcards">${saved ? ICON_BM_ON : ICON_BM}</button>`;
    c.querySelector(".save").addEventListener("click", async () => {
      if (Cards.has(card)) { await Cards.remove(card); toast("Removed from flashcards"); }
      else { await Cards.add(card); toast("Added to flashcards"); }
      renderWords(); renderDeckEntry();
    });
    box.appendChild(c);
  });
}

/* ---------- flashcards ---------- */
const ICON_BM = `<svg viewBox="0 0 24 24" fill="none"><path d="M7 4h10v16l-5-3.5L7 20z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;
const ICON_BM_ON = `<svg viewBox="0 0 24 24"><path d="M7 4h10v16l-5-3.5L7 20z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;
const ICON_FLIP = `<svg viewBox="0 0 24 24" fill="none"><path d="M4 12a8 8 0 0 1 14-5.3M18 3v4h-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function renderDeckEntry() {
  const n = state.cards.length;
  $("#deckCount").textContent = n ? `${n} card${n === 1 ? "" : "s"} saved` : "No cards saved yet";
}

function tagDate(d) { return new Date(d + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" }).toUpperCase(); }
function highlightWord(example, word) {
  const stem = word.slice(0, Math.max(4, word.length - 2)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return example.replace(new RegExp("\\b(" + stem + "\\w*)", "i"), "<mark>$1</mark>");
}

function renderDeck() {
  const cards = state.cards; const n = cards.length;
  const wrap = $("#fcCard"); wrap.classList.remove("flipped");
  $("#fcControls").hidden = !n; $("#fcRemove").hidden = !n;
  if (!n) {
    $("#fcCount").textContent = "0 / 0"; $("#fcProgress").style.width = "0%";
    wrap.innerHTML = `<div class="fc-face"><div class="fc-front"><div class="fc-big fc-empty">No cards yet</div>
      <div class="fc-hint">Tap the bookmark on any word to save it here.</div></div></div>`;
    return;
  }
  state.deckIdx = Math.min(Math.max(state.deckIdx, 0), n - 1);
  const c = cards[state.deckIdx];
  $("#fcCount").textContent = `${state.deckIdx + 1} / ${n}`;
  $("#fcProgress").style.width = `${((state.deckIdx + 1) / n) * 100}%`;
  wrap.innerHTML = `
    <div class="fc-face">
      <div class="fc-tag"><span>Word</span><b>${tagDate(c.date)}</b></div>
      <div class="fc-front"><div class="fc-big">${c.word}</div>${c.pron ? `<div class="fc-pron">${c.pron}</div>` : ""}</div>
      <div class="fc-hint">${ICON_FLIP}Tap to see the meaning</div>
    </div>
    <div class="fc-face fc-back">
      <div class="fc-tag"><span>Meaning</span><b>${tagDate(c.date)}</b></div>
      <div class="fc-backbody">
        <div class="fc-word">${c.word}</div>
        <div><div class="fc-lbl">Meaning</div><div class="fc-mean">${c.meaning}</div></div>
        ${c.example ? `<div><div class="fc-lbl">Example</div><div class="fc-ex">${highlightWord(c.example, c.word)}</div></div>` : ""}
      </div>
    </div>`;
}
function flipCard() { if (state.cards.length) $("#fcCard").classList.toggle("flipped"); }
function stepCard(delta) { const n = state.cards.length; if (!n) return; state.deckIdx = (state.deckIdx + delta + n) % n; renderDeck(); }
async function removeCurrentCard() {
  const c = state.cards[state.deckIdx]; if (!c) return;
  await Cards.remove(c); toast("Removed from deck");
  renderDeck(); renderDeckEntry(); renderWords();
}
function openDeck() { state.deckIdx = 0; renderDeck(); show("cards"); }

function renderLeaderboard() {
  const box = $("#leaderboard"); box.innerHTML = "";
  const date = state.current;
  const win = dailyWinner(date);
  const ls0 = longestStreak(PLAYERS[0].key), ls1 = longestStreak(PLAYERS[1].key);
  const streakLeader = ls0 === 0 && ls1 === 0 ? null : (ls0 >= ls1 ? 0 : 1);

  const crown = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 18h16l1-9-5 3-4-6-4 6-5-3z"/></svg>`;
  const flame = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2c1 3-1 4-2 6s0 4 2 4 3-2 2-5c3 2 4 5 4 7a7 7 0 1 1-14 0c0-4 4-6 4-9 0-1 0-2 0-3 .8.3 2.2 1 4 3z"/></svg>`;

  const hero = el("div", "lb");
  const row = el("div", "hero");
  // daily winner tile
  const t1 = el("div", "stat");
  if (win && !win.tie) {
    const p = PLAYERS[win.player]; const sc = scoreFor(date, p.key);
    t1.innerHTML = `<div class="lbl" style="color:var(--gold)">${crown}Today's winner</div>
      <div class="who"><span class="ava ${p.cls}">${p.ava}</span><span class="nm">${p.name}${win.sole ? " so far" : ""}</span><span class="v">${sc.score}/${sc.total}</span></div>`;
  } else if (win && win.tie) {
    t1.innerHTML = `<div class="lbl" style="color:var(--gold)">${crown}Today</div><div class="who"><span class="nm">It's a tie!</span></div>`;
  } else {
    t1.innerHTML = `<div class="lbl" style="color:var(--gold)">${crown}Today's winner</div><div class="who"><span class="nm" style="color:var(--ink-soft);font-size:13px">No scores yet</span></div>`;
  }
  // longest streak tile
  const t2 = el("div", "stat");
  if (streakLeader == null) {
    t2.innerHTML = `<div class="lbl" style="color:var(--flame)">${flame}Longest streak</div><div class="who"><span class="nm" style="color:var(--ink-soft);font-size:13px">Play to start one</span></div>`;
  } else {
    const p = PLAYERS[streakLeader]; const v = streakLeader === 0 ? ls0 : ls1;
    t2.innerHTML = `<div class="lbl" style="color:var(--flame)">${flame}Longest streak</div>
      <div class="who"><span class="ava ${p.cls}">${p.ava}</span><span class="nm">${p.name}</span><span class="v">${v} day${v === 1 ? "" : "s"}</span></div>`;
  }
  row.append(t1, t2); hero.appendChild(row);

  // standings
  const stand = el("div", "stand");
  PLAYERS.forEach((p, idx) => {
    const ls = idx === 0 ? ls0 : ls1;
    const isWinner = win && !win.tie && win.player === idx;
    const r = el("div", "row" + (isWinner ? " win" : ""));
    r.innerHTML = `<span class="ava ${p.cls}">${p.ava}</span><span class="nm">${p.name}</span>
      ${isWinner ? `<span class="crown">${crown}</span>` : ""}
      <span class="pill">${flame}${ls}</span>`;
    stand.appendChild(r);
  });
  hero.appendChild(stand);
  box.appendChild(hero);
}

/* ---------- revise: month calendar ---------- */
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const pad2 = (n) => String(n).padStart(2, "0");
const dstr = (y, m, day) => `${y}-${pad2(m + 1)}-${pad2(day)}`;
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
const dowMon = (y, m) => (new Date(y, m, 1).getDay() + 6) % 7; // Monday = 0
function todayStr() { return state.days[0] ? state.days[0].date : new Date().toISOString().slice(0, 10); }
function revYears() {
  const now = +todayStr().slice(0, 4);
  const ys = state.days.map((d) => +d.date.slice(0, 4));
  const min = ys.length ? Math.min(...ys) : now;
  const out = []; for (let y = min; y <= now; y++) out.push(y); return out;
}

function renderRevise() {
  if (!state.rev) { const t = todayStr(); state.rev = { y: +t.slice(0, 4), m: +t.slice(5, 7) - 1 }; }
  const { y, m } = state.rev;
  $("#revMonLbl").textContent = MONTHS[m];
  $("#revYrLbl").textContent = y;

  const lessons = new Set(state.days.map((d) => d.date));
  const player = PLAYERS[state.player].key;
  const today = todayStr();
  const grid = $("#reviseGrid"); grid.innerHTML = "";
  const n = daysIn(y, m), lead = dowMon(y, m);
  for (let i = 0; i < lead; i++) grid.appendChild(el("div", "revcell blank"));

  let played = 0;
  for (let day = 1; day <= n; day++) {
    const ds = dstr(y, m, day);
    const hasLesson = lessons.has(ds);
    const sc = hasLesson ? scoreFor(ds, player) : null;
    const cell = el("button", "revcell");
    if (!hasLesson) {
      cell.classList.add("none"); cell.innerHTML = `<span class="d">${day}</span>`;
    } else if (sc) {
      played++; cell.classList.add("played");
      if (sc.score >= Math.ceil(sc.total * 0.9)) cell.classList.add("high");
      cell.innerHTML = `<span class="d">${day}</span><span class="s">${sc.score}/${sc.total}</span>`;
    } else {
      cell.classList.add("missed"); cell.innerHTML = `<span class="d">${day}</span><span class="dot"></span>`;
    }
    if (ds === today) {
      cell.classList.add("today");
      if (hasLesson && !sc) { cell.classList.remove("missed"); cell.classList.add("play"); cell.innerHTML = `<span class="d">${day}</span><span class="s">play</span>`; }
    }
    if (hasLesson) cell.addEventListener("click", async () => {
      await loadDay(ds); renderWords(); renderLeaderboard(); show("home");
    });
    grid.appendChild(cell);
  }
  $("#reviseDone").textContent = played ? `${played} played` : "";
}

function stepMonth(delta) {
  let { y, m } = state.rev; m += delta;
  if (m < 0) { m = 11; y -= 1; } if (m > 11) { m = 0; y += 1; }
  state.rev = { y, m }; closeRevMenus(); renderRevise();
}
function closeRevMenus() { const a = $("#revMonMenu"), b = $("#revYrMenu"); if (a) a.hidden = true; if (b) b.hidden = true; }
function markRevMenus() {
  [...$("#revMonMenu").children].forEach((b, i) => b.classList.toggle("on", i === state.rev.m));
  [...$("#revYrMenu").children].forEach((b) => b.classList.toggle("on", +b.textContent === state.rev.y));
}
function wireReviseControls() {
  const monMenu = $("#revMonMenu"), yrMenu = $("#revYrMenu");
  monMenu.innerHTML = ""; yrMenu.innerHTML = "";
  MONTHS.forEach((nm, i) => { const b = el("button", null, nm.slice(0, 3)); b.addEventListener("click", (e) => { e.stopPropagation(); state.rev.m = i; closeRevMenus(); renderRevise(); }); monMenu.appendChild(b); });
  revYears().forEach((yy) => { const b = el("button", null, String(yy)); b.addEventListener("click", (e) => { e.stopPropagation(); state.rev.y = yy; closeRevMenus(); renderRevise(); }); yrMenu.appendChild(b); });
  $("#revPrev").addEventListener("click", () => stepMonth(-1));
  $("#revNext").addEventListener("click", () => stepMonth(1));
  $("#revMonBtn").addEventListener("click", (e) => { e.stopPropagation(); yrMenu.hidden = true; monMenu.hidden = !monMenu.hidden; markRevMenus(); });
  $("#revYrBtn").addEventListener("click", (e) => { e.stopPropagation(); monMenu.hidden = true; yrMenu.hidden = !yrMenu.hidden; markRevMenus(); });
  document.addEventListener("click", closeRevMenus);
}

/* ---------- quiz flow ---------- */
function startQuiz() { state.quiz = buildQuiz(state.words, state.current); renderQuestion(); show("quiz"); }

function renderQuestion() {
  const q = state.quiz; const item = q.questions[q.i];
  $("#quizCount").textContent = `Question ${q.i + 1} of ${q.questions.length}`;
  const dots = $("#quizDots"); dots.innerHTML = "";
  q.questions.forEach((_, k) => { const d = el("i"); if (k < q.i) d.className = "done"; else if (k === q.i) d.className = "now"; dots.appendChild(d); });

  const card = $("#quizCard"); const foot = $("#quizFoot"); card.innerHTML = ""; foot.innerHTML = "";

  card.appendChild(el("div", "ask", item.prompt));
  const opts = el("div", "opts");
  item.options.forEach((o, k) => {
    const b = el("button", "opt", `<span class="k">${"ABCD"[k]}</span>${o}<span class="tick"><svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`);
    b.addEventListener("click", () => { q.answers[q.i] = { value: k }; revealAndAdvance(); });
    opts.appendChild(b);
  });
  card.appendChild(opts);
}
function nextLabel() { return state.quiz.i === state.quiz.questions.length - 1 ? "See results" : "Next"; }

function revealAndAdvance() {
  const q = state.quiz; const item = q.questions[q.i]; const chosen = q.answers[q.i].value;
  const opts = $("#quizCard").querySelectorAll(".opt");
  opts.forEach((b, k) => { b.disabled = true; if (k === item.answer) b.classList.add("correct"); else if (k === chosen) b.classList.add("wrong"); });
  const foot = $("#quizFoot"); foot.innerHTML = "";
  const btn = el("button", "cta", nextLabel()); btn.addEventListener("click", advance); foot.appendChild(btn);
}
function advance() { const q = state.quiz; if (q.i < q.questions.length - 1) { q.i += 1; renderQuestion(); } else finishQuiz(); }

function isCorrect(item, ans) { return !!ans && ans.value === item.answer; }

async function finishQuiz() {
  const q = state.quiz;
  const score = q.questions.reduce((n, item, k) => n + (isCorrect(item, q.answers[k]) ? 1 : 0), 0);
  const total = q.questions.length;
  await Scores.save({ date: q.date, player: PLAYERS[state.player].key, score, total });
  renderResult(score, total);
  show("result");
}

function renderResult(score, total) {
  const box = $("#resultCard"); const pct = score / total;
  const dash = 327, off = Math.round(dash * (1 - pct));
  const win = dailyWinner(state.current);
  const me = state.player, other = 1 - me;
  const mine = scoreFor(state.current, PLAYERS[me].key), theirs = scoreFor(state.current, PLAYERS[other].key);
  const streak = longestStreak(PLAYERS[me].key);

  const crown = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 18h16l1-9-5 3-4-6-4 6-5-3z"/></svg>`;
  const flame = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2c1 3-1 4-2 6s0 4 2 4 3-2 2-5c3 2 4 5 4 7a7 7 0 1 1-14 0c0-4 4-6 4-9 0-1 0-2 0-3 .8.3 2.2 1 4 3z"/></svg>`;

  let banner = "", beat = "";
  if (win && !win.tie && win.player === me) {
    banner = `<div class="winbanner">${crown}You won today</div>`;
    beat = theirs ? `<div class="beat">You beat ${PLAYERS[other].name} by ${mine.score - theirs.score} point${Math.abs(mine.score - theirs.score) === 1 ? "" : "s"} 💛</div>` : `<div class="beat">First one done today — ${PLAYERS[other].name}'s turn!</div>`;
  } else if (win && win.tie) {
    banner = `<div class="winbanner">${crown}Dead heat — it's a tie!</div>`;
  } else if (win && win.player === other) {
    banner = `<div class="winbanner lose">${crown}${PLAYERS[other].name} leads today</div>`;
    beat = `<div class="beat">${theirs.score}/${theirs.total} to beat — try a re-run!</div>`;
  }

  const msg = pct >= 0.9 ? "Outstanding!" : pct >= 0.7 ? "Nice work!" : pct >= 0.5 ? "Good effort" : "Keep practising";

  box.innerHTML = `
    <div class="ring">
      <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" fill="none" stroke="var(--rule)" stroke-width="10"/>
      <circle cx="60" cy="60" r="52" fill="none" stroke="var(--accent-2)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${dash}" stroke-dashoffset="${off}"/></svg>
      <div class="val">${score}<small>OUT OF ${total}</small></div>
    </div>
    <h3>${msg}</h3>
    ${banner}${beat}
    <div class="streakline">${flame}${streak}-day streak</div>
    <div class="actions">
      <button class="cta" id="rReviewAns">Review answers</button>
      <button class="cta ghost" id="rRetry">Try again</button>
      <button class="cta ghost" id="rHome">Back to home</button>
    </div>`;
  $("#rReviewAns").addEventListener("click", () => { renderReview(); show("review"); });
  $("#rRetry").addEventListener("click", startQuiz);
  $("#rHome").addEventListener("click", () => { renderLeaderboard(); renderRevise(); show("home"); });
}

function renderReview() {
  const q = state.quiz;
  const box = $("#reviewList"); box.innerHTML = "";
  let score = 0;
  q.questions.forEach((item, k) => {
    const ans = q.answers[k];
    const ok = isCorrect(item, ans);
    if (ok) score++;
    const chosen = ans ? item.options[ans.value] : "—";
    const correct = item.options[item.answer];
    const card = el("div", "rev-q " + (ok ? "correct" : "wrong"));
    card.innerHTML =
      `<div class="rev-n">Q${k + 1} · ${ok ? "Correct" : "Incorrect"}</div>
       <div class="rev-prompt">${item.prompt}</div>
       <div class="rev-ans"><span class="lbl">Your answer</span><span class="v">${chosen}</span></div>` +
      (ok ? "" : `<div class="rev-correct"><span class="lbl">Correct</span><span class="v">${correct}</span></div>`);
    box.appendChild(card);
  });
  $("#reviewScore").textContent = `${score}/${q.questions.length}`;
}

/* ---------- toast ---------- */
let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 1800); }

/* ---------- wiring ---------- */
function wireHeader() {
  const pop = $("#idpop");
  $("#whoami").addEventListener("click", () => { if (state.identityLocked) return; pop.hidden = !pop.hidden; });
  pop.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { setPlayer(Number(b.dataset.player)); pop.hidden = true; renderRevise(); }));
  document.addEventListener("click", (e) => { if (!pop.hidden && !pop.contains(e.target) && !$("#whoami").contains(e.target)) pop.hidden = true; });
  $("#startQuiz").addEventListener("click", startQuiz);
  $("#quizBack").addEventListener("click", () => { renderLeaderboard(); show("home"); });
  $("#reviewBack").addEventListener("click", () => show("result"));
  $("#reviewHome").addEventListener("click", () => { renderLeaderboard(); renderRevise(); show("home"); });

  // flashcards
  $("#openDeck").addEventListener("click", openDeck);
  $("#fcBack").addEventListener("click", () => show("home"));
  $("#fcCard").addEventListener("click", flipCard);
  $("#fcFlip").addEventListener("click", flipCard);
  $("#fcPrev").addEventListener("click", () => stepCard(-1));
  $("#fcNext").addEventListener("click", () => stepCard(1));
  $("#fcRemove").addEventListener("click", removeCurrentCard);
  // swipe left / right between cards
  let sx = null;
  $("#fcCard").addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; }, { passive: true });
  $("#fcCard").addEventListener("touchend", (e) => {
    if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null;
    if (Math.abs(dx) > 50) { e.preventDefault(); stepCard(dx < 0 ? 1 : -1); }
  });
}

async function init() {
  wireHeader();
  await loadIdentity();
  renderWhoami();
  try {
    await loadIndex();
    if (!state.days.length) { $("#wordList").innerHTML = `<div class="muted">No lessons yet — check back after the daily run.</div>`; return; }
    await loadDay(state.days[0].date);
    await Promise.all([Scores.list(), Cards.list()]);
    renderDeckEntry();
    const t0 = todayStr(); state.rev = { y: +t0.slice(0, 4), m: +t0.slice(5, 7) - 1 };
    wireReviseControls();
    renderWords(); renderLeaderboard(); renderRevise();
  } catch (e) {
    $("#wordList").innerHTML = `<div class="muted">Couldn't load today's words.<br><small>${e.message}</small></div>`;
  }
}
init();
