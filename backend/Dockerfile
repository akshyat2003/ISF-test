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

# Generate clean production package.json without devDependencies or workspace:* references
RUN node -e "const fs = require('fs'); \
    const pkg = JSON.parse(fs.readFileSync('backend/package.json', 'utf8')); \
    delete pkg.devDependencies; \
    delete pkg.dependencies['@sj/contracts']; \
    fs.writeFileSync('backend/dist/package.json', JSON.stringify(pkg, null, 2));"

# Production runner stage
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV BYPASS_LAUNCH_GATE=true

# Copy compiled backend bundle, production package.json, and migrations
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/dist/package.json ./package.json
COPY --from=builder /app/database ./database

# Install clean production dependencies via standard npm (flat, non-symlink node_modules)
RUN npm install --omit=dev --no-audit --no-fund

EXPOSE 4000

# Start server
CMD ["node", "dist/main.js"]
