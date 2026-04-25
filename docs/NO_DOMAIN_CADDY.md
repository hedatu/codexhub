# 无域名部署 CodexHub

可以没有域名。区别是 HTTPS 体验不同。

## 方案 A：公网 IP + HTTP

最快能跑通，手机访问：

```text
http://你的服务器IP
```

Caddyfile：

```caddyfile
:80 {
  encode gzip
  reverse_proxy 127.0.0.1:8787
}
```

缺点：令牌通过 HTTP 传输，不建议长期公网使用。

## 方案 B：公网 IP + Caddy 内部 HTTPS

Caddyfile：

```caddyfile
https://你的服务器IP {
  tls internal
  encode gzip
  reverse_proxy 127.0.0.1:8787
}
```

缺点：浏览器不会默认信任 Caddy 的内部 CA。安卓手机上需要安装并信任 Caddy 根证书，否则会出现证书警告。

## 方案 C：Tailscale + Caddy/内网访问

如果你不想备案，也不想处理证书，可以让手机和电脑都进同一个 Tailscale 网络。这样不需要公网域名，暴露面也更小。

推荐优先级：

1. 测试阶段：公网 IP + HTTP。
2. 自己用且能接受安装证书：公网 IP + `tls internal`。
3. 长期稳定：Tailscale 私网，或买境外服务器和域名走正常 HTTPS。
