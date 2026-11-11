# Stage 1: install everything and build the website and the server.
FROM node:20-alpine AS build
WORKDIR /app
# Dependency files first, so Docker reuses the installed layer when only the code changes.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci
COPY tsconfig.base.json ./
COPY shared shared
COPY client client
COPY server server
RUN npm run build

# Stage 2: the image that runs. Only production dependencies and the two build outputs.
FROM node:20-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    CLIENT_DIST=/app/client/dist
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --omit=dev --workspace=server && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
# The official image ships an unprivileged "node" user; never run as root.
USER node
EXPOSE 3000
# Fails (and so marks the container unhealthy) when the database does not answer.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server/dist/index.js"]
