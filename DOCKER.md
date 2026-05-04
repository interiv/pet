# Docker 部署教程

> 从零开始，10 分钟内部署班级宠物养成系统。

---

## 概述

本系统由两个 Docker 容器组成：

| 容器 | 作用 | 端口 |
|------|------|------|
| **pet-backend** | 后端 API + 数据库 | 3000（内部） |
| **pet-frontend** | Nginx + React 前端页面 | 80 / 443 |

```
用户浏览器 ──▶ 前端容器 (Nginx) ──▶ 后端容器 (Express API)
                   │                        │
                   │  静态页面               │  SQLite 数据库
                   │  /api/* 转发给后端       │  AI 大模型调用
```

镜像托管在阿里云容器镜像服务，已公开，无需登录即可拉取。

两个容器启动时都会自动检测环境：
- **后端**：数据库不存在或缺少表结构时，自动初始化
- **前端**：没有 SSL 证书时，自动生成自签名证书（HTTPS 立即可用）

---

## 前置条件

你需要准备：

- **一台 Linux 服务器**（Ubuntu / Debian / CentOS 均可）
- **一个域名**（可选，没有的话用 IP 访问也行）
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
  backend:
    image: registry.cn-hangzhou.aliyuncs.com/myfdocker/pet-backend:latest
    container_name: class-pet-backend
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - PORT=3000
      - JWT_SECRET=${JWT_SECRET:-class-pet-game-secret-key-2024}
      - JWT_EXPIRES_IN=7d
      - FRONTEND_URL=${FRONTEND_URL:-http://localhost}
      - AI_API_KEY=${AI_API_KEY}
      - AI_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
      - AI_MODEL=doubao-seed-2-0-pro-260215
    volumes:
      - ./data:/app/data
    networks:
      - app-network

  frontend:
    image: registry.cn-hangzhou.aliyuncs.com/myfdocker/pet-frontend:latest
    container_name: class-pet-frontend
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /opt/pet/certs:/etc/nginx/certs:ro
    depends_on:
      - backend
    networks:
      - app-network

networks:
  app-network:
    driver: bridge
EOF
```

> 首次启动时还没有证书，前端容器会自动生成自签名证书，保证 HTTPS 正常运行。后面拿到正式证书替换即可。

---

## 第四步：启动系统

```bash
docker compose pull      # 拉取最新镜像
docker compose up -d     # 后台启动
```

首次启动会自动初始化数据库（创建表结构、种子数据），日志中会看到：

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

应该看到两个容器都是 `Up` 状态：

```
NAME                 STATUS
class-pet-backend    Up
class-pet-frontend   Up
```

---

## 第五步：访问系统

打开浏览器，访问：

```
https://你的服务器IP    （自签名证书，浏览器会提示不安全，点"继续访问"即可）
http://你的服务器IP     （会自动跳转到 HTTPS）
```

有域名后替换正式证书就不会有安全提示了（见第六步）。

### 首次使用

1. 打开页面后点击 **注册**
2. 第一个注册的用户自动成为 **管理员**
3. 管理员可以创建学校、班级，邀请教师和学生加入

---

## 第六步：替换为正式 SSL 证书（可选）

系统启动后 HTTPS 已经可用，但用的是自签名证书，浏览器会提示"不安全"。有域名后替换为免费正式证书：

### 6.1 安装证书工具

```bash
apt update && apt install -y certbot
```

### 6.2 申请 Let's Encrypt 免费证书

```bash
# 先停掉前端容器（释放 80 端口给 certbot 验证用）
docker compose stop frontend

# 申请证书（把 your-domain.com 换成你的域名）
certbot certonly --standalone -d your-domain.com
```

按提示输入邮箱、同意条款。

### 6.3 复制证书到部署目录

> Let's Encrypt 的证书是软链接，需要 `-L` 复制实际文件。

```bash
cp -L /etc/letsencrypt/live/your-domain.com/fullchain.pem /opt/pet/certs/
cp -L /etc/letsencrypt/live/your-domain.com/privkey.pem /opt/pet/certs/
```

### 6.4 修改 FRONTEND_URL

编辑 `/opt/pet/docker-compose.yml`，把 `FRONTEND_URL` 从 `http://localhost` 改为 `https://your-domain.com`。

### 6.5 重启

```bash
docker compose up -d
```

现在访问 `https://your-domain.com` 就能看到安全锁图标了。

### 6.6 设置证书自动续期

Let's Encrypt 证书有效期 90 天，设置定时任务自动续期：

```bash
(crontab -l 2>/dev/null; echo '0 3 * * * certbot renew --quiet && cp -L /etc/letsencrypt/live/your-domain.com/fullchain.pem /opt/pet/certs/ && cp -L /etc/letsencrypt/live/your-domain.com/privkey.pem /opt/pet/certs/ && docker restart class-pet-frontend') | crontab -
```

---

## 环境变量参考

| 变量 | 必填 | 默认值 | 说明 |
|------|:--:|------|------|
| `AI_API_KEY` | ✅ | 无 | AI 大模型 API 密钥 |
| `FRONTEND_URL` | ✅ | `http://localhost` | 前端访问地址，影响 CORS 和邀请链接 |
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
docker compose logs -f          # 实时查看所有日志
docker compose logs backend     # 只看后端
docker compose logs frontend    # 只看前端
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
2. **复制新证书**：`cp -L /etc/letsencrypt/live/新域名/*.pem /opt/pet/certs/`
3. **修改 docker-compose.yml**：`FRONTEND_URL` 改为新域名

然后 `docker compose up -d` 重启。

---

## 常见问题

### Q: 前端容器一直重启？

```bash
docker logs class-pet-frontend --tail 20
```

常见原因：`/opt/pet/certs/` 下的证书文件损坏或格式错误。重新复制证书即可：

```bash
cp -L /etc/letsencrypt/live/your-domain.com/fullchain.pem /opt/pet/certs/
cp -L /etc/letsencrypt/live/your-domain.com/privkey.pem /opt/pet/certs/
docker restart class-pet-frontend
```

### Q: 页面打开了但 API 报 500 错误？

```bash
docker logs class-pet-backend --tail 30
```

常见原因：数据库未初始化。删除数据库文件让容器重新初始化：

```bash
rm -f /opt/pet/data/database.sqlite
docker compose restart backend
```

### Q: 端口被占用？

```bash
# 查看谁占用了 80 端口
lsof -i :80

# 修改 docker-compose.yml 中的端口映射，比如改成 8080:80
```

### Q: 如何重置所有数据？

```bash
docker compose down
rm -rf /opt/pet/data
docker compose up -d
```

---

## 镜像地址

| 服务 | 镜像 |
|------|------|
| 后端 | `registry.cn-hangzhou.aliyuncs.com/myfdocker/pet-backend:latest` |
| 前端 | `registry.cn-hangzhou.aliyuncs.com/myfdocker/pet-frontend:latest` |
