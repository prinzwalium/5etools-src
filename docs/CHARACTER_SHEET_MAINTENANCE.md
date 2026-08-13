# Character Sheet — Maintenance & Upstream Updates

This fork adds a **Character Sheet builder** that the original 5etools does not
have. This page explains, in plain terms, how to keep your fork up to date with
upstream 5etools **without losing the builder** — and what to do in the rare
case of a merge conflict.

You do **not** need to be a programmer to follow this.

---

## The one-command update

```bash
bash scripts/update-from-upstream.sh
```

That script fetches the latest upstream changes, merges them, rebuilds the
generated pages, and runs the Character Sheet's tests. It makes a **safety
backup branch** first, so nothing is ever lost.

**First time only:** tell git where the original 5etools lives (this is the repo
you forked from). Run once:

```bash
git remote add upstream https://github.com/5etools-mirror-3/5etools-src.git
```

(If you forked from a different repo, use that URL instead.)

---

## The automatic update (and the button that must never be pressed)

`.github/workflows/sync-upstream.yml` runs the same update **every night**, and
can also be started by hand from the repo's **Actions** tab. It merges upstream
into `main`, regenerates the pages, and runs the Character Sheet's lint and
tests. If all of that passes it pushes to `main`; if the merge conflicts, or a
check fails, it pushes **nothing** and opens a pull request for you instead —
and the run itself goes red, so the one morning that needs you does not look
like every other morning.

### Reading the green tick

Most nights upstream has not moved, and the job stops at its second step:
everything after "Check whether there is anything to merge" is **skipped**. That
green tick means "there was nothing to do" — on its own it never shows that the
merge, the regeneration, the lint or the tests still work.

Two ways to actually exercise it:

- **From the Actions tab.** Run it with **force** ticked to take the merge path
  even when there is nothing new (the merge is then a no-op, but `npm ci`, the
  page regeneration, the lint and the unit tests all run for real), and
  **dry run** ticked to keep the result off `main`.
- **Locally, including the conflict path**, which no run in the Actions tab can
  trigger on purpose:

  ```bash
  bash scripts/rehearse-upstream-sync.sh clean      # upstream changes a shared partial
  bash scripts/rehearse-upstream-sync.sh conflict   # upstream edits js/navigation.js beside ours
  ```

  Each builds a synthetic upstream one commit ahead of the real one, in a
  throwaway clone, and replays the workflow's own steps over it. `clean` should
  merge, regenerate, lint and test; `conflict` should leave the markers
  committed, build nothing and push nothing.

> **Never use GitHub's "Sync fork → Discard commits" button.**
>
> That button does not merge — it *resets* `main` to upstream and throws every
> commit this fork ever added away, the Character Sheet included. It has already
> done so once. Upstream cannot touch your fork on its own; only that button (or
> a `git push --force` to `main`) can.
>
> Two things make it a non-issue: the nightly sync above removes any reason to
> press it, and **protecting `main`** stops it working even if someone does.
> Turn that on once, in the repo's *Settings → Branches → Add branch ruleset*:
> target `main`, and tick **Block force pushes**.

If `main` is ever wiped again, nothing is lost as long as `beta` still has the
work: merge upstream's `main` into `beta`, then push that merge to `main` (it
fast-forwards, so no force push is needed and upstream's releases stay in the
history).

---

## Why conflicts are rare

A merge conflict can only happen when **both** upstream **and** your fork change
**the same file**. Almost the entire Character Sheet lives in **fork-only files**
that upstream doesn't have, so they can never conflict:

- `charactersheet.html`, `charbuilder.html`, `sidekick.html` (generated — see below)
- `js/charactersheet.js`, `js/charbuilder.js`, `js/sidekick.js`, and everything in `js/charactersheet/`
- `css/charactersheet.css`, `scss/charactersheet.scss`
- `node/generate-pages/template/page/template-page-charactersheet.hbs` (and the
  `-charbuilder` / `-sidekick` templates beside it)
- `test/jest/CharacterSheet*.test.js`, `test/e2e/`

That's ~95% of the work, and it is **conflict-proof**.

---

## The only 4 places a conflict can happen

The Character Sheet has to be "registered" into a few shared files so the app
knows the page exists. These are the **only** spots that can ever conflict. If
the update script reports a conflict, it will be in one of these — and the fix
is always the same: **keep both your line(s) and upstream's**.

### 1. `js/navigation.js` — the navbar entries

