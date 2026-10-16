# syntax=docker/dockerfile:1
#
# 5etools as a small static-site image: the site exactly as upstream ships it, served by
# static-web-server (one static binary on an empty base) instead of upstream's image, which is built
# on `5etools-img` and carries every picture.
#
# The pictures are not in this image. They load from upstream's own picture repository on GitHub,
# which is how upstream's GitHub Pages build does it (`.github/set-img-root.sh`).
#
# Fork-owned, like everything in `docker/` and `.github/workflows/docker-image.yml`: upstream has no
# such paths, so an upstream merge never touches them. Build from the repository root:
#
#     docker build -f docker/Dockerfile -t 5etools .

# The build runs once, on the builder's own platform: its output is plain files, the same for every
# platform the image is published for
FROM --platform=$BUILDPLATFORM node:lts-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# As upstream's release build does: mark the version deployed, point pictures at upstream's
# repository, build the service worker every page registers
RUN bash .github/set-deployed-flag.sh "v$(node -p 'require("./package.json").version')" \
	&& bash .github/set-img-root.sh 5etools-mirror-3 \
	&& npm run build:sw:prod
# What the site serves: exactly what upstream's own `.dockerignore` lets into upstream's image (its
# `!` lines), read at build time, so an upstream sync that changes the list changes this image with it.
# `docker` is on that list for upstream's sake; here it is this file's own directory
RUN mkdir /out \
	&& sed -n 's/^!//p' .dockerignore | while read -r pattern; do \
		for path in $pattern; do if [ -e "$path" ]; then cp -a "$path" /out/; fi; done; \
	done \
	&& rm -rf /out/docker

FROM joseluisq/static-web-server:2.44.1
COPY --from=build /out /public
# IPv4: the default (`::`) fails to bind on a host with IPv6 switched off
ENV SERVER_ROOT=/public \
	SERVER_HOST=0.0.0.0 \
	SERVER_PORT=80 \
	SERVER_COMPRESSION=true \
	SERVER_HEALTH=true
# Nobody: the files are read-only to it, and port 80 needs no privilege inside a container
USER 65534:65534
