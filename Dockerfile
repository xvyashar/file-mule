FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

ARG DB_FILE_NAME
ENV DB_FILE_NAME=${DB_FILE_NAME}

RUN npm run build

FROM node:24-alpine AS production

RUN apk add --no-cache 7zip

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

COPY drizzle.config.ts ./

RUN mkdir -p /app/downloads /app/compressed

CMD ["node", "dist/bot.js"]