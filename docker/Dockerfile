# Stage 1: Install dependencies
ARG ALPINE_MIRROR
FROM ${ALPINE_MIRROR:-node}:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm config set registry ${NPM_MIRROR:-https://registry.npmjs.org} && \
    npm ci

COPY . .
RUN npm run build

# Stage 2: Runtime image
FROM ${ALPINE_MIRROR:-node}:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm config set registry ${NPM_MIRROR:-https://registry.npmjs.org} && \
    npm ci --only=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/schema.sql ./
COPY --from=builder /app/config.example.json ./
COPY --from=builder /app/mcp-config.example.json ./

EXPOSE 3800
EXPOSE 3900

ENTRYPOINT ["dumb-init", "--", "node", "dist/start-registry.js"]