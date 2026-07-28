# Path-selector shim for llms.openape.ai (M3). Stdlib-only, no dependencies.
FROM node:22-bookworm-slim
WORKDIR /app
COPY route.mjs ./
ENV PORT=4020
EXPOSE 4020
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('net').connect(4020,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"
CMD ["node", "route.mjs"]
