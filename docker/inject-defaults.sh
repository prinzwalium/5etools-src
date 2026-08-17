#!/bin/sh
# Build-time half of the deploy-time default books: wire the pages, once, while root still can.
#
# Run from the `Dockerfile`, never at container start. It injects the two script tags into every
# served page and leaves an empty, world-writable config file for the entrypoint to overwrite.
#
# Doing it here rather than at start-up is what lets the container run as a non-root user: writing a
# *new* file into the web root needs write permission on the directory, which an unprivileged
# process does not have, while overwriting an existing world-writable file needs only permission on
# that file. It is also simply the right place — the page markup is part of the image, and editing
# a hundred files on every restart to reach the same state was work the image could have done once.
#
#   sh docker/inject-defaults.sh [WEB_ROOT]

set -eu

WEB_ROOT="${1:-/var/www/localhost/htdocs}"
CONFIG_FILE="${WEB_ROOT}/js/deploy-defaults-config.js"
MARKER="js/deploy-defaults.js"
SNIPPET='<script type="text/javascript" src="js/deploy-defaults-config.js"></script><script type="module" src="js/deploy-defaults.js"></script>'

# Empty, so an unconfigured image is the site exactly as it was: `deploy-defaults.js` finds no
# global and returns without touching anything.
: > "${CONFIG_FILE}"
# The entrypoint must be able to rewrite this whatever user the container is told to run as. It
# holds a list of book names — there is nothing here to protect.
chmod 666 "${CONFIG_FILE}"

# Last in the body, which is where it has to be: tags run in document order, so this lands after
# `filter.js` has defined what it wraps and before `window.onload` builds the filters.
cnt=0
for file in "${WEB_ROOT}"/*.html; do
	[ -f "${file}" ] || continue
	# `if` rather than `&&`, because `set -e` and a short-circuiting test are a bad pair
	if grep -q "${MARKER}" "${file}"; then continue; fi
	if ! grep -q '</body>' "${file}"; then continue; fi
	sed -i "s|</body>|${SNIPPET}</body>|" "${file}"
	cnt=$((cnt + 1))
done

echo "[deploy-defaults] wired ${cnt} page(s) at build time"
