# ---------- build client ----------
FROM node:22-alpine AS build-client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---------- build server ----------
FROM node:22-alpine AS build-server
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# ---------- runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app/server
ENV NODE_ENV=production

# prod deps
COPY server/package*.json ./
RUN npm ci --omit=dev

# compiled server
COPY --from=build-server /app/server/dist ./dist

# client build (server буде віддавати статично)
COPY --from=build-client /app/client/dist /app/client/dist

EXPOSE 4666
CMD ["node", "dist/index.js"]
