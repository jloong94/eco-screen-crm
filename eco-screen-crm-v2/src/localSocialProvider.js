const base = "http://localhost:4318";
const productionOrigin = "https://eco-screen-crm-v2.vercel.app";

export async function localCollectorStatus() {
  try {
    const response = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(1800),
      targetAddressSpace: "loopback",
    });
    const data = await response.json();
    return Boolean(response.ok && data.ready);
  } catch { return false; }
}

export function scanLocalSource(request) {
  if (typeof window === "undefined") return Promise.reject(new Error("本机采集只可在电脑浏览器使用。"));
  const nonce = crypto.randomUUID();
  const url = new URL(`${base}/scan`);
  url.searchParams.set("source", request.sourceUrl);
  url.searchParams.set("maximum", String(request.maximum || 50));
  url.searchParams.set("nonce", nonce);
  const popup = window.open(url, "_blank");
  if (!popup) return Promise.reject(new Error("浏览器阻止了采集窗口。请允许此网站弹出窗口后重试。"));
  return new Promise((resolve, reject) => {
    const initialTimer = setTimeout(() => finish(new Error("本机采集服务未启动。请双击 Start Social Collector 后重试。")), 12000);
    const deadlineTimer = setTimeout(() => finish(new Error("扫描超时，请减少数量后重试。")), 540000);
    const finish = (error, value) => {
      clearTimeout(initialTimer);
      clearTimeout(deadlineTimer);
      window.removeEventListener("message", receive);
      request.signal?.removeEventListener("abort", stop);
      if (error) reject(error); else resolve(value);
    };
    const stop = () => {
      popup.postMessage({channel: "eco-social-collector", type: "stop", nonce}, base);
      finish(new Error("已停止扫描。"));
    };
    const receive = event => {
      if (event.origin !== base || event.source !== popup || event.data?.channel !== "eco-social-collector" || event.data?.nonce !== nonce) return;
      clearTimeout(initialTimer);
      if (event.data.type === "progress") request.onProgress?.(event.data.message);
      if (event.data.type === "error") finish(new Error(event.data.message || "读取失败，请重试。"));
      if (event.data.type === "complete") finish(null, event.data.result);
    };
    window.addEventListener("message", receive);
    request.signal?.addEventListener("abort", stop, {once: true});
    request.onProgress?.("正在连接本机采集窗口…");
    if (request.signal?.aborted) stop();
  });
}
