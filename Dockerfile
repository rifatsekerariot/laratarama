# ---- Build stage ----
FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# ---- Production stage ----
FROM node:18-alpine

# node user/group already exist in node:18-alpine

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Log directory writable by node (for winston file logs)
RUN mkdir -p /app/logs && chown -R node:node /app
ENV LOG_DIR=/app/logs

USER node

EXPOSE 3000

CMD ["node", "server.js"]
