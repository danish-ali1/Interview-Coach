# Debian-based "slim" image on purpose: PDF parsing (pdfjs-dist) was tested on glibc Linux, and
# pdfjs-dist has optional native dependencies that are not guaranteed to resolve on Alpine (musl).
# ---- dependencies (production only) ----
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime ----
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# Run as the unprivileged user that ships with the node image.
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
