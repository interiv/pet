# Docker 部署指南

## 前置要求
- 安装 Docker 和 Docker Compose

## 快速开始

### 1. 复制环境变量配置
```bash
cp backend/.env.example .env
```

### 2. 编辑 .env 文件（可选）
根据需要修改环境变量，特别是 `AI_API_KEY`。

### 3. 构建并启动服务
```bash
docker-compose up -d --build
```

### 4. 访问应用
- 前端: http://localhost
- 后端 API: http://localhost:3000

## 常用命令

### 查看服务状态
```bash
docker-compose ps
```

### 查看日志
```bash
docker-compose logs -f
```

### 停止服务
```bash
docker-compose stop
```

### 启动服务
```bash
docker-compose start
```

### 删除服务（保留数据）
```bash
docker-compose down
```

### 删除服务和数据
```bash
docker-compose down -v
```

## 数据持久化
- 数据库文件存储在 `backend/data/` 目录
- 即使容器删除，数据也会保留
