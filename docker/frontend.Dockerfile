# syntax=docker/dockerfile:1
FROM node:24.18.0-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .
RUN npm run build

FROM nginx:1.31.2-alpine-slim AS runtime

# The official nginx image pins nginx=<exact-release> in /etc/apk/world, so a plain
# `apk upgrade` silently leaves it at the release baked into the base image even when
# a patched release of the same version (e.g. 1.28.3-r1 -> 1.28.3-r4) is available.
RUN sed -i '/^nginx=/s/=.*$//' /etc/apk/world && apk upgrade --no-cache

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
