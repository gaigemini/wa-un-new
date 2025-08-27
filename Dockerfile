# Use Debian-based Node.js image to avoid musl issues
FROM node:20-bullseye AS builder

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y openssl git && rm -rf /var/lib/apt/lists/*

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install --quiet

# Copy the rest of the code
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Expose port 3000
EXPOSE 3000

# Start the application
CMD ["npm", "run", "dev"]
