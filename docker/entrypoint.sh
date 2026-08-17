#!/bin/sh
# Turn the container's environment into the site's default book selection, then start the server.
#
# 5etools has no server side: every page is a static file, and every setting lives in the visitor's
# own browser. So "the books this server starts you with" cannot be a config file the site reads —
# it has to reach the browser as part of the page. `docker/inject-defaults.sh` put the script tags
# there when the image was built; this writes what they read.
#
# It touches exactly one file — one the build already created and made writable — so the container
# can run as any user. And it never fails the container: a default book list is a convenience, and
# a web server that will not start because of one is a bad trade. If the write fails it says so,
# loudly and specifically, and serves the site unconfigured.
#
# Environment (all optional; each takes a comma- or semicolon-separated list):
#   DEFAULT_LOAD / DEFAULT_ALLOW  source codes to start ticked. Naming any makes the list
#                                 exhaustive — everything unnamed starts unticked.
#   DEFAULT_DENY                  source codes to start unticked. Beats DEFAULT_LOAD.
#   DEFAULT_BREW / DEFAULT_HOMEBREW  homebrew to install on a visitor's first load, by book title,
#                                 source code, or full URL. A partial title takes every book that
#                                 matches, so "Grim Hollow" takes the shelf.
#   WEB_ROOT                      where the site is served from. Defaults to the image's own root.

set -eu

WEB_ROOT="${WEB_ROOT:-/var/www/localhost/htdocs}"

DEPLOY_ALLOW="${DEFAULT_LOAD:-${DEFAULT_ALLOW:-}}"
DEPLOY_DENY="${DEFAULT_DENY:-}"
DEPLOY_BREW="${DEFAULT_BREW:-${DEFAULT_HOMEBREW:-}}"

CONFIG_FILE="${WEB_ROOT}/js/deploy-defaults-config.js"

# A JSON string body: backslashes first, then quotes, then the newlines a multi-line env var can
# carry. Missing any one of the three writes a broken script into every page on the site.
json_escape () {
	printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n\r' '  '
}

if [ -z "${DEPLOY_ALLOW}" ] && [ -z "${DEPLOY_DENY}" ] && [ -z "${DEPLOY_BREW}" ]; then
	echo "[deploy-defaults] nothing configured; serving the site unchanged"
	exec "$@"
fi

echo "[deploy-defaults] load=[${DEPLOY_ALLOW}] deny=[${DEPLOY_DENY}] brew=[${DEPLOY_BREW}]"

if [ ! -w "${CONFIG_FILE}" ]; then
	echo "[deploy-defaults] WARNING: cannot write ${CONFIG_FILE} — the default book list will NOT be applied." >&2
	if [ ! -e "${CONFIG_FILE}" ]; then
		echo "[deploy-defaults] The file is missing, so the web root is not this image's own." >&2
		echo "[deploy-defaults] A volume mounted over ${WEB_ROOT} replaces the built site; mount your data elsewhere." >&2
	else
		echo "[deploy-defaults] The file exists but is not writable by user $(id -u):$(id -g)." >&2
		echo "[deploy-defaults] Either drop 'read_only: true' from the service, or rebuild the image." >&2
	fi
	echo "[deploy-defaults] Serving the site unconfigured rather than refusing to start." >&2
	exec "$@"
fi

cat > "${CONFIG_FILE}" <<EOF
/* Generated at container start by docker/entrypoint.sh — edits here are overwritten. */
globalThis.DEPLOY_DEFAULTS = {"allow": "$(json_escape "${DEPLOY_ALLOW}")", "deny": "$(json_escape "${DEPLOY_DENY}")", "brew": "$(json_escape "${DEPLOY_BREW}")"};
EOF

echo "[deploy-defaults] applied"

exec "$@"
