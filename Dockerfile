FROM node:24.21.0-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY tsconfig.json tsconfig.eslint.json jest.config.ts ./
COPY src ./src
COPY load ./load
RUN npm run build

FROM node:24.21.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:3000/health >/dev/null || exit 1
CMD ["node", "dist/src/server.js"]
