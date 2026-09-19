#!/usr/bin/env node
/**
 * Zero-dependency static server for local preview of WordNest.
 * Serves the repo root so index.html + data/*.json load over http.
 *
 * Note: this does NOT run the Cloudflare Functions in /api — locally the app
 * falls back to localStorage for scores. Use `npm run dev:cf` (wrangler) if you
 * need the real /api endpoints against a local D1.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 3000;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent((req.url || "/").split("?")[0]);
    if (path === "/") path = "/index.html";

    // resolve inside ROOT only (block traversal)
    const filePath = normalize(join(ROOT, path));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) {
      // Local stub: the real /api runs on Cloudflare. Answer /api/me so the
      // client cleanly falls back to its player picker instead of erroring.
      if (path === "/api/me") {
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ email: null, player: null }));
        return;
      }
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found: " + path);
      return;
    }

    const body = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    }).end(body);
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/plain" }).end("Server error: " + e.message);
  }
});

server.listen(PORT, () => {
  console.log(`WordNest dev server → http://localhost:${PORT}`);
  console.log(`(static preview; scores use localStorage. Use 'npm run dev:cf' for the /api backend.)`);
});
