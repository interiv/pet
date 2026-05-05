#!/bin/bash
set -e

# ============================================
#  班级宠物养成系统 - 一键部署脚本
# ============================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; }
info() { echo -e "${CYAN}[>]${NC} $1"; }

echo ""
echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}   班级宠物养成系统 - 一键部署脚本${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""

# ---- 检查 root ----
if [ "$(id -u)" != "0" ]; then
  err "请使用 root 用户运行此脚本"
  exit 1
fi

# ---- 收集信息 ----
echo -e "${YELLOW}请输入以下配置信息（直接回车跳过可选项）：${NC}"
echo ""

read -p "  域名（如 zym.uwper.cn，没有则使用 IP 访问，跳过 HTTPS）: " DOMAIN
echo -e "  ${CYAN}豆包大模型 API Key（可选，不填则作业生成/AI批改不可用，之后可在管理后台补填）${NC}"
read -p "  AI API Key: " AI_API_KEY
read -p "  JWT 密钥（回车自动生成随机密钥）: " JWT_SECRET
read -p "  部署端口（默认 3000）: " PORT

DOMAIN="${DOMAIN:-}"
PORT="${PORT:-3000}"

if [ -z "$JWT_SECRET" ]; then
  JWT_SECRET=$(cat /dev/urandom | tr -dc 'a-zA-Z0-9' | head -c 32)
  log "已生成随机 JWT 密钥: ${JWT_SECRET}"
fi

if [ -z "$AI_API_KEY" ]; then
  warn "未设置 AI_API_KEY，作业生成和 AI 批改功能暂不可用（之后可在管理后台设置）"
fi

echo ""
echo -e "${CYAN}配置确认：${NC}"
echo "  域名:      ${DOMAIN:-无（使用 IP 访问）}"
echo "  AI Key:    ${AI_API_KEY:-未设置}"
echo "  端口:      ${PORT}"
echo "  JWT 密钥:  ${JWT_SECRET}"
echo ""

read -p "确认开始部署？(y/n) " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  info "已取消部署"
  exit 0
fi

# ---- 安装/检查 Docker ----
echo ""
info "检查 Docker..."

if ! command -v docker &> /dev/null; then
  warn "Docker 未安装，正在使用国内镜像源安装..."
  
  # 检测操作系统
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    
    case "$ID" in
      ubuntu|debian)
        info "检测到 Debian/Ubuntu 系统，使用阿里云镜像源安装 Docker..."
        
        # 更新包管理器（使用阿里云镜像）
        apt update -qq
        
        # 安装依赖
        apt install -y -qq apt-transport-https ca-certificates curl gnupg lsb-release
        
        # 添加 Docker 官方 GPG 密钥（使用阿里云镜像）
        mkdir -p /etc/apt/keyrings
        curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null || \
        curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
        
        # 添加 Docker 仓库（使用阿里云镜像）
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://mirrors.aliyun.com/docker-ce/linux/$(. /etc/os-release && echo "$ID") $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
        
        # 更新包索引
        apt update -qq
        
        # 安装 Docker
        apt install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
        ;;
        
      centos|rhel|fedora)
        info "检测到 RHEL/CentOS 系统，使用阿里云镜像源安装 Docker..."
        
        # 安装依赖
        yum install -y -q yum-utils
        
        # 添加 Docker 仓库（使用阿里云镜像）
        yum-config-manager --add-repo https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo
        
        # 安装 Docker
        yum install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin
        ;;
        
      *)
        warn "未识别的系统，尝试使用官方脚本安装（使用国内镜像加速）..."
        curl -fsSL https://get.docker.com | bash -s docker --mirror Aliyun
        ;;
    esac
  else
    warn "无法检测系统类型，使用官方脚本安装..."
    curl -fsSL https://get.docker.com | bash -s docker --mirror Aliyun
  fi
  
  log "Docker 安装完成"
else
  log "Docker 已安装: $(docker --version)"
fi

if ! docker info &> /dev/null; then
  warn "Docker 未运行，正在启动..."
  systemctl enable docker
  systemctl start docker
  
  # 等待 Docker 完全启动
  info "等待 Docker 服务启动..."
  for i in $(seq 1 30); do
    if docker info &> /dev/null; then
      break
    fi
    sleep 1
  done
fi

if docker info &> /dev/null; then
  log "Docker 运行正常"
else
  err "Docker 启动失败，请手动检查"
  exit 1
fi

# ---- 创建部署目录 ----
DEPLOY_DIR="/opt/pet"
info "创建部署目录: ${DEPLOY_DIR}"
mkdir -p "${DEPLOY_DIR}/data"
cd "${DEPLOY_DIR}"

# ---- 创建 .env ----
log "创建 .env 配置文件..."
cat > .env << EOF
AI_API_KEY=${AI_API_KEY}
JWT_SECRET=${JWT_SECRET}
EOF

# ---- 创建 docker-compose.yml ----
log "创建 docker-compose.yml..."
FRONTEND_URL="http://localhost:${PORT}"
if [ -n "$DOMAIN" ]; then
  FRONTEND_URL="https://${DOMAIN}"
