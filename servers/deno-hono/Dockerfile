FROM denoland/deno:debian-2.9.8
WORKDIR /app
USER deno
# Dependencies are downloaded and cached at build time, checked against deno.lock.
COPY deno.json deno.lock main.ts ./
RUN deno install --frozen --entrypoint main.ts
EXPOSE 8080
# deno serve --parallel starts DENO_JOBS workers (one isolate and event loop each) sharing the port.
# exec keeps deno as the child of the image's tini, which forwards the stop signal.
CMD ["sh", "-c", "DENO_JOBS=\"${CPUS:-1}\" exec deno serve --parallel --frozen --cached-only --allow-net --allow-env --host 0.0.0.0 --port \"${PORT:-8080}\" main.ts"]
