# syntax=docker/dockerfile:1
FROM node:22-alpine

WORKDIR /app

ENV CI=true

COPY package.json package-lock.json ./
RUN npm install --no-fund --no-audit

COPY . .

CMD ["npm", "run", "test:run", "--", "--reporter=verbose"]
