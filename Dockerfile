FROM node:18.16-alpine3.18 AS build
WORKDIR /app
COPY . .
RUN npm ci && npm run build

FROM node:18.16-alpine3.18 AS prod
WORKDIR /app
COPY package*.json .
RUN npm install --omit=dev && npm install -g pm2
COPY --from=build /app/dist/ ./dist/
EXPOSE 3000
ENTRYPOINT ["pm2-runtime", "dist/index.js"]