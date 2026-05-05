FROM docker.m.daocloud.io/library/node:25.9-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./

RUN npm ci --registry=https://registry.npmmirror.com || npm install --registry=https://registry.npmmirror.com

COPY frontend/ .

RUN npm run build

FROM docker.m.daocloud.io/library/node:25.9-slim AS backend-builder

WORKDIR /app

COPY backend/package*.json ./

RUN npm ci --registry=https://registry.npmmirror.com || npm install --registry=https://registry.npmmirror.com

FROM docker.m.daocloud.io/library/node:25.9-slim AS production

WORKDIR /app

COPY --from=backend-builder /app/node_modules ./node_modules
COPY backend/package*.json ./
COPY backend/src ./src
COPY backend/scripts ./scripts
COPY --from=frontend-builder /app/frontend/dist ./public

# 复制图片文件到正确的位置，同时满足两种静态文件服务路径
COPY frontend/public/images ./public/images
COPY frontend/public/images ./frontend/public/images

RUN mkdir -p /app/data

COPY backend/.env* ./
COPY backend/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/docker-entrypoint.sh"]
