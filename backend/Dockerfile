# Levantate Bridge backend — Node API + agent (Arc / Circle / Supabase / World ID)
# Build context: backend/ (Northflank: set repository subdirectory to /backend)

FROM node:22-bookworm-slim AS base

WORKDIR /app

ENV NODE_ENV=production

# Install deps first for layer caching
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Application source (server, agent, ABI, relayer)
COPY abi ./abi
COPY src ./src
COPY tsconfig.json ./

# Platforms (Render, Northflank, etc.) inject PORT at runtime
EXPOSE 3001

CMD ["npm", "start"]
