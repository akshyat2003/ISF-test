# Multi-stage production build for Fastify backend
FROM node:22-alpine AS builder

WORKDIR /app

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

# Copy monorepo configuration
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/ ./packages/
COPY backend/ ./backend/
COPY database/ ./database/

# Install dependencies and build backend
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @sj/api build

# Production runner stage
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Copy compiled backend bundle and migrations
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/package.json ./package.json
COPY --from=builder /app/database ./database

# Install only production dependencies needed at runtime (if any)
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate && \
    pnpm install --prod --ignore-scripts

EXPOSE 4000

# Start server
CMD ["node", "dist/main.js"]
