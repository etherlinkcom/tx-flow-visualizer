# ── Build stage ───────────────────────────────────────────────────────────────
# Compiles both the React frontend (Vite) and the Node.js server (TypeScript)
# in a single stage so that all build tools share one node_modules install.
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Build the React frontend into dist/
RUN npm run build

# Compile the TypeScript server into server-dist/
RUN npm run build:server

# ── Production stage ──────────────────────────────────────────────────────────
# Lean runtime image: only production dependencies + compiled artifacts.
FROM node:20-alpine AS runtime

WORKDIR /app

# Copy manifests and install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Compiled frontend assets
COPY --from=builder /app/dist ./dist

# Compiled server
COPY --from=builder /app/server-dist ./server-dist

# Cloud Run expects the container to listen on PORT (default 8080)
ENV PORT=8080
EXPOSE 8080

# Non-root user for defence-in-depth
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

CMD ["node", "server-dist/index.js"]
