import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const cwd = fileURLToPath(new URL("../", import.meta.url));
try {
  const response = await fetch("http://127.0.0.1:4318/health", {headers: {Origin: "https://eco-screen-crm-v2.vercel.app"}, signal: AbortSignal.timeout(1500)});
  if ((await response.json()).ready) process.exit(0);
  throw new Error("Another service is using the collector port.");
} catch (error) {
  if (error.message.includes("Another service")) throw error;
  const child = spawn(process.execPath, ["scripts/local-social-service.mjs"], {cwd, detached: true, windowsHide: true, stdio: "ignore"});
  child.unref();
}
