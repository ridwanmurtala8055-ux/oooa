FROM node:18

WORKDIR /workspaces/oooo

# Install pnpm
RUN npm install -g pnpm@8

# Copy package manifests first for dependency install layer
COPY package.json package-lock.json ./

# Install workspace dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# Copy full repo
COPY . .

ENV NODE_ENV=development

# Default command (docker-compose overrides this per-service)
CMD ["pnpm", "run", "start:api"]
