# 本机主页采集

正式网站输入 TikTok、Facebook 或小红书主页／贴文链接，点击「找客户」。平台由链接识别。

本机运行 `npm run collector`。已安装依赖的电脑也可双击 `Start Social Collector.cmd` 后打开正式网站，无需浏览器插件。电脑重启后需重新启动服务。仅这台电脑可用；手机和其他电脑不会连接到本机服务。

服务监听 `127.0.0.1:4318`，只接受正式网站 Origin，并拒绝其他 Host、非 HTTPS 来源、群组和非平台地址。浏览器可能要求允许本地网络访问。采集浏览器使用独立的 `.local/social-browser` 登录状态，不复制日常浏览器 cookies。登录与 CAPTCHA 由本人处理。

主页最多查找 5 条已加载公开贴文；最多读取 200 条评论，非保证数量的客户名单。部分读取会在结果说明中标示。读取失败与无潜客分开。只使用页面显示的评论和公开主页，没有私信读取或自动发送。保持原 Contact Queue 资格和人工确认。当前评分使用已有规则模型，未新增外部 AI。

扫描结果只在本机服务内存保留，完成 10 分钟后于下次请求清理。正式网站收到结果后沿用现有 social leads 存储。已有 CRM 资料及 schema 没有迁移或修改。

## 2026-09-07 验证

- Lint、主页路由／URL 检查、社交评分与去重测试、提取器样本测试、build：通过。
- TikTok `@veemaxsecuremesh` 主页未能发现可读取贴文；其指定视频也未读到评论，0 条，BLOCKED。
- Facebook `renexsteel` 主页与指定视频均发现 1 条贴文，但评论未读取，0 条，BLOCKED。
- 小红书给定贴文被平台中断／跳转，0 条，BLOCKED。未提供该商家主页，主页流程只有路由测试，未通过真实主页验收。
- 上述不代表真实客户采集成功。三个平台均需真实评论读取后再验收。

检查：`npm run test:social-profiles`、`npm run test:social-leads`、`node scripts/browser-helper-test.mjs`。
