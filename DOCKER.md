# Docker 部署教程

> 从零开始，5 分钟内部署班级宠物养成系统。前后端合并为一个镜像，一个容器搞定。

---

## 概述

只有一个容器，Express 同时提供 API 和前端页面：

```
用户浏览器 ──▶ Express (端口 3000)
                   │
                   │  /api/*  后端接口
                   │  其他    前端页面 (React SPA)
                   │
                   └── SQLite 数据库 + AI 大模型
```

镜像托管在阿里云容器镜像服务，已公开，无需登录即可拉取。

启动时自动检测环境：
- 数据库不存在或缺少表结构 → 自动初始化
- 无需额外配置，开箱即用

---

## 前置条件

你需要准备：

- **一台 Linux 服务器**（Ubuntu / Debian / CentOS 均可）
- **AI API Key**（用于作业生成和批改功能）

---

## 第一步：安装 Docker

SSH 登录服务器后，一条命令安装：

```bash
curl -fsSL https://get.docker.com | bash
```

安装完成后启动 Docker：

```bash
systemctl enable docker
systemctl start docker
```

验证安装：

```bash
docker --version
# 输出类似：Docker version 27.x.x
```

---

## 第二步：创建部署目录

```bash
mkdir -p /opt/pet && cd /opt/pet
```

之后所有操作都在 `/opt/pet` 目录下进行。

---

## 第三步：创建配置文件

### 3.1 创建 .env 文件（存放密钥）

```bash
cat > .env << 'EOF'
# 必填：AI API 密钥（用于作业生成和批改）
AI_API_KEY=你的AI密钥

# 可选：JWT 签名密钥（建议改成随机字符串）
JWT_SECRET=改成你自己的随机字符串
EOF
```

> ⚠️ 没有 AI_API_KEY 的话，作业生成和 AI 批改功能无法使用，其他功能正常。

### 3.2 创建 docker-compose.yml

```bash
cat > docker-compose.yml << 'EOF'
services:
  pet:
    image: registry.cn-hangzhou.aliyuncs.com/myfdocker/pet:latest
    container_name: class-pet
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - JWT_SECRET=${JWT_SECRET:-class-pet-game-secret-key-2024}
      - JWT_EXPIRES_IN=7d
      - FRONTEND_URL=${FRONTEND_URL:-http://localhost:3000}
      - AI_API_KEY=${AI_API_KEY}
      - AI_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
      - AI_MODEL=doubao-seed-2-0-pro-260215
    volumes:
      - ./data:/app/data
EOF
```

---

## 第四步：启动系统

```bash
docker compose pull      # 拉取最新镜像
docker compose up -d     # 后台启动
```

首次启动会自动初始化数据库，日志中会看到：

```
数据库文件不存在，执行初始化...
=== 初始化数据库 ===
...
✅ Real SQLite Database initialized successfully
服务器运行在端口 3000
```

验证是否成功：

```bash
docker compose ps
```

应该看到容器是 `Up` 状态：

```
NAME        STATUS
class-pet   Up
```

---

## 第五步：访问系统

打开浏览器，访问：

```
http://你的服务器IP:3000
```

### 首次使用

1. 打开页面后点击 **注册**
2. 第一个注册的用户自动成为 **管理员**
3. 管理员可以创建学校、班级，邀请教师和学生加入

---

## 第六步：配置 HTTPS（推荐）

### 6.1 安装 Nginx 和证书工具

```bash
apt update && apt install -y nginx certbot
```

### 6.2 申请 Let's Encrypt 免费证书

```bash
# 申请证书（把 your-domain.com 换成你的域名）
certbot certonly --standalone -d your-domain.com
```

按提示输入邮箱、同意条款。

### 6.3 配置 Nginx 反向代理

```bash
cat > /etc/nginx/sites-available/pet << 'EOF'
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }

    location /socket.io {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
}
EOF

ln -sf /etc/nginx/sites-available/pet /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

### 6.4 修改 FRONTEND_URL

编辑 `/opt/pet/docker-compose.yml`，把 `FRONTEND_URL` 从 `http://localhost:3000` 改为 `https://your-domain.com`，然后重启：

```bash
docker compose up -d
```

### 6.5 设置证书自动续期

```bash
(crontab -l 2>/dev/null; echo '0 3 * * * certbot renew --quiet && systemctl reload nginx') | crontab -
```

---

## 环境变量参考

| 变量 | 必填 | 默认值 | 说明 |
|------|:--:|------|------|
| `AI_API_KEY` | ✅ | 无 | AI 大模型 API 密钥 |
| `FRONTEND_URL` | ✅ | `http://localhost:3000` | 前端访问地址，影响 CORS 和邀请链接 |
| `JWT_SECRET` | ❌ | 内置默认值 | JWT 签名密钥，生产环境建议修改 |
| `JWT_EXPIRES_IN` | ❌ | `7d` | 登录有效期 |
| `AI_BASE_URL` | ❌ | `https://ark.cn-beijing.volces.com/api/v3` | AI API 地址 |
| `AI_MODEL` | ❌ | `doubao-seed-2-0-pro-260215` | AI 模型名称 |

---

## 日常维护

### 更新到最新版本

```bash
cd /opt/pet
docker compose pull
docker compose up -d
```

### 备份数据库

```bash
cp /opt/pet/data/database.sqlite /opt/pet/data/database.sqlite.bak.$(date +%Y%m%d)
```

### 恢复数据库

```bash
docker compose stop
cp 备份文件 /opt/pet/data/database.sqlite
docker compose start
```

### 查看日志

```bash
docker compose logs -f
```

### 重启系统

```bash
docker compose restart
```

### 停止系统

```bash
docker compose stop             # 停止（保留容器）
docker compose down             # 停止并删除容器
```

---

## 更换域名

如果以后换域名，需要改 3 处：

1. **重新申请证书**：`certbot certonly --standalone -d 新域名`
2. **更新 Nginx 配置**：修改 `/etc/nginx/sites-available/pet` 中的域名和证书路径，`systemctl reload nginx`
3. **修改 docker-compose.yml**：`FRONTEND_URL` 改为新域名，`docker compose up -d`

---

## 常见问题

### Q: 页面打开了但 API 报 500 错误？

```bash
docker logs class-pet --tail 30
```

常见原因：数据库未初始化。删除数据库文件让容器重新初始化：

```bash
rm -f /opt/pet/data/database.sqlite
docker compose restart
```

### Q: 端口被占用？

```bash
# 查看谁占用了 3000 端口
lsof -i :3000

# 修改 docker-compose.yml 中的端口映射，比如改成 8080:3000
```

### Q: 如何重置所有数据？

```bash
docker compose down
rm -rf /opt/pet/data
docker compose up -d
```

---

## 镜像地址

| 镜像 | 地址 |
|------|------|
| pet | `registry.cn-hangzhou.aliyuncs.com/myfdocker/pet:latest` |
