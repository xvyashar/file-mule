FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

FROM node:24-bookworm-slim AS production

RUN apt-get update && apt-get install -y gnupg

# enable non-free repo
RUN echo "deb http://deb.debian.org/debian bookworm main contrib non-free non-free-firmware" > /etc/apt/sources.list

RUN apt-get update && \
  apt-get install -y rar && \
  rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

COPY drizzle.config.ts ./
COPY config.yaml ./

RUN mkdir -p /app/downloads /app/compressed

CMD ["node", "dist/bot.js"]