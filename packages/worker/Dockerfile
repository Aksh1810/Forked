# Build from the repository root:
#   docker build -f packages/worker/Dockerfile -t forked-worker .
#
# Stockfish is GPLv3 (see /NOTICE inside the image). It is downloaded as the
# pinned official release binary at build time, never vendored into this
# repository, and runs strictly as a separate process over UCI.

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/worker/package.json packages/worker/
RUN npm ci -w packages/worker --include-workspace-root
COPY packages/shared packages/shared
COPY packages/worker packages/worker
RUN npx tsc -b packages/shared packages/worker

FROM node:20-bookworm-slim
# PINNED Stockfish release. The wrapper additionally stamps the version the
# binary itself reports via "id name" into every engine record.
ARG SF_VERSION=sf_18
ARG SF_ASSET=stockfish-ubuntu-x86-64-avx2
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && curl -fsSL -o /tmp/sf.tar "https://github.com/official-stockfish/Stockfish/releases/download/${SF_VERSION}/${SF_ASSET}.tar" \
  && tar -xf /tmp/sf.tar -C /tmp \
  && mv "/tmp/stockfish/${SF_ASSET}" /usr/local/bin/stockfish \
  && chmod +x /usr/local/bin/stockfish \
  && rm -rf /tmp/sf.tar /tmp/stockfish \
  && apt-get purge -y curl \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*
LABEL org.opencontainers.image.title="forked-worker"
LABEL org.opencontainers.image.licenses="MIT AND GPL-3.0-only"
LABEL org.opencontainers.image.description="forked analysis worker; bundles the GPLv3 Stockfish engine as a separate process"
COPY docs/NOTICE /NOTICE
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/worker/dist packages/worker/dist
COPY --from=build /app/packages/worker/package.json packages/worker/
ENV STOCKFISH_PATH=/usr/local/bin/stockfish
# Long-running network consumer: no reason to keep root.
USER node
CMD ["node", "packages/worker/dist/main.js"]
