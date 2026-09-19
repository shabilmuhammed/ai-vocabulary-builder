/* Cloudflare Pages Function: GET /api/me — who is logged in (via Access) */

const PLAYER_BY_EMAIL = {
  "shabilmuhammed@gmail.com": "shabil",
  "REPLACE_WITH_NEFNY_EMAIL": "nefny",
};

export async function onRequestGet({ request }) {
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  const player = email ? (PLAYER_BY_EMAIL[email] || null) : null;
  return Response.json({ email: email || null, player });
}
