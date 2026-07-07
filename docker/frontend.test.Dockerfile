# syntax=docker/dockerfile:1
FROM node:26-alpine

WORKDIR /app

ENV CI=true

COPY package.json package-lock.json ./
RUN npm install --no-fund --no-audit

COPY . .
RUN npm run panda:generate

CMD ["npm", "run", "test:run", "--", "--reporter=verbose"]
