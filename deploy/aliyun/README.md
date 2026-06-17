# 阿里云 ECS 部署

目标环境：Alibaba Cloud Linux 4 LTS，ECS 公网 IP，先用 SQLite。

## 服务器路径

- 应用目录：`/opt/flower-position-pwa`
- 数据目录：`/var/lib/flower-position`
- 环境变量：`/etc/flower-position.env`
- systemd 服务：`flower-position.service`
- Nginx 站点：`/etc/nginx/conf.d/flower-position.conf`

## 环境变量

```bash
DATA_DIR=/var/lib/flower-position
PORT=8000
PLANTNET_API_KEY=你的 PlantNet API key
PLANTNET_PROJECT=all
```

## 部署后验证

```bash
systemctl status flower-position --no-pager
curl -s http://127.0.0.1:8000/api/health
curl -s http://公网IP/api/health
```

## HTTPS

公网 IP 可以先测试页面和 API，但浏览器定位、通知和 PWA 安装在正式使用时需要 HTTPS。建议后续绑定域名，再用 Certbot 或阿里云证书配置 Nginx HTTPS。
