# DDISA token-exchange front-end for llms.openape.ai. Self-contained: one file
# + jose. Build context = this directory.
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund --omit=dev
COPY server.mjs ./
ENV PORT=4010
EXPOSE 4010
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4010/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
