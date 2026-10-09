# Mirqam Points — one image: Express API + the built web console.
# ---- build: install everything, build the SPA ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/ui/package.json packages/ui/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- runtime: API production deps only ----
FROM node:22-alpine
ENV NODE_ENV=production PORT=4100
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/ui/package.json packages/ui/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev --no-audit --no-fund --workspace @mirqam-points/api && npm cache clean --force
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY --from=build /app/apps/web/dist apps/web/dist
USER node
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:4100/api/health || exit 1
CMD ["node", "apps/api/src/server.js"]
