# Setting the books a visitor starts with

A self-hosted 5etools serves one table, not the internet. That table plays a particular set of
books — and on the stock site every new browser starts with *everything* ticked and no homebrew at
all, so the first thing anyone does is repeat the same twenty clicks across eleven filter panels.

This fork lets the container say it once. Three environment variables in your Compose file decide
which sources start ticked, which start unticked, and which homebrew installs itself on a visitor's
first load.

## Quick start

```yaml
services:
   5etools:
      image: ghcr.io/prinzwalium/5etools-src:latest
      ports: ["8080:80"]
      environment:
         DEFAULT_DENY: "PHB,MM,DMG"
         DEFAULT_BREW: "Grim Hollow; Dungeons of Drakkenheim; Humblewood; Critical Role"
```

That serves a 2024-only site — the 2014 core three start unticked, their `X`-prefixed replacements
do not — with four homebrew shelves already installed.

A complete, commented file is in [`docker/compose.example.yml`](../docker/compose.example.yml).

## The variables

| Variable | What it does |
| --- | --- |
| `DEFAULT_LOAD` (or `DEFAULT_ALLOW`) | Source codes that start **ticked**. Naming any makes the list *exhaustive*: every source not named starts unticked. |
| `DEFAULT_DENY` | Source codes that start **unticked**. Beats `DEFAULT_LOAD` where they disagree. |
| `DEFAULT_BREW` (or `DEFAULT_HOMEBREW`) | Homebrew to install on a visitor's first load. |
| `WEB_ROOT` | Where the site is served from. Only needed if you have moved it. |

Each takes a list separated by commas **or** semicolons. Prefer semicolons for `DEFAULT_BREW`,
because book titles contain commas. A JSON array works too, if you would rather be explicit.

Setting none of them serves the site exactly as it was: the entrypoint says so and hands straight
over to the web server.

### Where source codes come from

A source code is the short tag 5etools puts on an entry — `XPHB`, `TCE`, `SCAG`. The reliable way
to find one is to open any page, hover a source abbreviation in the filter panel, or look at the
`source` field of an entry in `data/`. The 2014 and 2024 core books are:

| Book | 2014 | 2024 |
| --- | --- | --- |
| Player's Handbook | `PHB` | `XPHB` |
| Monster Manual | `MM` | `XMM` |
| Dungeon Master's Guide | `DMG` | `XDMG` |

Codes are matched case-insensitively, so `phb` is as good as `PHB`.

### How homebrew is named

Anything in the [5etools homebrew repository](https://github.com/TheGiddyLimit/homebrew) can be
named by:

- its **exact title** — `Dungeons of Drakkenheim` — which takes that one book;
- **part of a title** — `Grim Hollow` — which takes *every* book that matches, because that is
  what naming a series means;
- its **source code** — `HWCS` — for anyone who would rather be exact;
- a **full URL** to a JSON file, for homebrew that is not in the repository.

An exact title always wins over the books it is a prefix of, so naming one book never accidentally
takes the shelf.

Installed homebrew starts ticked, because that is 5etools' own rule for homebrew you have added.
**One exception:** an exhaustive `DEFAULT_LOAD` list turns off everything it does not name — homebrew
included — so if you use `DEFAULT_LOAD` *and* `DEFAULT_BREW` together, add each installed book's
source code to `DEFAULT_LOAD` as well. A deny list has no such catch.

## What this does and does not do

**It seeds; it does not enforce.** A default only decides the state of a filter pill that nobody
has touched. Concretely:

- **Anyone can tick a denied book back on.** This sets the starting position, not a permission. If
  you need a book genuinely gone, remove its data files from the image.
- **Existing visitors keep their own filters.** Browsers that have used the site already have saved
  filter state, and that is theirs — overriding it would throw away deliberate choices. Those
  visitors pick up the new defaults the moment they use *Reset filters* on a page (or clear the
  site's data).
- **Homebrew installs once per browser.** Each configured name is recorded after it installs, so a
  reload does not re-download it. Renaming an entry in the config installs it again, which is the
  safe way round: it fails loudly rather than silently doing nothing. A visitor who removes an
  auto-installed book keeps it removed.
- **A book that cannot be downloaded is skipped**, and the rest still install.

## How it works

5etools has no server side: every page is a static file, and every setting lives in the visitor's
browser. So "the books this server starts you with" cannot be a config file the site reads — it has
to reach the browser as part of the page.

1. `docker/entrypoint.sh` runs at container start. It writes the environment out as
   `js/deploy-defaults-config.js` (one line: `globalThis.DEPLOY_DEFAULTS = {…}`) and injects two
   `<script>` tags at the end of every served page's `<body>`. It is idempotent — a restart does
   not stack a second copy — and it `exec`s the web server, so nothing about the container's
   lifecycle changes.
2. `js/deploy-defaults.js` reads that global and wraps `PageFilterBase.defaultSourceSelFn`, the one
   function every source filter on every page asks for the default state of a pill. Wrapping rather
   than replacing means every source the config says nothing about keeps the site's own answer.
3. Homebrew installs in the background through `BrewUtil2`, the same path the *Manage Homebrew*
   dialog uses. It is deliberately not awaited: a slow download must not hold up the page.

The config arrives as a global rather than a `fetch` because the source filter is built during page
init, and an awaited round-trip loses that race.

### Why it is wired in at container start

The fork keeps a short list of upstream files it edits, so that an upstream merge has only that many
possible conflicts. Injecting the script tags at container start rather than editing every page
template keeps the feature down to fork-owned files plus the `Dockerfile` — which upstream does own,
and which this makes the fifth entry on that list. Three lines in a two-line file is a cheap
conflict to resolve, and the alternative was an edit in every page template.

## Running the image

Setting `ENTRYPOINT` discards the base image's inherited `CMD`, so the `Dockerfile` restates it:

```dockerfile
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["lighttpd", "-D", "-f", "/etc/lighttpd/lighttpd.conf"]
```

If you override `entrypoint:` in your own Compose file, override `command:` with that same line, or
the container will start and exit having served nothing.

## Verifying

The decisions live in four pure functions covered by `test/jest/DeployDefaults.test.js`
(`npm run test:unit -- test/jest/DeployDefaults`). The entrypoint itself is shell; to try it
without a container, point it at a copy of the site:

```sh
WEB_ROOT=/tmp/site DEFAULT_DENY="PHB,MM,DMG" sh docker/entrypoint.sh echo "would start here"
```
