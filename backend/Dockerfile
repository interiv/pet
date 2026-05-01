FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm install --registry=https://registry.npmmirror.com

FROM node:18-alpine AS production

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
COPY .env ./

EXPOSE 3000

CMD ["npm", "start"]
