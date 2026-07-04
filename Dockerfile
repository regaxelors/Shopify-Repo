# Multi-stage build for optimized production image
# Stage 1: Build dependencies
FROM node:24-alpine AS builder

WORKDIR /app

# Copy only package files first (for layer caching)
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Stage 2: Runtime image (Cloud Run)
FROM node:24-alpine

WORKDIR /app

# Set environment for production
ENV NODE_ENV=production \
    PORT=8080 \
    RUN_HTTP_SERVER=true

# Copy node_modules from builder stage
COPY --from=builder /app/node_modules ./node_modules

# Copy application source
COPY src ./src
COPY .env.example ./.env.example

# Health check for Cloud Run
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8080/health', (r) => {if(r.statusCode!==200)throw new Error(r.statusCode)})"

# Expose port (Cloud Run uses PORT env var, but good practice)
EXPOSE 8080

# Run the application
# Cloud Run will bind to 0.0.0.0 automatically when PORT is set
CMD [ "node", "src/index.js" ]
