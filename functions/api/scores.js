/* Cloudflare Pages Function: GET/POST /api/scores  (backed by D1) */

// Map each Cloudflare Access identity to a player key.
// Fill in Nefny's email before deploying with Access enabled.
const PLAYER_BY_EMAIL = {
  "shabilmuhammed@gmail.com": "shabil",
  "REPLACE_WITH_NEFNY_EMAIL": "nefny",
};
const VALID = new Set(["shabil", "nefny"]);

function playerFor(request, bodyPlayer) {
  // In production the identity is proven by Cloudflare Access — trust the header.
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (email && PLAYER_BY_EMAIL[email]) return PLAYER_BY_EMAIL[email];
  // Local dev (no Access in front): fall back to the player the client claims.
  if (bodyPlayer && VALID.has(bodyPlayer)) return bodyPlayer;
  return null;
}

async function allScores(env) {
  const { results } = await env.DB
    .prepare("SELECT date, player, score, total FROM scores ORDER BY date DESC")
    .all();
  return results || [];
}

export async function onRequestGet({ env }) {
  try {
    return Response.json({ scores: await allScores(env) });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  let body = {};
  try { body = await request.json(); } catch (_) {}

  const player = playerFor(request, body.player);
  const date = String(body.date || "").slice(0, 10);
  const score = Number(body.score);
  const total = Number(body.total);

  if (!player || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(score) || !Number.isFinite(total) ||
      score < 0 || total <= 0 || score > total) {
    return new Response(JSON.stringify({ error: "Bad request" }), { status: 400 });
  }

  // Keep the best score per (date, player).
  await env.DB.prepare(
    `INSERT INTO scores (date, player, score, total, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(date, player) DO UPDATE SET
       score = MAX(score, excluded.score),
       total = excluded.total,
       updated_at = excluded.updated_at`
  ).bind(date, player, score, total, new Date().toISOString()).run();

  return Response.json({ scores: await allScores(env) });
}