fi

cat > docker-compose.yml << EOF
services:
  pet:
    image: registry.cn-hangzhou.aliyuncs.com/myfdocker/pet:latest
    container_name: class-pet
    restart: unless-stopped
    ports:
      - "127.0.0.1:${PORT}:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - JWT_SECRET=${JWT_SECRET}
      - JWT_EXPIRES_IN=7d
      - FRONTEND_URL=${FRONTEND_URL}
      - AI_API_KEY=${AI_API_KEY}
      - AI_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
      - AI_MODEL=doubao-seed-2-0-pro-260215
    volumes:
      - ./data:/app/data
EOF

# ---- 拉取镜像并启动 ----
info "拉取镜像..."
docker compose pull

info "启动容器..."
docker compose up -d

# 等待启动
sleep 3

# 检查状态
if docker compose ps | grep -q "Up"; then
  log "容器启动成功！"
else
  err "容器启动失败，查看日志："
  docker compose logs --tail 20
  exit 1
fi

# ---- 显示初始化日志 ----
echo ""
info "数据库初始化日志："
docker compose logs --tail 15
echo ""

# ---- HTTPS 配置 ----
if [ -n "$DOMAIN" ]; then
  echo ""
  read -p "是否配置 HTTPS？(y/n) " SETUP_HTTPS

  if [ "$SETUP_HTTPS" = "y" ] || [ "$SETUP_HTTPS" = "Y" ]; then
    info "检查 Nginx 和 Certbot..."

    # 先停止容器，释放端口（支持二次执行）
    if docker ps | grep -q "class-pet"; then
      warn "检测到运行中的容器，正在停止以释放端口..."
      docker compose stop
      log "容器已停止"
    fi

    # 停止可能占用 80 端口的 Nginx
    if systemctl is-active --quiet nginx; then
      info "暂时停止 Nginx 以释放 80 端口..."
      systemctl stop nginx
    fi

    if ! command -v nginx &> /dev/null; then
      warn "Nginx 未安装，正在安装..."
      apt update -qq && apt install -y -qq nginx
      log "Nginx 安装完成"
    else
      log "Nginx 已安装: $(nginx -v 2>&1)"
    fi

    if ! command -v certbot &> /dev/null; then
      warn "Certbot 未安装，正在安装..."
      apt install -y -qq certbot
      log "Certbot 安装完成"
    else
      log "Certbot 已安装: $(certbot --version 2>&1 | head -1)"
    fi

    if ! systemctl is-active --quiet nginx; then
      warn "Nginx 未运行，正在启动..."
      systemctl enable nginx
      systemctl start nginx
    fi
    log "Nginx 运行正常"

    info "申请 SSL 证书（需要 80 端口可用）..."
    
    # 确保 80 端口空闲
    systemctl stop nginx 2>/dev/null || true
    sleep 2
    
    # 检查 80 端口是否被占用
    if ss -tlnp | grep -q ':80 '; then
      err "80 端口仍被占用，请手动关闭占用 80 端口的程序"
      ss -tlnp | grep ':80 '
      exit 1
    fi
    
    certbot certonly --standalone -d "${DOMAIN}" --agree-tos --email admin@${DOMAIN} --non-interactive || {
      warn "自动申请失败，请手动执行: certbot certonly --standalone -d ${DOMAIN}"
    }

    info "配置 Nginx 反向代理..."
    cat > /etc/nginx/sites-available/pet << NGINX_EOF
server {
    listen 80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name ${DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }

    location /socket.io {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
}
NGINX_EOF

    ln -sf /etc/nginx/sites-available/pet /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default
    nginx -t && systemctl reload nginx

    # 更新 FRONTEND_URL
    sed -i "s|FRONTEND_URL=.*|FRONTEND_URL=https://${DOMAIN}|" docker-compose.yml
    docker compose up -d

    # 自动续期
    (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet && systemctl reload nginx") | crontab -

    log "HTTPS 配置完成！"
  fi
fi

# ---- 完成 ----
echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  部署完成！${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""

if [ -n "$DOMAIN" ] && [ "$SETUP_HTTPS" = "y" ] || [ "$SETUP_HTTPS" = "Y" ]; then
  echo -e "  访问地址: ${CYAN}https://${DOMAIN}${NC}"
else
  echo -e "  访问地址: ${CYAN}http://$(curl -s ifconfig.me 2>/dev/null || echo '你的服务器IP'):${PORT}${NC}"
fi

echo ""
echo "  预置账号（密码均为 111111）："
echo "    管理员: admin"
echo "    教师:   teacher1 ~ teacher10"
echo "    学生:   student1 ~ student50"
echo ""
echo "  常用命令："
echo "    查看日志:  docker compose logs -f"
echo "    重启服务:  docker compose restart"
echo "    停止服务:  docker compose down"
echo "    更新镜像:  docker compose pull && docker compose up -d"
echo ""
