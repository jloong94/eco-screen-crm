import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const required = [
  "src/main.js",
  "src/state.js",
  "src/calculations.js",
  "src/products.js",
  "src/quotations.js",
  "src/storage.js",
  "src/styles.css"
];

for (const file of required) await readFile(file, "utf8");

async function listFiles(dir) {
  const rows = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const row of rows) {
    const path = join(dir, row.name);
    if (row.isDirectory()) files.push(...await listFiles(path));
    if (row.isFile()) files.push(path);
  }
  return files;
}

const sourceFiles = await listFiles("src");
for (const file of sourceFiles) {
  const text = await readFile(file, "utf8");
  if (/\bdebugger\b|TODO|FIXME/.test(text)) throw new Error(`Remove debug marker from ${file}`);
  if (file.endsWith(".js")) execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
}

console.log("Lint passed");
