FROM mcr.microsoft.com/playwright:v1.59.1-noble
WORKDIR /opt/runner
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm cache clean --force
COPY . .
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright CRAWLEE_STORAGE_DIR=/tmp/crawlee
CMD ["node", "--import", "tsx", "/opt/runner/main.ts"]
