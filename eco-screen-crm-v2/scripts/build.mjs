import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("index.html", "dist/index.html");
await cp("src", "dist/src", { recursive: true });
if (existsSync("public")) await cp("public", "dist/public", { recursive: true });
await writeFile("dist/src/env.js", `export const runtimeEnv = ${JSON.stringify({
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || "",
  VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || ""
}, null, 2)};\n`);
console.log("Build complete: dist/index.html");
