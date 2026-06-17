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
HOST=127.0.0.1
PLANTNET_API_KEY=你的 PlantNet API key
PLANTNET_PROJECT=all
```

## 部署后验证

```bash
systemctl status flower-position --no-pager
curl -s http://127.0.0.1:8000/api/health
curl -s http://公网IP/api/health
```

## 一键部署

本地项目根目录执行：

```bash
deploy/aliyun/deploy.sh
```

脚本会打包当前项目，排除 `.git`、`aliyun.txt`、本地 `data` 等文件，
上传到 `/opt/flower-position-pwa`，然后安装 systemd/nginx 配置、重启应用、
启用备份定时器并检查健康接口。

默认连接：

```bash
SSH_TARGET=root@101.37.82.5
HEALTH_URL=http://101.37.82.5/api/health
```

如果项目根目录存在 `aliyun.txt` 且本机安装了 `expect`，脚本会自动用该文件里的
SSH 密码登录；否则使用系统默认 SSH 登录方式。可以按需覆盖：

```bash
SSH_TARGET=root@你的服务器IP HEALTH_URL=http://你的服务器IP/api/health deploy/aliyun/deploy.sh
```

如果本机存在 `~/.ssh/flower_position_aliyun_ed25519`，脚本会优先使用这把密钥：

```bash
SSH_KEY_FILE=~/.ssh/flower_position_aliyun_ed25519 deploy/aliyun/deploy.sh
```

密钥登录验证成功后，可以在服务器上关闭 SSH 密码登录。

## GitHub 自动部署

项目包含 GitHub Actions workflow：`.github/workflows/deploy-aliyun.yml`。
每次推送 `main` 分支后，GitHub 会打包代码并通过 SSH 上传到 ECS，随后重启服务并检查健康接口。

这种方式不要求 ECS 能访问 GitHub，适合当前阿里云访问 GitHub 超时的情况。

需要在 GitHub 仓库设置这些 Secrets：

```bash
ALIYUN_HOST=101.37.82.5
ALIYUN_USER=root
ALIYUN_SSH_KEY=部署用 SSH 私钥内容
ALIYUN_HEALTH_URL=http://101.37.82.5/api/health
```

当前服务器已经允许本机维护密钥登录：

```bash
~/.ssh/flower_position_aliyun_ed25519
```

GitHub Actions 建议使用单独的部署密钥。当前已生成专用密钥：

```bash
~/.ssh/flower_position_github_actions_ed25519
```

它的公钥已追加到 ECS 的 `/root/.ssh/authorized_keys`，私钥已写入仓库 Secret `ALIYUN_SSH_KEY`。

## 服务器安全

阿里云部署建议：

- 后端 Python 服务只监听 `127.0.0.1:8000`
- Nginx 对公网开放 `80/443`
- SSH 只开放 `22`
- 使用 SSH 密钥登录，验证成功后关闭密码登录
- 同时在阿里云安全组中只放行 `22/80/443`

当前加固项：

```bash
# 本机专用 SSH 私钥
~/.ssh/flower_position_aliyun_ed25519

# ECS 防火墙
systemctl status firewalld --no-pager
firewall-cmd --list-all

# ECS SSH 配置
cat /etc/ssh/sshd_config.d/99-flower-position-hardening.conf
sshd -T | grep -E '^(permitrootlogin|passwordauthentication|pubkeyauthentication) '
```

期望结果：

- `firewalld` 已启用
- `firewall-cmd --list-all` 包含 `ssh http https`
- `passwordauthentication no`
- `pubkeyauthentication yes`
- `permitrootlogin without-password`

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

公网 IP 可以先测试页面和 API，但浏览器定位、通知和 PWA 安装在正式使用时需要 HTTPS。

当前域名：

- `qinyibin.com`
- `www.qinyibin.com`

阿里云中国大陆 ECS 需要先完成 ICP 备案。备案未通过时，公网访问域名会被阿里云拦截，
Let’s Encrypt 无法读取 `/.well-known/acme-challenge/`，证书签发会失败。

备案通过后，先部署最新代码：

```bash
deploy/aliyun/deploy.sh
```

然后启用 HTTPS：

```bash
deploy/aliyun/enable_https.sh
```

脚本会依次完成：

- 检查两个域名的 ACME HTTP 验证文件是否公网可访问
- 使用服务器上的 `acme.sh` 为 `qinyibin.com` 和 `www.qinyibin.com` 签发证书
- 安装证书到 `/etc/nginx/ssl/qinyibin.com`
- 切换到 `deploy/aliyun/nginx-https.conf`
- 重载 nginx
- 验证两个 HTTPS 健康接口

如果要回退到 HTTP 配置：

```bash
cp /opt/flower-position-pwa/deploy/aliyun/nginx.conf /etc/nginx/conf.d/flower-position.conf
nginx -t
systemctl reload nginx
```
