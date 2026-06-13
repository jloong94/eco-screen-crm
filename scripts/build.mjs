import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const source = join(root, "standalone-preview.html");
const sqlSource = join(root, "outputs", "supabase-setup.sql");
const businessSqlSource = join(root, "outputs", "supabase-business-migration.sql");
const envGuideSource = join(root, "outputs", "supabase-env-guide.md");
const envLocal = join(root, ".env.local");
const googleSiteVerification = "puBEvWdWzBbxZBnQF7Fdhih0mY9dkqa5bHY-0EgGaUs";

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

const verificationMeta = `<meta name="google-site-verification" content="${googleSiteVerification}" />`;
const html = readFileSync(source, "utf8")
  .replace("</head>", `    ${verificationMeta}\n  </head>`)
  .replace("<body>", `<body>${envScript}`);

writeFileSync(join(dist, "index.html"), html, "utf8");
writeFileSync(join(dist, "Eco-Screen-Quotation-System.html"), html, "utf8");
copyFileSync(sqlSource, join(dist, "supabase-setup.sql"));
copyFileSync(businessSqlSource, join(dist, "supabase-business-migration.sql"));
copyFileSync(envGuideSource, join(dist, "supabase-env-guide.md"));

process.stdout.write("Build complete: dist/index.html\n");
