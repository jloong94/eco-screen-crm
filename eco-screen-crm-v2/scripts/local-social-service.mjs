import http from "node:http";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { socialSource, publicPostLinks } from "../src/socialSources.js";
import { collectPublicComments } from "../browser-helper/collector.js";

const port = 4318;
const origin = "https://eco-screen-crm-v2.vercel.app";
const jobs = new Map();
let active;
let browser;
let lastStart = 0;
const executablePath = [process.env.SOCIAL_BROWSER_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(path => path && existsSync(path));
const reply = (res, status, data) => { res.writeHead(status, {"Content-Type": "application/json", "Cache-Control": "no-store"}); res.end(JSON.stringify(data)); };
const publicJob = job => ({id: job.id, status: job.status, postsFound: job.postsFound, postsScanned: job.postsScanned, commentsFound: job.comments.length, message: job.message, failures: job.failures, partial: true, ...(job.status === "complete" ? {comments: job.comments} : {})});

async function open(url, job) {
  if (job.cancelled) throw new Error("已停止扫描。");
  if (!browser) {
    browser = await chromium.launchPersistentContext(join(process.cwd(), ".local/social-browser"), {executablePath, headless: false, viewport: {width: 1280, height: 900}});
    browser.on("close", () => { browser = null; });
  }
  const page = browser.pages()[0] || await browser.newPage();
  job.page = page;
  await page.goto(url, {waitUntil: "domcontentloaded", timeout: 25000});
  await page.waitForTimeout(1500);
  const resolved = socialSource(page.url());
  if (!resolved || resolved.kind === "share" || resolved.platform !== job.platform) throw new Error("页面跳转到登录页或分享链接未展开，请完成登录并复制地址栏完整链接后重试。");
  const body = await page.locator("body").innerText();
  if (/captcha|verify to continue|安全验证|拖动滑块|登录后查看|登录后继续|log in to continue/i.test(body)) throw new Error("需要本人在打开的浏览器完成登录或验证码，然后重试。");
  if (job.cancelled) throw new Error("已停止扫描。");
  return page;
}

async function scan(job, source) {
  try {
    let page = await open(source.url, job);
    const resolved = socialSource(page.url());
    let posts = [page.url()];
    if (resolved.kind === "profile") {
      job.message = "正在寻找主页公开贴文…";
      let links = [];
      for (let round = 0; round < 4 && !job.cancelled; round++) {
        links.push(...await page.locator('a[href]').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => node.href)));
        posts = publicPostLinks(links, job.platform, 5);
        if (posts.length >= 5) break;
        await page.mouse.wheel(0, 800);
        await page.waitForTimeout(1200);
      }
      if (!posts.length) throw new Error("没有读取到主页公开贴文。请检查主页是否公开，以及是否需要登录。");
    }
    job.postsFound = posts.length;
    const seen = new Set();
    for (const post of posts) {
      if (job.cancelled || job.comments.length >= job.maximum) break;
      try {
        page = await open(post, job);
        job.message = `正在读取第 ${job.postsScanned + 1}/${posts.length} 条贴文的公开评论…`;
        const commentControl = job.platform === "tiktok"
          ? page.locator('[data-e2e="comment-icon"]').first()
          : job.platform === "rednote" ? page.locator('.interact-container .chat-wrapper').first() : null;
        if (commentControl && await commentControl.isVisible().catch(() => false)) {
          await commentControl.click({timeout: 2000}).catch(() => {});
          await page.waitForTimeout(1000);
        }
        const result = await page.evaluate(collectPublicComments, [job.platform, job.maximum - job.comments.length]);
        if (result.error) {
          if (/登录|验证/.test(result.error)) throw new Error(result.error);
          job.failures.push({sourceUrl: post, message: result.error});
        } else for (const row of result.comments) {
          const key = `${row.profileUrl}|${row.comment}|${post}`;
          if (!seen.has(key) && job.comments.length < job.maximum) {
            seen.add(key);
            job.comments.push({...row, sourceUrl: post, contactEligibility: "not_eligible"});
          }
        }
        job.postsScanned++;
      } catch (error) {
        if (job.cancelled || /登录|验证/.test(error.message)) throw error;
        job.failures.push({sourceUrl: post, message: "该贴文无法读取或超时。"});
        job.postsScanned++;
      }
    }
    if (job.cancelled) throw new Error("已停止扫描。");
    if (!job.comments.length) throw new Error(job.failures[0]?.message || "未读取到公开评论，无法判断有没有潜客。");
    job.status = "complete";
    job.message = `已读取 ${job.comments.length} 条评论（本次最多检查 5 条已加载贴文）。`;
  } catch (error) {
    job.status = job.cancelled ? "stopped" : "blocked";
    job.message = /[\u3400-\u9fff]/.test(error.message) ? error.message : "浏览器无法完成读取，请检查页面后重试。";
  } finally { active = null; job.finishedAt = Date.now(); }
}

const server = http.createServer(async (req, res) => {
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host) || req.headers.origin !== origin) return reply(res, 403, {error: "Forbidden"});
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  for (const [id, job] of jobs) if (job.finishedAt && Date.now() - job.finishedAt > 600000) jobs.delete(id);
  const path = new URL(req.url, `http://127.0.0.1:${port}`).pathname;
  if (req.method === "GET" && path === "/health") return reply(res, 200, {ready: Boolean(executablePath), platforms: ["tiktok", "facebook", "rednote"], activeJobId: active?.id || null});
  const id = path.match(/^\/jobs\/([a-f0-9-]+)(?:\/stop)?$/)?.[1];
  if (id && req.method === "GET") return jobs.has(id) ? reply(res, 200, publicJob(jobs.get(id))) : reply(res, 404, {error: "任务已过期，请重试。"});
  if (id && path.endsWith("/stop") && req.method === "POST") {
    const job = jobs.get(id);
    if (job) { job.cancelled = true; void job.page?.evaluate(() => { window.__ecoCollectorStop = true; }).catch(() => {}); }
    return reply(res, 200, {stopped: true});
  }
  if (path !== "/jobs" || req.method !== "POST") return reply(res, 404, {error: "Not found"});
  if (!String(req.headers["content-type"] || "").startsWith("application/json")) return reply(res, 415, {error: "JSON required"});
  if (active || Date.now() - lastStart < 5000) return reply(res, 429, {error: "正在扫描或请求太快，请稍后再试。"});
  try {
    let raw = "";
    for await (const chunk of req) { raw += chunk; if (raw.length > 4096) return reply(res, 413, {error: "请求太长。"}); }
    const body = JSON.parse(raw);
    const source = socialSource(body.sourceUrl);
    if (!source) return reply(res, 400, {error: "请输入三个平台的公开主页或贴文 HTTPS 链接。"});
    if (!executablePath) return reply(res, 503, {error: "本机找不到 Chrome 或 Edge。"});
    const job = {id: randomUUID(), platform: source.platform, maximum: Math.min(200, Math.max(1, Number(body.maximum) || 50)), status: "running", message: "正在打开商家主页…", postsFound: 0, postsScanned: 0, comments: [], failures: [], cancelled: false};
    active = job; lastStart = Date.now(); jobs.set(job.id, job);
    reply(res, 202, publicJob(job));
    void scan(job, source);
  } catch { reply(res, 400, {error: "请求格式不正确。"}); }
});
server.listen(port, "127.0.0.1", () => console.log(`Eco Screen local collector listening on 127.0.0.1:${port}`));
