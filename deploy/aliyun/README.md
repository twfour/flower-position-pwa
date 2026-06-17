# 阿里云 ECS 部署

目标环境：Alibaba Cloud Linux 4 LTS，ECS 公网 IP，先用 SQLite。

## 服务器路径

- 应用目录：`/opt/flower-position-pwa`
- 数据目录：`/var/lib/flower-position`
- 备份目录：`/var/backups/flower-position`
- 环境变量：`/etc/flower-position.env`
- systemd 服务：`flower-position.service`
- systemd 备份定时器：`flower-position-backup.timer`
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

## SQLite 自动备份

项目包含一个不依赖第三方库的备份脚本：

```bash
python3 /opt/flower-position-pwa/deploy/aliyun/backup_sqlite.py
```

默认会把 `/var/lib/flower-position/observations.sqlite3` 备份到
`/var/backups/flower-position`，文件名类似
`observations-20260617-032000.sqlite3.gz`，并保留最近 14 份。

启用每天自动备份：

```bash
cp /opt/flower-position-pwa/deploy/aliyun/flower-position-backup.service /etc/systemd/system/
cp /opt/flower-position-pwa/deploy/aliyun/flower-position-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now flower-position-backup.timer
systemctl list-timers flower-position-backup.timer --no-pager
```

手动验证一次：

```bash
systemctl start flower-position-backup.service
ls -lh /var/backups/flower-position
```

## HTTPS

公网 IP 可以先测试页面和 API，但浏览器定位、通知和 PWA 安装在正式使用时需要 HTTPS。建议后续绑定域名，再用 Certbot 或阿里云证书配置 Nginx HTTPS。
