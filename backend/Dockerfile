FROM docker.m.daocloud.io/library/node:25.9-slim AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci --registry=https://registry.npmmirror.com || npm install --registry=https://registry.npmmirror.com

FROM docker.m.daocloud.io/library/node:25.9-slim AS production

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src

RUN mkdir -p /app/data

COPY .env* ./

EXPOSE 3000

CMD ["npm", "start"]
