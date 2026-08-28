# preview-package.Dockerfile + git: ape-git spawns `git http-backend` (CGI) per
# smart-HTTP request, so the runtime image needs the git binary. safe.directory
# at system level because the repos volume is owned by the host's uid 1000 —
# the container runs as that uid, but a mismatch must fail loudly in git, not
# as a silent dumb-HTTP fallback (M2 lesson).
#
# Build context = the app's .output directory (same as preview-package).

FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system --add safe.directory '*'
ARG PORT=3000
WORKDIR /app
COPY . ./.output
RUN cd .output/server \
 && LIBSQL_VER=$(node -p "require('./node_modules/libsql/package.json').version") \
 && PKGARCH=$(node -p "process.arch === 'arm64' ? 'arm64' : 'x64'") \
 && npm pack "@libsql/linux-${PKGARCH}-gnu@${LIBSQL_VER}" \
 && mkdir -p "node_modules/@libsql/linux-${PKGARCH}-gnu" \
 && tar -xzf "libsql-linux-${PKGARCH}-gnu-${LIBSQL_VER}.tgz" -C "node_modules/@libsql/linux-${PKGARCH}-gnu" --strip-components=1 \
 && rm -f "libsql-linux-${PKGARCH}-gnu-${LIBSQL_VER}.tgz"
ENV NITRO_PORT=${PORT}
ENV HOST=0.0.0.0
ENV PORT=${PORT}
EXPOSE ${PORT}
CMD ["node", ".output/server/index.mjs"]
