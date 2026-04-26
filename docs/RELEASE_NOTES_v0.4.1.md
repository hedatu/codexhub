# CodexHub v0.4.1 Release Notes

This release focuses on CodexHub Companion.

- Companion now defaults to Chinese and lets the user switch between Chinese and English from the tray menu.
- The local status window follows the selected language instead of showing mixed bilingual labels.
- The Windows service detector now falls back to process detection when Task Scheduler entries are missing.
- Companion can still start and stop local services manually when scheduled tasks are unavailable.
- The desktop icon has been replaced with a clearer CodexHub node icon.
- The cloud server exposes `/api/nodes/:id/self` so a desktop node can check its own cloud state with its `nodeKey`.

## 中文说明

这个版本主要改进 CodexHub Companion。

- 默认语言改为中文，可在托盘菜单里切换中文 / English。
- 本机状态窗口会跟随当前语言，不再中英混排。
- Windows 上如果没有任务计划，Companion 会继续检查实际运行进程，避免误报 `Missing`。
- 即使任务计划不存在，Companion 仍可用手动进程方式启动/停止本地服务。
- 替换了更清晰的 CodexHub 节点图标。
- 云端新增 `/api/nodes/:id/self`，桌面节点可以用自己的 `nodeKey` 查询自身状态。
