FROM node:20-alpine
RUN apk add --no-cache openssl python3 make g++ && npm install -g pnpm@12
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/
RUN pnpm install --filter server --frozen-lockfile

COPY server server
WORKDIR /app/server
RUN npx prisma generate && pnpm build

EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]