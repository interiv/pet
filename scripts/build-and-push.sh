#!/bin/bash
set -e

# ============================================
#  班级宠物养成系统 - 发布到阿里云镜像仓库
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
echo -e "${CYAN}   班级宠物养成系统 - 发布到阿里云镜像仓库${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""

# ---- 配置 ----
ALIYUN_REGISTRY="registry.cn-hangzhou.aliyuncs.com"
ALIYUN_NAMESPACE="myfdocker"
IMAGE_NAME="pet"
FULL_IMAGE="${ALIYUN_REGISTRY}/${ALIYUN_NAMESPACE}/${IMAGE_NAME}"

read -p "请输入镜像版本标签 (如: v1.0.0, latest): " IMAGE_TAG
IMAGE_TAG="${IMAGE_TAG:-latest}"

echo ""
info "配置信息:"
echo "  镜像地址: ${FULL_IMAGE}:${IMAGE_TAG}"
echo ""

read -p "确认开始构建并发布？(y/n) " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  info "已取消发布"
  exit 0
fi

# ---- 登录阿里云镜像仓库 ----
echo ""
info "1/5: 登录阿里云镜像仓库..."
echo ""
echo -e "${YELLOW}请使用以下命令登录：${NC}"
echo "  docker login --username=77504839@qq.com ${ALIYUN_REGISTRY}"
echo ""
read -p "已完成登录？(y/n) " LOGIN_CONFIRM
if [ "$LOGIN_CONFIRM" != "y" ] && [ "$LOGIN_CONFIRM" != "Y" ]; then
  err "请先完成登录后再继续"
  exit 1
fi

# ---- 构建 Docker 镜像 ----
echo ""
info "2/5: 构建 Docker 镜像..."

if docker build -t ${FULL_IMAGE}:${IMAGE_TAG} .; then
  log "镜像构建成功: ${FULL_IMAGE}:${IMAGE_TAG}"
else
  err "镜像构建失败"
  exit 1
fi

# ---- 打标签 ----
echo ""
info "3/5: 为镜像打标签..."

if docker tag ${FULL_IMAGE}:${IMAGE_TAG} ${FULL_IMAGE}:latest 2>/dev/null; then
  log "已添加 latest 标签"
else
  warn "添加 latest 标签失败（可能已是 latest）"
fi

# ---- 推送到阿里云 ----
echo ""
info "4/5: 推送镜像到阿里云镜像仓库..."

echo ""
echo -e "${CYAN}正在推送 ${FULL_IMAGE}:${IMAGE_TAG} ...${NC}"
if docker push ${FULL_IMAGE}:${IMAGE_TAG}; then
  log "推送成功: ${FULL_IMAGE}:${IMAGE_TAG}"
else
  err "推送失败"
  exit 1
fi

echo ""
echo -e "${CYAN}正在推送 ${FULL_IMAGE}:latest ...${NC}"
if docker push ${FULL_IMAGE}:latest; then
  log "推送成功: ${FULL_IMAGE}:latest"
else
  warn "推送 latest 失败（可能不是必需）"
fi

# ---- 完成 ----
echo ""
echo -e "${CYAN}============================================${NC}"
echo -e "${GREEN}   发布完成！${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""
info "镜像信息:"
echo "  ${FULL_IMAGE}:${IMAGE_TAG}"
echo "  ${FULL_IMAGE}:latest"
echo ""
info "在其他机器上使用时，执行以下命令拉取:"
echo "  docker pull ${FULL_IMAGE}:${IMAGE_TAG}"
echo ""
info "或者使用 docker-compose 部署:"
echo "  image: ${FULL_IMAGE}:${IMAGE_TAG}"
echo ""


#如下手工自用
if(false)
then
# 0. 登录阿里云镜像仓库
docker login --username=77504839@qq.com registry.cn-hangzhou.aliyuncs.com

# 1. 先拉取原来的 latest（如果本地没有）
docker pull registry.cn-hangzhou.aliyuncs.com/myfdocker/pet:latest

# 2. 给旧版本打标签为 1.0
docker tag registry.cn-hangzhou.aliyuncs.com/myfdocker/pet:latest registry.cn-hangzhou.aliyuncs.com/myfdocker/pet:1.0

# 3. 推送 1.0 标签
docker push registry.cn-hangzhou.aliyuncs.com/myfdocker/pet:1.0

# 4. 构建新版本为 1.1
docker build -t registry.cn-hangzhou.aliyuncs.com/myfdocker/pet:1.1 .

# 5. 推送 1.1
docker push registry.cn-hangzhou.aliyuncs.com/myfdocker/pet:1.1

# 6. (可选) latest 也更新为 1.1
docker tag registry.cn-hangzhou.aliyuncs.com/myfdocker/pet:1.1 registry.cn-hangzhou.aliyuncs.com/myfdocker/pet:latest
docker push registry.cn-hangzhou.aliyuncs.com/myfdocker/pet:latest


#7 服务端拉取新image和重启容器
docker compose pull
docker compose up -d
fi
