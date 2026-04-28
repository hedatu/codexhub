# CodexHub 故障排查手册

CodexHub 的链路是：

```text
手机/大屏网页 -> 云端 CodexHub Server -> 每台电脑 CodexHub Agent -> Farfield 本地服务 -> Codex 桌面版
```

如果网页信息不准，按这个顺序查：云端是否在线、电脑端是否上报、Farfield 是否能读到 Codex、命令队列是否有回执。

## 1. 云端服务器

```bash
curl -fsS https://你的域名/api/health
systemctl status codexhub --no-pager
systemctl status caddy --no-pager
journalctl -u codexhub -n 100 --no-pager
```

正常现象：

- `/api/health` 返回 `ok: true`
- `codexhub.service` 是 `active`
- 如果前面还有 1Panel/OpenResty，确认它反代到 Caddy 或 CodexHub 的端口没有断

502/Bad Gateway 通常是反代链路断了。先查 CodexHub 是否监听本地端口，再查 OpenResty/Caddy 的 upstream 是否还是原端口。

## 2. Windows 电脑端

PowerShell：

```powershell
Get-ScheduledTask -TaskName CodexHub*
Get-Process | Where-Object { $_.ProcessName -match 'codexhub|node|farfield' }
Get-Content C:\ProgramData\CodexHub\agent.json
```

成熟安装包应当后台运行，不应该弹出命令行窗口。如果看到很多 `node.exe ... desktop-agent\agent.mjs`，说明旧版 Node Agent 仍在重启循环，建议升级到 Go Agent 包，或先停止旧任务再重新安装。

清理旧任务时不要删除配置文件：

```powershell
schtasks /End /TN CodexHubAgent
schtasks /End /TN CodexHubFarfield
```

然后重新打开 CodexHub Companion，或运行安装器修复。

## 3. Farfield 本地服务

电脑端需要能访问：

```text
http://127.0.0.1:4311/health
```

如果 Farfield 不可用，网页会显示：

- Farfield 本地服务异常
- Codex 会话读取失败
- 线程状态可能停在旧状态

优先让 Companion 执行“启动本地服务”或等待自动修复。如果仍失败，检查 Codex 桌面版是否打开，以及是否被安全软件拦截本地端口。

## 4. 状态不同步

大屏或手机端显示“运行中”，但电脑端已经结束时，重点看自检页里的这些字段：

- 最后心跳：电脑是否还在上报
- Farfield：本地网关是否可读
- Codex 会话读取：是否读到最新线程
- 命令回执：刷新/回复/审批命令是否完成

如果只是状态旧，点击大屏的“请求电脑重新采集”。这不是浏览器刷新，而是给在线电脑下发重新采集命令。

## 5. 命令队列卡住

命令会先进入 `queued`，电脑端拉取后变为 `leased`，电脑端回执后变成 `done` 或 `failed`。

现在服务端会自动处理租约超时：

- 租约过期后自动重新排队
- 最多重试 5 次
- 仍无回执则自动标记为失败，避免无限卡住

如果持续失败，说明电脑端 Agent 没有正常拉取或执行命令。先查电脑端上报和 Farfield，再看 Companion 状态页的自动修复结果。

## 6. SQLite 与备份

推荐云端使用 SQLite：

```bash
sqlite3 --version
systemctl show codexhub -p Environment
```

常见路径：

- SQLite：由 `CODEXHUB_SQLITE_FILE` 决定
- JSON 兼容快照：由 `CODEXHUB_DATA_FILE` 决定
- 备份目录：由 `CODEXHUB_BACKUP_DIR` 决定

创建备份：

```bash
curl -X POST https://你的域名/api/backups/create \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

自检页会提示最近一次备份时间。超过 36 小时没有备份会显示注意，超过 7 天会显示异常。

## 7. FCM / 通知

FCM 本身不向 CodexHub 收费，但需要 Firebase 项目配置。服务端至少需要：

- `CODEXHUB_FCM_PROJECT_ID`
- `CODEXHUB_FCM_SERVICE_ACCOUNT_FILE` 或 `CODEXHUB_FCM_SERVICE_ACCOUNT_JSON`
- Web/PWA 推送还需要 `CODEXHUB_FIREBASE_WEB_CONFIG` 和 `CODEXHUB_FIREBASE_VAPID_KEY`

如果 FCM 没接好，网页仍可用，但手机不会收到系统级推送。未读完成通知仍会出现在“待处理/自检报告”里。

## 8. 更新检查

更新状态会出现在：

- Companion 托盘菜单
- 总控大屏指挥操作台
- 自检报告
- 主控制台运维区域

如果更新检查失败，通常是服务器或电脑无法访问 GitHub Release API。软件仍能运行，只是无法自动发现新版本。

## English Quick Reference

Check the chain in this order: server health, desktop heartbeat, Farfield local gateway, Codex session read, command acknowledgements.

Useful commands:

```bash
curl -fsS https://your-domain/api/health
systemctl status codexhub --no-pager
journalctl -u codexhub -n 100 --no-pager
```

On Windows, check scheduled tasks and the Companion status page. If commands remain leased and never complete, the desktop Agent is not polling or cannot execute the command. The server now requeues expired command leases and marks them failed after repeated timeouts.
