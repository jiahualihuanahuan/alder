# Alder — production image. `docker compose up --build` serves http://localhost:8070
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .

# Auth stays off: the planner is local-only and has no database in this image.
ARG VITE_AUTH_ENABLED=false
ENV VITE_AUTH_ENABLED=$VITE_AUTH_ENABLED
ENV NITRO_PRESET=node-server
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8070
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=8070

COPY --from=build /app/.output ./.output

EXPOSE 8070
USER node
CMD ["node", ".output/server/index.mjs"]
