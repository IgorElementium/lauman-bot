FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci

# Copy source
COPY src ./src
COPY tsconfig.json .

# Build TypeScript
RUN npm run build

# Copy schema.sql to dist
COPY src/db/schema.sql dist/db/

# Run the bot
CMD ["npm", "start"]
