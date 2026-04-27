# CodexHub v0.4.2

## 中文

本版本重点增强手机端远程控制的闭环体验：

- 任务详情新增同步时间线：云端记录、手机指令排队、桌面端接收、转发 Codex、Codex 回复状态一屏可见。
- 任务详情新增最近消息列表，从本地 Codex session 中同步最近输出，便于手机端判断任务进展。
- 手机指令失败会自动进入未读通知，避免“显示已发送但实际失败”的情况被忽略。
- 节点列表新增搜索和筛选：可按电脑名、主机名、标签、最近任务检索，并筛选运行中、同步注意、同步异常。
- 同步诊断继续保留云端、Farfield、Codex 会话、命令回执、未读通知五段检查。
- Service Worker 缓存升级到 `codexhub-v18`，手机端重新打开后会加载新版页面。

## English

This release improves the mobile remote-control loop:

- Task details now include a delivery timeline covering cloud record, mobile queue, desktop pickup, Codex forwarding, and Codex reply status.
- Task details now show recent Codex session messages so mobile users can understand current progress before replying.
- Failed mobile commands now create unread notifications instead of silently staying in command history.
- Node management now supports search and filters for running nodes, sync warnings, and sync errors.
- Sync diagnostics continue to cover cloud heartbeat, Farfield, Codex session reads, command receipts, and unread notifications.
- Service Worker cache has been bumped to `codexhub-v18`.
