# 在 Linux 中安装 sharp 的对应依赖，不复制 Windows node_modules。
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/server/package.json ./packages/server/package.json
COPY packages/web/package.json ./packages/web/package.json
RUN npm ci --include=dev --cache /tmp/npm-cache
COPY packages/shared/src ./packages/shared/src
COPY packages/shared/tsconfig.json ./packages/shared/tsconfig.json
COPY packages/server/src ./packages/server/src
COPY packages/server/tsconfig.json ./packages/server/tsconfig.json
COPY packages/web/src ./packages/web/src
COPY packages/web/public ./packages/web/public
COPY config/app-release.json ./config/app-release.json
COPY packages/web/index.html packages/web/vite.config.ts packages/web/tsconfig.json ./packages/web/
RUN npm run build && npm prune --omit=dev --cache /tmp/npm-cache

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=9000 APP_PUBLIC_MODE=true QUOTA_STORE=oss
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /app/packages/server/package.json ./packages/server/package.json
COPY --from=build --chown=node:node /app/packages/server/dist ./packages/server/dist
COPY --from=build --chown=node:node /app/packages/web/package.json ./packages/web/package.json
COPY --from=build --chown=node:node /app/packages/web/dist ./packages/web/dist
COPY --chown=node:node scripts/start.mjs ./scripts/start.mjs
USER node
EXPOSE 9000
CMD ["node", "scripts/start.mjs"]
