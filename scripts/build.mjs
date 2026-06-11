import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const source = join(root, "standalone-preview.html");
const sqlSource = join(root, "outputs", "supabase-setup.sql");
const envLocal = join(root, ".env.local");

if (existsSync(envLocal)) {
  for (const line of readFileSync(envLocal, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

mkdirSync(dist, { recursive: true });

const envScript = `
<script>
(function () {
  var url = ${JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_URL || "")};
  var anonKey = ${JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "")};
  if (url && !localStorage.getItem("eco-screen-supabase-url")) {
    localStorage.setItem("eco-screen-supabase-url", url);
  }
  if (anonKey && !localStorage.getItem("eco-screen-supabase-anon-key")) {
    localStorage.setItem("eco-screen-supabase-anon-key", anonKey);
  }
})();
</script>`;

const html = readFileSync(source, "utf8").replace("<body>", `<body>${envScript}`);

writeFileSync(join(dist, "index.html"), html, "utf8");
writeFileSync(join(dist, "Eco-Screen-Quotation-System.html"), html, "utf8");
copyFileSync(sqlSource, join(dist, "supabase-setup.sql"));

console.log("Build complete: dist/index.html");
