# ==> Stage 1: Build Stage <==
# Use a Node.js image that includes build tools.
FROM node:20-bullseye-slim AS builder

# Set the working directory inside the container
WORKDIR /app

# Install git and openssl, which are dependencies for Baileys
RUN apt-get update && apt-get install -y openssl git && rm -rf /var/lib/apt/lists/*

# Copy package files and install ALL dependencies (including devDependencies)
COPY package*.json ./
RUN npm ci

# Copy the rest of the application source code
COPY . .

# Generate Prisma Client (this is where the client is created)
RUN npx prisma generate

# Build the TypeScript project
RUN npm run build


# ==> Stage 2: Production Stage <==
# Start from a clean, lightweight Node.js image
FROM node:20-bullseye-slim

# Set the working directory
WORKDIR /app

# Install openssl for runtime
RUN apt-get update && apt-get install -y openssl git && rm -rf /var/lib/apt/lists/*

# Copy package files and install ONLY production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the compiled code from the builder stage
COPY --from=builder /app/dist ./dist

# **THE FIX**: Copy the generated Prisma Client from the builder stage
# This ensures the client is available in the final image without needing devDependencies.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Expose the port the application will run on
EXPOSE 3000

# The command to run the application
CMD ["npm", "run", "start"]
