import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const htmlPath = join(root, "standalone-preview.html");
const html = readFileSync(htmlPath, "utf8");
const errors = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

assert(!/console\.log|console\.error|console\.warn|debugger|TODO|FIXME/.test(html), "Remove debug code from standalone-preview.html.");
assert(!/UPDATED 2026/.test(html), "Remove temporary update banner.");
assert(/function saveQuote\(\)/.test(html), "Quotation save function missing.");
assert(/function convertCurrentQuoteToOrder\(\)/.test(html), "Quotation to order function missing.");
assert(/function generateProductionSheet/.test(html), "Production generation function missing.");
assert(/function generateInstallationSheet/.test(html), "Installation generation function missing.");
assert(/function deductInventoryForProduction/.test(html), "Inventory deduction function missing.");
assert(/function orderCostBreakdown/.test(html), "Profit and cost breakdown function missing.");
assert(/function printWarrantyCard/.test(html), "Warranty PDF/print function missing.");
assert(/function downloadQuotationPdf/.test(html), "Quotation PDF function missing.");
assert(/function supabaseFetch/.test(html), "Supabase API helper missing.");
assert(/NEXT_PUBLIC_SUPABASE_URL/.test(readFileSync(join(root, ".env.example"), "utf8")), ".env.example missing Supabase URL.");
assert(/NEXT_PUBLIC_SUPABASE_ANON_KEY/.test(readFileSync(join(root, ".env.example"), "utf8")), ".env.example missing Supabase anon key.");
assert(existsSync(join(root, "vercel.json")), "vercel.json missing.");
assert(existsSync(join(root, "outputs", "supabase-setup.sql")), "supabase-setup.sql missing.");
assert(existsSync(join(root, "outputs", "supabase-business-migration.sql")), "supabase-business-migration.sql missing.");

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
try {
  scripts.forEach((match) => new Function(match[1]));
} catch (error) {
  errors.push(`HTML script syntax error: ${error.message}`);
}

if (errors.length) {
  process.stderr.write(errors.map((error) => `- ${error}`).join("\n") + "\n");
  process.exit(1);
}

process.stdout.write("Lint passed\n");
