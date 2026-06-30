import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("index.html", "dist/index.html");
await cp("src", "dist/src", { recursive: true });
if (existsSync("public")) await cp("public", "dist/public", { recursive: true });
console.log("Build complete: dist/index.html");
