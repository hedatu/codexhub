# CodexHub v0.4.4

## 中文

本版本把前面 1 到 10 个方向做成可落地的运维闭环：

- 通知：新增 Webhook/FCM 投递钩子、推送令牌登记和测试接口。
- 节点状态：桌面端心跳增加序号、采集时间、Agent 启动时间和更新元数据。
- 任务状态机：明确运行中、等待回复、待审批、已完成未读、失败和已读归档。
- 手机消息中心：新增未读、待处理、已完成、失败和全部筛选。
- 安装体验：Windows/Linux/macOS 安装脚本写入预检诊断文件。
- 管理后台：设置页展示只读密钥、安卓 APK、今日运营数据、存储状态和推送测试。
- 数据持久化：状态文件增加 schema/storage 元数据，并预留 `CODEXHUB_STORAGE=sqlite` 迁移开关。
- 会话读取：最近消息同步用户/助手上下文，方便手机端判断进度。
- 自动更新：发布包生成 SHA256 release manifest，供后续静默更新校验。
- 大屏/日报：今日完成、更新线程和失败命令进入云端 totals/reports。

## English

This release turns the ten requested directions into a practical operations loop:

- Notification hooks for Webhook/FCM delivery, push token registration, and push testing.
- More accurate node status with heartbeat sequence, collection time, agent start time, and update metadata.
- Explicit task states for running, waiting reply, waiting approval, completed unread, failed, and archived.
- Mobile inbox filters for unread, pending, completed, failed, and all items.
- Installer preflight diagnostics for Windows, Linux, and macOS.
- Admin/settings panel surfaces readonly token, Android APK, daily operations data, storage status, and push testing.
- Persistence metadata and a `CODEXHUB_STORAGE=sqlite` migration switch for future SQLite-backed history.
- Richer session sync with recent user and assistant context.
- Release manifest generation with SHA256 checksums for update verification.
- Daily report metrics for completions, updated threads, and failed commands.
