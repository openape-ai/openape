# DDISA token-exchange front-end for llms.openape.ai. Standalone deploy
# artifact (not a monorepo workspace package): one file + jose, no lockfile.
FROM node:22-bookworm-slim
WORKDIR /app
RUN npm install --no-audit --no-fund jose@^5.9.6
COPY server.mjs ./
ENV PORT=4010
EXPOSE 4010
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4010/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
