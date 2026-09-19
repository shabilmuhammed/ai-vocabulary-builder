# WordNest 🪺

A cozy daily English-vocabulary game for two (Shabil & Nefny). Every morning a
Claude cloud routine teaches 35 new words and commits them to this repo; the web
app turns them into a quiz, tracks a **daily winner** and **longest streak**, and
lets you **revise past days**.

## How it fits together

```
Claude routine ──writes──> daily/<date>.md ──build-data──> data/<date>.json
                                                              │
                                          Cloudflare Pages ───┤ serves the site
                                          (static + Functions)│
                                                              └─> /api/scores ──> D1 (leaderboard)
```

- **Content**: `daily/*.md` (human-readable) is the source of truth. `scripts/build-data.mjs`
  converts it into `data/*.json` + `data/index.json` that the app reads.
- **Frontend**: plain HTML/CSS/JS at the repo root — `index.html`, `styles.css`, `app.js`.
  No build step. Quizzes are generated in the browser, seeded by the date so both
  players get the *same* questions.
- **Backend**: Cloudflare Pages Functions in `functions/api/` backed by a D1 database
  (`schema.sql`). Identity comes from **Cloudflare Access** (no passwords to build).

## Local development

```bash
npm run build:data          # regenerate data/ from daily/
python3 -m http.server 8787 # quick static preview (scores use localStorage)
# or, with the real API + local D1:
npm run dev                 # wrangler pages dev . --d1=DB
```

## Deploy (one-time)

1. **Create a Cloudflare account** (free) and `wrangler login`.
2. **Create the database**: `wrangler d1 create wordnest` → paste the `database_id`
   into `wrangler.toml`.
3. **Init the schema**: `npm run db:init:remote`.
4. **Connect this repo** to a Cloudflare **Pages** project (build output dir = `/`).
5. **Lock it down** with **Cloudflare Access** → allow only Shabil's and Nefny's
   Google emails. Then put Nefny's email into `functions/api/scores.js` and
   `functions/api/me.js` (replacing `REPLACE_WITH_NEFNY_EMAIL`).

That's it — push to `main` and Cloudflare redeploys automatically.
