# Multi-stage production build for Fastify backend
FROM node:22-alpine AS builder

WORKDIR /app

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

# Copy monorepo configuration and source
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

# Copy root virtual store (.pnpm) and backend package symlinks
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/node_modules ./backend/node_modules
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/package.json ./backend/package.json
COPY --from=builder /app/database ./database

# Run from the backend directory so Node finds backend/node_modules/@fastify/cors
WORKDIR /app/backend

EXPOSE 4000

# Start server
CMD ["node", "dist/main.js"]
