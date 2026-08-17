#!/bin/sh
# Turn the container's environment into the site's default book selection.
#
# 5etools has no server: every page is a static file, and every setting lives in the visitor's own
# browser. So "the books this server starts you with" cannot be a config file the site reads — it
# has to reach the browser as part of the page. This writes the environment out as one small script
# and injects it, plus the module that applies it, into each served page.
#
# Runs before the web server, then hands over to it (`exec "$@"`), so an unconfigured deployment is
# byte-for-byte the image it always was.
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
MARKER="js/deploy-defaults.js"
SNIPPET='<script type="text/javascript" src="js/deploy-defaults-config.js"></script><script type="module" src="js/deploy-defaults.js"></script>'

# A JSON string body: backslashes first, then quotes, then the newlines a multi-line env var can
# carry. Missing any one of the three writes a broken script tag into every page on the site.
json_escape () {
	printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n\r' '  '
}

if [ -z "${DEPLOY_ALLOW}" ] && [ -z "${DEPLOY_DENY}" ] && [ -z "${DEPLOY_BREW}" ]; then
	echo "[deploy-defaults] nothing configured; serving the site unchanged"
	exec "$@"
fi

echo "[deploy-defaults] load=[${DEPLOY_ALLOW}] deny=[${DEPLOY_DENY}] brew=[${DEPLOY_BREW}]"

mkdir -p "${WEB_ROOT}/js"
cat > "${CONFIG_FILE}" <<EOF
/* Generated at container start by docker/entrypoint.sh — edits here are overwritten. */
globalThis.DEPLOY_DEFAULTS = {"allow": "$(json_escape "${DEPLOY_ALLOW}")", "deny": "$(json_escape "${DEPLOY_DENY}")", "brew": "$(json_escape "${DEPLOY_BREW}")"};
EOF

# Injected last in the body, which is where it has to be: the tags run in document order, so this
# lands after `filter.js` has defined what it wraps and before `window.onload` builds the filters.
# The marker check keeps a container restart from stacking a second copy.
cnt=0
for file in "${WEB_ROOT}"/*.html; do
	[ -f "${file}" ] || continue
	# `if` rather than `&&`, because `set -e` and a short-circuiting test are a bad pair
	if grep -q "${MARKER}" "${file}"; then continue; fi
	if ! grep -q '</body>' "${file}"; then continue; fi
	sed -i "s|</body>|${SNIPPET}</body>|" "${file}"
	cnt=$((cnt + 1))
done

echo "[deploy-defaults] wired ${cnt} page(s)"

exec "$@"
