# The arming screen, as an image, beside the fork and the MCP server in compose.yaml. T-B21.
#
# Its own file rather than a second stage in the root Dockerfile, which belongs to the MCP server
# and to T-E03. Same base and the same install and build, then Next builds the app on top.
# Built from the repo root: `docker build -f apps/web/Dockerfile .`

FROM node:22-alpine

RUN apk add --no-cache tini

WORKDIR /app

ENV CI=true
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter @agon/web build

# No key in the image, and nothing here signs: the page hands the user's own wallet bytes to sign.
# AGON_NETWORK and AGON_RPC_URL are read per request, so compose sets them at run time.
ENV HOSTNAME=0.0.0.0
EXPOSE 3111

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "--filter", "@agon/web", "start"]
