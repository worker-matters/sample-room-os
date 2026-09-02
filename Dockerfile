FROM node:22-bookworm-slim AS deps

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci

FROM deps AS build

COPY . .

ARG VITE_AUTH_MODE
ARG VITE_ENABLE_DEV_ENTRY
ENV VITE_AUTH_MODE=${VITE_AUTH_MODE}
ENV VITE_ENABLE_DEV_ENTRY=${VITE_ENABLE_DEV_ENTRY}

LABEL com.sample-room.release.auth-mode="${VITE_AUTH_MODE}" \
      com.sample-room.release.dev-entry="${VITE_ENABLE_DEV_ENTRY}"

RUN test "$VITE_AUTH_MODE" = "formal" \
  && test "$VITE_ENABLE_DEV_ENTRY" = "false" \
  && rm -rf apps/web/dist \
  && npm run build \
  && node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('apps/web/dist/release-config.json','utf8'));if(c.authMode!=='formal'||c.devEntryEnabled!==false)process.exit(1)"

FROM build AS prod-deps

RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runner

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3001

LABEL com.sample-room.release.auth-mode="formal" \
      com.sample-room.release.dev-entry="false" \
      com.sample-room.release.persistence-mode="prisma" \
      com.sample-room.release.node-env="production"

COPY --from=prod-deps /app/package.json /app/package-lock.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/package.json ./apps/api/package.json
COPY --from=prod-deps /app/apps/api/dist ./apps/api/dist
COPY --from=prod-deps /app/apps/api/prisma ./apps/api/prisma
COPY --from=prod-deps /app/apps/web/dist ./apps/web/dist
COPY --from=prod-deps /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=prod-deps /app/packages/shared/dist ./packages/shared/dist

EXPOSE 3001

CMD ["npm", "run", "start"]
