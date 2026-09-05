import { collectPublicComments } from "./collector.js";

const jobs = new Map();
const hosts = {
  tiktok: ["tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"],
  facebook: ["facebook.com", "www.facebook.com", "web.facebook.com", "m.facebook.com", "fb.watch"],
  rednote: ["xiaohongshu.com", "www.xiaohongshu.com", "xhslink.com"]
};
chrome.runtime.onMessage.addListener((request, sender, reply) => {
  if (new URL(sender.url || "https://invalid").origin !== "https://eco-screen-crm-v2.vercel.app") return;
  const key = sender.tab?.id;
  if (request.type === "stop") {
    const job = jobs.get(key);
    if (job) {
      job.cancelled = true;
      if (job.tabId) void chrome.scripting.executeScript({target: {tabId: job.tabId}, func: () => { window.__ecoCollectorStop = true; }}).catch(() => {});
    }
    reply({stopped: true});
    return;
  }
  if (request.type !== "scan") return;
  if (jobs.has(key)) { reply({error: "正在扫描，请等待完成或先停止。"}); return; }
  const job = {cancelled: false, tabId: null};
  jobs.set(key, job);
  (async () => {
    try {
      const url = new URL(request.sourceUrl);
      if (url.protocol !== "https:" || !hosts[request.platform]?.includes(url.hostname)) throw new Error("请输入正确的平台公开贴文链接。");
      if (/\/groups\//i.test(url.pathname)) throw new Error("不读取 Facebook 群组内容，请使用公开贴文链接。");
      const tab = await chrome.tabs.create({url: url.href, active: true});
      job.tabId = tab.id;
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline && !job.cancelled) {
        const current = await chrome.tabs.get(tab.id);
        if (current.status === "complete") break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (job.cancelled) throw new Error("已停止扫描。");
      const results = await chrome.scripting.executeScript({
        target: {tabId: tab.id}, func: collectPublicComments,
        args: [request.platform, Math.min(200, Math.max(1, Number(request.maximum) || 50))]
      });
      const result = results[0]?.result;
      if (!result) throw new Error("页面未能读取，请确认贴文已打开。");
      if (!result.error) await chrome.tabs.update(key, {active: true});
      reply(result);
    } catch (error) {
      reply({error: /权限|公开|停止|正确/.test(error.message) ? error.message : "无法读取此页面。请检查登录、验证或页面是否允许访问，再重试。"});
    } finally { jobs.delete(key); }
  })();
  return true;
});
