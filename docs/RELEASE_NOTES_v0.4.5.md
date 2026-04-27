# CodexHub v0.4.5

## 中文

本版本把服务器侧可靠性补齐到生产部署可用的形态：

- SQLite 持久化：服务器默认可使用 `/opt/codexhub/data/codexhub.db` 保存状态。
- 自动备份：新增 `codexhub-backup.timer`，每天生成 `/opt/codexhub/backups/codexhub-backup-*.tar.gz`。
- FCM 真接入：改为 Firebase HTTP v1 + 服务账号 OAuth，不再只是预留 token 接口。
- Web/TWA 自动登记：配置 Firebase Web 参数后，手机网页或 TWA 会自动登记 FCM token。
- Go/Node 双运行时同步：正式包优先运行的 Go 服务器也具备 SQLite 和 FCM 能力。

服务器上推荐把 Firebase 服务账号放在：

```bash
/opt/codexhub/secrets/firebase-service-account.json
```

然后在 `/opt/codexhub/codexhub.env` 配置：

```bash
CODEXHUB_FCM_SERVICE_ACCOUNT_FILE=/opt/codexhub/secrets/firebase-service-account.json
CODEXHUB_FCM_PROJECT_ID=your-firebase-project-id
CODEXHUB_FIREBASE_WEB_CONFIG={"apiKey":"...","authDomain":"...","projectId":"...","messagingSenderId":"...","appId":"..."}
CODEXHUB_FIREBASE_VAPID_KEY=your-web-push-vapid-key
```

如果暂时没有 Firebase 配置，网页端待处理列表、SSE 实时刷新和手动刷新仍然可用。

## English

This release improves server-side reliability for production self-hosting:

- SQLite persistence: server state can be stored in `/opt/codexhub/data/codexhub.db`.
- Automatic backups: `codexhub-backup.timer` creates daily archives under `/opt/codexhub/backups`.
- Real FCM support: Firebase HTTP v1 service-account OAuth replaces the previous placeholder-style registration path.
- Web/TWA registration: the web console can automatically register an FCM token when Firebase Web config is present.
- Go/Node parity: the packaged Go server and the development Node server now support the same SQLite and FCM behavior.

Recommended Firebase service-account path:

```bash
/opt/codexhub/secrets/firebase-service-account.json
```

Then set the FCM and Firebase Web environment values in `/opt/codexhub/codexhub.env` and restart `codexhub.service`.
