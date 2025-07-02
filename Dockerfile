# Use the official Bun image as the base image
FROM oven/bun:1 AS base

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and bun.lockb (if it exists)
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy the rest of the application code
COPY . .

# Create a non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 bunjs

# Change ownership of the app directory to the bunjs user
RUN chown -R bunjs:nodejs /app
USER bunjs

# Set default environment variables (can be overridden at runtime)
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL=""
ENV DAILY_LIMIT=""
ENV COMMENT_INTERVAL=""
ENV RETRIEVAL_INTERVAL=""

# Expose the default port (this is just documentation, actual port is dynamic)
EXPOSE $PORT

# Define the command to run the application
CMD ["bun", "run", "start"]
