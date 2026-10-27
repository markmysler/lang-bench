FROM node:24.22.1-trixie-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
USER node
EXPOSE 8080
ENTRYPOINT ["node", "server.js"]
