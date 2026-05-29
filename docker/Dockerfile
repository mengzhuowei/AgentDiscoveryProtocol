# Stage 1: Install dependencies
ARG ALPINE_MIRROR=docker.io/library/node
ARG NPM_MIRROR=https://registry.npmjs.org

FROM ${ALPINE_MIRROR}:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm config set registry ${NPM_MIRROR} && npm install

COPY . .
RUN npm run build

# Stage 2: Runtime image
FROM ${ALPINE_MIRROR}:20-alpine AS runner

WORKDIR /app

RUN apk add --no-cache dumb-init

ENV NODE_ENV=production

COPY package*.json ./
RUN npm config set registry ${NPM_MIRROR} && npm install --only=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/schema.sql ./
COPY --from=builder /app/config.example.json ./
COPY --from=builder /app/mcp-config.example.json ./

# Default: run the Registry service
EXPOSE 3800
EXPOSE 3900

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/start-registry.js"]
