# Leash agent server (mcp/). Build from the repo root: docker build .
# Copies only what the server needs; the agent key and token come from the host's secrets, never from a file.
FROM oven/bun:1.4.0-slim

WORKDIR /srv
# The contract ABI compiled and tested in Arc Studio.
COPY app/contracts/out/Leash.sol/Leash.json app/contracts/out/Leash.sol/Leash.json
COPY mcp/package.json mcp/bun.lock mcp/
RUN cd mcp && bun install --frozen-lockfile --production
COPY mcp/src mcp/src
COPY mcp/payees.json mcp/payees.json

WORKDIR /srv/mcp
ENV MCP_HOST=0.0.0.0 MCP_PORT=8787
EXPOSE 8787
CMD ["bun", "run", "src/server.ts"]
