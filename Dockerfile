# Universal Data Donor frontend: builds the React SPA, then serves the static
# bundle from an unprivileged Caddy on :8080. The host's Caddy reverse-proxies
# /datadonation/* here (prefix stripped) and adds the security headers + IP
# allow-list, so this container only has to serve files.
#
#   docker compose up -d --build        # from the repo root, with the API

# ---- build ----
FROM node:20.18.1-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY public ./public
COPY src ./src
# CI=true turns lint warnings into errors (as in GitHub Actions). Source maps
# are not shipped: participants never need them and they expose the source tree.
ENV CI=true GENERATE_SOURCEMAP=false
RUN npm run build

# ---- serve ----
FROM caddy:2.8.4-alpine
# The stock binary carries cap_net_bind_service as a file capability; with
# cap_drop ALL + no-new-privileges the kernel refuses to exec it. We listen
# on 8080, so drop it.
RUN setcap -r /usr/bin/caddy
COPY deploy/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/build /srv

# Read-only root fs at runtime: Caddy's config/data dirs go to the /tmp tmpfs.
ENV XDG_CONFIG_HOME=/tmp/caddy-config XDG_DATA_HOME=/tmp/caddy-data
USER 10001
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
