# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Accept the backend URL as a build-time argument so it gets baked into the
# Vite bundle.  At runtime the browser will connect to this URL.
ARG VITE_WS_BACKEND_URL=ws://localhost:3001
ENV VITE_WS_BACKEND_URL=${VITE_WS_BACKEND_URL}

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Runtime stage (nginx) ─────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

COPY --from=builder /app/dist /usr/share/nginx/html

# Single-page app: route all requests to index.html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
