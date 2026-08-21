# Package a prebuilt static site directory into a Caddy image (same artifact
# idea as preview-package.Dockerfile, but for prerendered HTML instead of a
# Nitro server). Build context = the directory to serve:
#   docker buildx build --platform linux/amd64 -f compose/site.Dockerfile \
#     -t registry.openape.ai/site-docs:prod-<sha> --load apps/docs/.output/public
FROM caddy:2-alpine
# Unbekannte URLs bekommen die prerenderte 404-Seite MIT Status 404 — ein
# Fallback auf eine Datei, die es nicht gibt, liefert eine weisse Seite.
RUN printf ':80 {\n\troot * /srv\n\ttry_files {path} {path}.html {path}/\n\tfile_server\n\thandle_errors {\n\t\trewrite * /404.html\n\t\tfile_server\n\t}\n}\n' > /etc/caddy/Caddyfile
COPY . /srv
