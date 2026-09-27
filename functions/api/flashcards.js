/* Cloudflare Pages Function: GET/POST/DELETE /api/flashcards  (backed by D1)
 * Each player has one deck. Cards keep the word's data so the deck never has
 * to reload old lessons. */

const PLAYER_BY_EMAIL = {
  "shabilmuhammed@gmail.com": "shabil",
  "hnefny@gmail.com": "nefny",
};
const VALID = new Set(["shabil", "nefny"]);

function playerFor(request, claimed) {
  // In production Cloudflare Access proves who this is — trust only that.
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (email) return PLAYER_BY_EMAIL[email] || null;
  // Local dev (no Access in front): fall back to the player the client claims.
  return claimed && VALID.has(claimed) ? claimed : null;
}

const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const json = (data, status = 200) => Response.json(data, { status });

async function deck(env, player) {
  const { results } = await env.DB
    .prepare("SELECT date, word, pron, meaning, example FROM flashcards WHERE player = ?1 ORDER BY created_at ASC")
    .bind(player).all();
  return results || [];
}

async function readBody(request) {
  try { return await request.json(); } catch (_) { return {}; }
}

export async function onRequestGet({ request, env }) {
  const player = playerFor(request, new URL(request.url).searchParams.get("player"));
  if (!player) return json({ error: "Unknown player" }, 401);
  return json({ cards: await deck(env, player) });
}

export async function onRequestPost({ request, env }) {
  const body = await readBody(request);
  const player = playerFor(request, body.player);
  if (!player) return json({ error: "Unknown player" }, 401);

  const date = clip(body.date, 10), word = clip(body.word, 60), meaning = clip(body.meaning, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !word || !meaning) return json({ error: "Bad request" }, 400);

  await env.DB.prepare(
    `INSERT INTO flashcards (player, date, word, pron, meaning, example, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(player, date, word) DO NOTHING`
  ).bind(player, date, word, clip(body.pron, 60), meaning, clip(body.example, 400), new Date().toISOString()).run();

  return json({ cards: await deck(env, player) });
}

export async function onRequestDelete({ request, env }) {
  const body = await readBody(request);
  const player = playerFor(request, body.player);
  if (!player) return json({ error: "Unknown player" }, 401);

  await env.DB.prepare("DELETE FROM flashcards WHERE player = ?1 AND date = ?2 AND word = ?3")
    .bind(player, clip(body.date, 10), clip(body.word, 60)).run();

  return json({ cards: await deck(env, player) });
}
