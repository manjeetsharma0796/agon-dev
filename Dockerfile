# The MCP server, as an image, so the agent-facing endpoint can live somewhere that is not
# somebody's laptop.
#
# This exists because a tunnel is not hosting. The first demo link was a laptop tunnel and it
# dropped twice inside an hour, both times leaving the client with a gateway timeout and no way to
# tell a dead tunnel from a broken server. Anything an outside agent is pointed at has to outlive
# the machine that built it.
#
# One stage on purpose. A builder-plus-runtime split would save perhaps 150 MB, and this image is
# built rarely and run continuously, so the saving buys nothing worth the second place for the
# build to drift out of step with the real one.

FROM node:22-alpine

# git, because the net wrapper stamps recordings and some tooling reads the repo. tini, so the
# process reaps children and stops on SIGTERM rather than being killed after the host's grace
# period, which is what turns a deploy into 30 seconds of refused connections.
RUN apk add --no-cache git tini

WORKDIR /app

ENV CI=true
RUN corepack enable

# The lockfile and every manifest first, so a change to source does not invalidate the install
# layer. Copying package.json one path at a time would need editing whenever a package is added,
# so the whole tree comes in and the install is still cached on the lockfile's hash.
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm build

# Replay by default, and no key in the image. The server answers from the committed recordings, so
# it starts with nothing to leak and nothing to rotate. Set AGON_NET_MODE=live and HELIUS_API_KEY
# at the host to read wallets that have no recording, and only behind something that authenticates,
# because every caller then spends that key's quota.
ENV AGON_NET_MODE=replay
# 0.0.0.0 rather than the loopback default: nothing outside the container can reach 127.0.0.1.
ENV HOST=0.0.0.0
ENV PORT=8787
EXPOSE 8787

# The health path the server already serves, so a host that health-checks gets a real answer
# instead of a protocol error from POSTing to an MCP endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "packages/mcp/dist/serve.js"]
