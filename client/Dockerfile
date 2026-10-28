# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install -g npm@latest && npm install --legacy-peer-deps

COPY . .
RUN node node_modules/@angular/cli/bin/ng.js build --configuration production

# ── Stage 2: Serve ────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine

# Remove default Nginx site and replace with ours
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy compiled Angular app from builder
COPY --from=builder /app/dist/client/browser /usr/share/nginx/html

EXPOSE 80