Your fork adds these three lines (they put the fork's pages in the Player menu):

```js
this._addElement_li({keyPath: [NavBar._CAT_PLAYER], page: "charbuilder.html", aText: "Character Builder"});
this._addElement_li({keyPath: [NavBar._CAT_PLAYER], page: "charactersheet.html", aText: "Character Sheet"});
this._addElement_li({keyPath: [NavBar._CAT_DUNGEON_MASTER], page: "sidekick.html", aText: "Sidekick Builder"});
```

(The sidekick builder sits in the *Dungeon Master* menu, the other two in *Player*.)

**On conflict:** keep upstream's surrounding menu entries *and* these lines.

### 2. `index.html` — the two home-page buttons

Your fork adds two `<a ... href="charactersheet.html" ...>` buttons on the home
page (one narrow-screen, one normal). Each looks like:

```html
<a class="home__btn-page ve-btn ve-btn-default home__btn-player" href="charactersheet.html" title="Build and manage a character with an interactive digital character sheet. Autosaves to your browser.">
```

**On conflict:** keep upstream's home layout *and* your two buttons. If a button
ends up duplicated after resolving, just delete the extra — it's harmless
either way.

### 3. `node/generate-pages/generate-pages-page-generator-config.js` — the page build entry

Your fork adds a page-generator class per page and registers each one. The
classes all look like this:

```js
class _PageGeneratorCharactersheet extends PageGeneratorGeneric {
	_filename = "page/template-page-charactersheet.hbs";
	_page = "charactersheet.html";
	_pageTitle = "Character Sheet";
	_navbarDescription = "Build and manage a character. Autosaves to your browser.";
	_stylesheets = ["charactersheet"];
	_scriptsModules = ["charactersheet.js"];
}
```

…with `_PageGeneratorCharbuilder` and `_PageGeneratorSidekick` beside it, plus
three lines in the list of generators near the bottom of the file:

```js
new _PageGeneratorCharactersheet(),
new _PageGeneratorCharbuilder(),
new _PageGeneratorSidekick(),
```

**On conflict:** keep upstream's other generators *and* all of these.

> **Resolving a conflict** just means opening the file, finding the
> `<<<<<<<`, `=======`, `>>>>>>>` markers, and editing so that **both** sides'
> content is present (deleting the marker lines). Then `git add <file>` and
> `git commit`. Re-run the update script afterward to rebuild and test.

---

### 4. `package.json` — two added lines

The fork adds one script and one dev dependency for its browser tests:

```json
"test:e2e": "node test/e2e/run-e2e.mjs",
```
```json
"playwright-core": "^1.61.1",
```

If this ever conflicts, keep **both** sides' lines — upstream's dependency changes and these two.

---

## Testing the Character Sheet

Three layers, cheapest first — all of them run in CI on every push
(`.github/workflows/charactersheet-ci.yml`):

```bash
npm run test:unit -- test/jest/CharacterSheet   # pure rules, ~2s
npm run test:e2e                                 # the real pages in a browser, ~3min
npx eslint js/charactersheet.js js/charbuilder.js js/sidekick.js js/charactersheet/
```

Prefer a unit test when the logic is pure. `test/e2e/README.md` explains the browser suites and
how to add one.

### Playtesting whole characters

Neither layer catches the bugs that only appear when a *particular* combination is built end to
end — a grant that is applied but never ticked, a decision the guide never lists, a panel that
disagrees with the Build Check. Those come out of building real characters, so build them:

1. `npm run serve:dev`, open `/charbuilder.html`, run the Guided Setup.
2. On the last step, answer every decision it lists until it says *Nothing left*.
3. Read the **Species**, **Background** and **Build Check** panels against each other. They read
   the same rules, so any disagreement between them is a bug in one of them.

A matrix that has earned its keep: **Human Fighter** (two sources offering the same skill),
**Elf Wizard** (a lineage to choose, a narrowing feat uid), **Dwarf Cleric** (a prepared caster),
**Dragonborn Paladin** and **Goliath Barbarian** (ancestry choices), **Tiefling Warlock**
(invocations), **Halfling Rogue** (Expertise, masteries, an Arcane Trickster's spells).

What that matrix found, and what to look for again:

- a feat uid may *narrow* the feat as well as name it (`"magic initiate; wizard|xphb"`); only the
  part before the semicolon is the name a taken feat is stored under;
- the same proficiency cannot be gained twice — a skill records a state, not a count, so a second
  grant lands on a ticked box and is silently lost;
- a "choose one of the following" trait reads as an ordinary trait card, which is no help when it
  is a question.

---

## Important: the page HTML files are *generated*

Never hand-edit `charactersheet.html`, `charbuilder.html` or `sidekick.html` —
the build overwrites them. Their real sources are the templates:

```
node/generate-pages/template/page/template-page-charactersheet.hbs
node/generate-pages/template/page/template-page-charbuilder.hbs
node/generate-pages/template/page/template-page-sidekick.hbs
```

To change the page's markup, edit the **template**, then regenerate:

```bash
node node/generate-pages.js
```

The update script does this regeneration for you automatically, which also picks
up any upstream changes to the shared page header/navbar.

---

## If something goes wrong

Every run of the update script prints a **backup branch** name like
`backup/pre-upstream-20260101-120000`. To completely undo an update and return
to exactly where you were:

```bash
git reset --hard backup/pre-upstream-YYYYMMDD-HHMMSS
```

Or, if you're mid-merge and want to bail out:

```bash
git merge --abort
```

---

## Asking Claude for help

If you'd rather not resolve a conflict by hand, you can open a Claude Code
session and say *"pull the latest from upstream into my fork."* The repo's
`CLAUDE.md` tells Claude exactly how this fork is structured and how to resolve
these specific conflict points, so it can do it for you safely.

---

## Undefined symbols (a missing `import`)

`no-undef` is **off** repo-wide, and has to be: 5etools loads `Parser`, `Renderer`, `UiUtil` and
dozens more as script-tag globals, so the rule would be one long list of false positives. The cost
is that a missing `import` in one of the fork's ES modules is not a lint error either — it is a
`ReferenceError` in the browser, at the moment somebody clicks the thing, and it has reached a
running page twice.

So the rule runs separately, over the fork's modules only, with those globals declared:

```bash
node scripts/check-charactersheet-imports.mjs
```

It runs in CI. If you add a new 5etools global to a Character Sheet module, add it to `SITE_GLOBALS`
in that script — after checking it really is one (`grep "globalThis.<Name> =" js/utils-ui.js`).
