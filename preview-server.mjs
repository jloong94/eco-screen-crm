import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const port = 3000;
const indexPath = join(process.cwd(), "standalone-preview.html");

const server = createServer((request, response) => {
  if (request.url === "/" || request.url?.startsWith("/?")) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(readFileSync(indexPath, "utf8"));
    return;
  }

  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Eco Screen preview is running at http://localhost:${port}`);
});
