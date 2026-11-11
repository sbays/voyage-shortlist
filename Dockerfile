# Two images from one file:
#   --target=runtime  the Next.js standalone server for Cloud Run (the default,
#                     because it is the last stage)
#   --target=db       the voyage-db Cloud Run job: `migrate` or `seed`
# Node 24 is the current LTS and still bundles Corepack, which provides the
# pnpm version pinned in package.json's "packageManager" field.

FROM node:24-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# Production dependencies only (pg, zod and friends) for the db job.
FROM base AS db-deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

# Runs TypeScript directly through Node 24's built-in type stripping, so it
# needs no build step: only src/db (migrations, seed, CLI) and src/domain.
FROM node:24-slim AS db
WORKDIR /app
ENV NODE_ENV=production
COPY --from=db-deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src/db ./src/db
COPY --chown=node:node src/domain ./src/domain
USER node
ENTRYPOINT ["node", "src/db/cli.ts"]

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=8080
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 8080
CMD ["node", "server.js"]
