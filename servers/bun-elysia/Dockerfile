FROM oven/bun:1.4.4-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production && rm -rf /root/.bun/install/cache
COPY launcher.ts server.ts ./
USER bun
EXPOSE 8080
ENTRYPOINT ["bun", "launcher.ts"]
