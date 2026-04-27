# CodexHub v0.4.3

## 中文

本版本覆盖 7 个稳定性和规模化方向：

- Companion 增加 GitHub Release 更新检查，并在后台定期检查新版本。
- Companion 增加本机服务自动修复开关，会尝试拉起 Farfield 和 agent。
- Web/PWA 增加浏览器通知，新的未读任务可以触发系统通知权限。
- 云端支持 `CODEXHUB_READONLY_TOKEN` 只读令牌，可用于大屏或旁观设备。
- 任务详情同步最近 20 条 Codex 输出，方便回看更完整上下文。
- 安装信息改为基于服务器 `/downloads` 的一键下载/解压/安装命令。
- 大屏看板增加今日完成和失败命令统计，实时队列也显示最近完成内容。

## English

This release covers seven reliability and fleet-operation improvements:

- Companion can check GitHub Releases for updates and performs a background update check.
- Companion adds an auto-repair toggle that attempts to restart Farfield and the local agent.
- The Web/PWA console can use browser notifications for new unread work items.
- The cloud server supports `CODEXHUB_READONLY_TOKEN` for read-only dashboards.
- Task details now sync up to 20 recent Codex messages for better context.
- Install profiles now use one-line download/extract/install commands from server `/downloads`.
- The TV dashboard now shows today's completions and failed command counts.
