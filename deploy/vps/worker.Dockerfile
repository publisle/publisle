FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS runtime
WORKDIR /runtime
COPY deploy/vps/runtime/package.json deploy/vps/runtime/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM ghcr.io/voidreg/publisle-compiler@sha256:224d31b5294c99d0e03ec5507b2f9430f29ee97cc2dc37713c9b7ddde163b802
# Monochrome Noto Emoji (OFL), pinned to google/fonts b979dba. Variable face, default Regular.
ADD --checksum=sha256:de6c18832938afc99caf132b39d6a30a19bac7f2e812e28db2535b4608d27551 \
    https://github.com/google/fonts/raw/b979dba422e445492b0eb9951ac52ee0b4d648c3/ofl/notoemoji/NotoEmoji%5Bwght%5D.ttf \
    /usr/local/share/fonts/NotoEmoji-Regular.ttf
RUN fc-cache -f
COPY --from=runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=runtime /runtime/node_modules /app/node_modules
COPY deploy/vps/warm-fonts.tex /tmp/font-warmup/manuscript.tex
RUN cd /tmp/font-warmup && TEXMFVAR=/opt/texlive/texmf-var TEXMFCACHE=/opt/texlive/texmf-var \
    lualatex -no-shell-escape -interaction=batchmode -halt-on-error manuscript.tex && \
    rm -rf /tmp/font-warmup
COPY packages/pdf-service/dist/worker.mjs /app/worker.mjs
COPY packages/pdf-service/compiler/release.json /compiler/release.json
ENV HOME=/tmp TEXMFVAR=/tmp/texmf-var
ENV TEXMFCACHE=/tmp/texmf-cache:/opt/texlive/texmf-var
ENV VIPS_CONCURRENCY=1 MALLOC_ARENA_MAX=2
USER 1000:1000
ENTRYPOINT ["node", "--max-old-space-size=96", "/app/worker.mjs"]
