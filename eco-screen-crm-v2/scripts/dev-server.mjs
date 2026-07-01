import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = process.argv[2] ? resolve(process.argv[2]) : projectRoot;
const port = Number(process.env.PORT || 4174);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

createServer(async (req, res) => {
  try {
    const rawPath = decodeURIComponent((req.url || "/").split("?")[0]);
    const requestPath = rawPath === "/" ? "index.html" : rawPath.replace(/^[/\\]+/, "");
    const safePath = normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
    if (safePath === "src/env.js") {
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      res.end(`export const runtimeEnv = ${JSON.stringify({
        VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || "",
        VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || ""
      }, null, 2)};\n`);
      return;
    }
    let filePath = join(root, safePath || "index.html");
    if (!existsSync(filePath)) filePath = join(root, "index.html");
    const body = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mime[extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(error.message || "Server error");
  }
}).listen(port, () => {
  console.log(`Eco Screen CRM V2 running at http://localhost:${port}`);
});
