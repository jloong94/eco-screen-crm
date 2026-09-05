(() => {
  const mark = () => { document.documentElement.dataset.ecoCollector = "ready"; };
  mark();
  window.addEventListener("eco-collector-request", async (event) => {
    const request = event.detail;
    if (!request || typeof request.id !== "string") return;
    try {
      const result = await chrome.runtime.sendMessage(request);
      window.dispatchEvent(new CustomEvent("eco-collector-result", { detail: { id: request.id, ...result } }));
    } catch {
      window.dispatchEvent(new CustomEvent("eco-collector-result", { detail: { id: request.id, error: "浏览器助手已断开，请刷新页面重试。" } }));
    }
  });
})();
