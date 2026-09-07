const base = "http://127.0.0.1:4318";

export async function localCollectorStatus() {
  try {
    const response = await fetch(`${base}/health`, {signal: AbortSignal.timeout(1800)});
    const data = await response.json();
    return Boolean(response.ok && data.ready);
  } catch { return false; }
}

export async function scanLocalSource(request) {
  let id;
  let stopped = false;
  const cancel = () => { stopped = true; if (id) void fetch(`${base}/jobs/${id}/stop`, {method: "POST", headers: {"Content-Type": "application/json"}, body: "{}"}).catch(() => {}); };
  request.signal?.addEventListener("abort", cancel, {once: true});
  async function call(path, options = {}) {
    let response;
    try { response = await fetch(base + path, {...options, signal: AbortSignal.timeout(5000)}); }
    catch { throw new Error("本机采集服务未连接。请在已配置的电脑打开系统；若浏览器询问本地网络访问，请允许。手机暂不支持自动主页采集。"); }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取失败，请重试。");
    return data;
  }
  try {
    if (request.signal?.aborted) throw new Error("已停止扫描。");
    const job = await call("/jobs", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({sourceUrl: request.sourceUrl, maximum: request.maximum})});
    id = job.id;
    if (stopped) { cancel(); throw new Error("已停止扫描。"); }
    const deadline = Date.now() + 540000;
    while (Date.now() < deadline) {
      if (stopped) throw new Error("已停止扫描。");
      const state = await call(`/jobs/${id}`);
      request.onProgress?.(state.message);
      if (state.status === "complete") return {comments: state.comments, partial: true, failures: state.failures, postsScanned: state.postsScanned};
      if (state.status !== "running") throw new Error(state.message);
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    throw new Error("扫描超时，请减少数量后重试。");
  } finally {
    cancel();
    request.signal?.removeEventListener("abort", cancel);
  }
}
