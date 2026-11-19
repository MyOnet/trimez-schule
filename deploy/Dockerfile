# Testserver in einem einzigen Container: PostgreSQL und trimez. Schule zusammen.
# Für Tests (z. B. Render, Gratis-Stufe): Die Daten werden bei jedem Start neu angelegt (Testschule «seeufer»).
# Nicht für echte Schulen: dafür eine eigene Datenbank mit Sicherungen (siehe docs/01-architektur.md).

FROM node:22-bookworm-slim AS bau
WORKDIR /app
RUN npm install -g pnpm@10.28.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY apps/api apps/api
COPY apps/web apps/web
COPY packages packages
RUN pnpm --filter @schule/web build

FROM postgres:16-bookworm
COPY --from=bau /usr/local/bin/node /usr/local/bin/node
COPY --from=bau /app /app
COPY deploy/start.sh /start.sh
RUN chmod +x /start.sh && mkdir -p /app/daten && chown -R postgres:postgres /app/daten
WORKDIR /app
ENV NODE_ENV=test PGDATA=/var/lib/postgresql/data
EXPOSE 10000
CMD ["/start.sh"]
