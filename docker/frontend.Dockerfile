# syntax=docker/dockerfile:1
FROM node:24.18.0-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .
RUN npm run build

FROM nginx:1.28.3-alpine-slim AS runtime

# The official nginx image pins nginx=<exact-release> in /etc/apk/world, so a plain
# `apk upgrade` silently leaves it at the release baked into the base image even when
# a patched release of the same version (e.g. 1.28.3-r1 -> 1.28.3-r4) is available.
RUN sed -i '/^nginx=/s/=.*$//' /etc/apk/world && apk upgrade --no-cache \
    && mkdir -p /run/nginx

# Alpine nginx includes conf.d/*.conf at the top level and http.d/*.conf inside
# the http{} block, so a `server {}` config must go in http.d — the Debian conf.d
# path lands outside http{} and crashes with "server directive is not allowed here".
COPY nginx.conf /etc/nginx/http.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
