# Android App Packaging

CodexHub is already a PWA. The Android app should be packaged as a Trusted Web Activity (TWA), so the installed APK opens the same HTTPS dashboard without duplicating the frontend.

## Recommended path

1. Keep `https://codex.915500.xyz` available over valid HTTPS.
2. Use `android/twa-manifest.json` as the Bubblewrap project template.
3. Generate a release signing key and keep it private.
4. Build the APK or AAB.
5. Put the generated SHA-256 signing fingerprint into `.well-known/assetlinks.json` on the server.

## Build outline

```bash
npm install -g @bubblewrap/cli
powershell -ExecutionPolicy Bypass -File ./scripts/build-android-twa.ps1 -Version 0.4.9
```

For Play Store distribution, build an AAB. For direct installation on your own phones, an APK is enough.

The direct-install APK is emitted as:

```text
dist/codexhub-android-v0.4.9.apk
```

## Server file required

After signing, replace the placeholder in `android/assetlinks.template.json` and publish it as:

```text
https://codex.915500.xyz/.well-known/assetlinks.json
```

Without this file, Android may still open the app, but it can show browser chrome instead of a full trusted app surface.

The local signing credentials are written under `dist/android/`. Keep the keystore and password file; future APK upgrades must use the same key.

## 中文说明

CodexHub 手机端本质上已经是 PWA。安卓 App 推荐用 TWA 打包：APK 只是一个外壳，里面打开的还是同一个 HTTPS 控制台。

这样后续网页更新后，安卓端不需要重新发版；只有图标、包名、签名等原生外壳信息变化时才需要重新打包。

直装 APK 输出位置：

```text
dist/codexhub-android-v0.4.9.apk
```

本地签名密钥和密码文件在 `dist/android/` 下，后续升级 APK 必须保留同一套密钥。
