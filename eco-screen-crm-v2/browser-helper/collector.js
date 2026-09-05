// Runs only after a user starts a scan. Reads rendered comments, never cookies or private APIs.
export async function collectPublicComments(platform, maximum) {
  window.__ecoCollectorStop = false;
  const selectors = {
    tiktok: '[data-e2e="comment-item"], [class*="DivCommentItemContainer"]',
    facebook: '[role="article"]',
    rednote: '.comment-item'
  };
  const rows = new Map();
  const sourceUrl = location.href;
  const deadline = Date.now() + 60000;
  let stable = 0;
  let rounds = 0;
  const visible = element => Boolean(element?.getClientRects().length);
  const text = element => element?.innerText?.trim() || "";
  while (Date.now() < deadline && rows.size < maximum && stable < 5) {
    if (window.__ecoCollectorStop) return {error: "已停止扫描。"};
    if (location.href !== sourceUrl) return {error: "页面已切换，扫描已停止。"};
    const pageText = document.body.innerText;
    const gate = /captcha|verify to continue|安全验证|拖动滑块|验证后继续|log in to continue|登录后查看|登录后继续/i;
    if (gate.test(pageText) || /\/login(?:[/?#]|$)/.test(location.pathname)) return {error: "平台要求登录或安全验证，请在打开的页面自行完成后重新扫描。"};
    if (/此内容目前无法显示|this content isn't available|私密账号|private account/i.test(pageText)) return {error: "该内容未公开或当前无法访问。"};
    const before = rows.size;
    const nodes = [...document.querySelectorAll(selectors[platform] || "eco-no-comments")].filter(visible);
    for (const node of nodes) {
      let profile, body, date;
      if (platform === "tiktok") {
        profile = node.querySelector('a[href*="/@"]');
        body = node.querySelector('[data-e2e="comment-level-1"], [data-e2e="comment-level-2"]');
        date = node.querySelector('[data-e2e="comment-time-1"], [data-e2e="comment-time-2"]');
      } else if (platform === "rednote") {
        profile = node.querySelector('a[href*="/user/profile/"]');
        body = node.querySelector('.content .note-text, .content');
        date = node.querySelector('.date');
      } else {
        // A comment permalink is required: never mistake the post/article itself for a comment.
        if (!node.querySelector('a[href*="comment_id="]') || node.querySelector('[role="article"]')) continue;
        profile = [...node.querySelectorAll('a[href]')].find(a => text(a) && !/comment_id=|\/posts\/|\/videos\//.test(a.href));
        body = [...node.querySelectorAll('[dir="auto"]')].find(e => !e.querySelector('[dir="auto"]') && !e.closest('a') && text(e).length > 1);
        date = node.querySelector('a[href*="comment_id="]');
      }
      if (!visible(body) || !visible(profile) || !text(body)) continue;
      const profileUrl = new URL(profile.href, location.href);
      if (profileUrl.protocol !== "https:" || profileUrl.hostname !== location.hostname) continue;
      const comment = text(body).slice(0, 5000);
      const key = `${profileUrl.pathname}|${comment}`;
      rows.set(key, {
        platform, username: profileUrl.pathname.split('/').filter(Boolean).at(-1),
        displayName: text(profile).slice(0, 150), profileUrl: profileUrl.href,
        comment, commentedAt: "", displayedTime: text(date), sourceUrl,
        region: "", contactEligibility: "not_eligible"
      });
      if (rows.size >= maximum) break;
    }
    stable = rows.size === before ? stable + 1 : 0;
    rounds++;
    if (rows.size >= maximum) break;
    nodes.at(-1)?.scrollIntoView({block: "end"});
    // Use ordinary scrolling only. Do not trigger links, messages, reactions or hidden endpoints.
    const last = nodes.at(-1);
    let scroller = last?.parentElement;
    while (scroller && scroller !== document.body && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
    if (scroller && scroller !== document.body) scroller.scrollBy(0, 600);
    else window.scrollBy(0, 600);
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  if (!rows.size) return {error: "未读取到评论。请先展开公开评论区，再重试；也可能是评论关闭或平台限制。"};
  return {comments: [...rows.values()], exhausted: false, cursor: "", partial: true, rounds};
}
