import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const target = process.argv[2] || "dist";
const port = Number(process.env.PORT || 3000);
const targetPath = resolve(root, target);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".sql": "text/plain; charset=utf-8"
};

function resolveRequest(url) {
  if (statSync(targetPath).isFile()) return targetPath;
  const pathname = decodeURIComponent(new URL(url, `http://localhost:${port}`).pathname);
  const filePath = pathname === "/" ? join(targetPath, "index.html") : join(targetPath, pathname);
  return existsSync(filePath) && statSync(filePath).isFile() ? filePath : join(targetPath, "index.html");
}

createServer((request, response) => {
  try {
    const filePath = resolveRequest(request.url || "/");
    response.writeHead(200, { "Content-Type": types[extname(filePath)] || "application/octet-stream" });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(String(error));
  }
}).listen(port, () => {
  process.stdout.write(`Eco Screen preview running at http://localhost:${port}\n`);
});
