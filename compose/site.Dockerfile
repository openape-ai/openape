# Package a prebuilt static site directory into a Caddy image (same artifact
# idea as preview-package.Dockerfile, but for prerendered HTML instead of a
# Nitro server). Build context = the directory to serve:
#   docker buildx build --platform linux/amd64 -f compose/site.Dockerfile \
#     -t registry.openape.ai/site-docs:prod-<sha> --load apps/docs/.output/public
# /200.html is the prerender SPA fallback for routes that weren't crawled.
FROM caddy:2-alpine
RUN printf ':80 {\n\troot * /srv\n\ttry_files {path} {path}.html {path}/ /200.html\n\tfile_server\n}\n' > /etc/caddy/Caddyfile
COPY . /srv
