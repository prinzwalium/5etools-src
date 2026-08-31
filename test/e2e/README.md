# Character Sheet — browser tests

These drive the real `charactersheet.html` / `charbuilder.html` pages in a headless Chromium.
They cover what only exists once the page is running: the choice modals a pick raises, the feature
timeline, the panels, and what ends up in `localStorage`. The **pure rules** modules (derivation,
the leveling engine, choice extraction, proficiencies, trait choices, sources) are covered by the
much faster Jest suites in `test/jest/CharacterSheet*.test.js` — put a test there when you can.

## Running them

```bash
npm run test:e2e             # every suite
npm run test:e2e -- wizard   # only suites whose name contains "wizard"
```

The runner starts a dev server on port 5050 if one is not already listening, so no setup is
needed. If you already have `npm run serve:dev` running, it uses that.

Failures print the check that failed, and every open page is screenshotted into
`test/e2e/screenshots/` (git-ignored, uploaded as an artifact by CI).

## The suites

| Suite | What it protects |
| --- | --- |
| `layout` | Nothing overlaps; stacked columns take the full width on a phone; no sideways scrolling |
| `wizard` | Guided setup end to end — all seven steps, its validation, and every field it writes |
| `proficiencies` | Structured armor/weapon/tool/language grants, their source attribution, add and remove by hand |
| `traitchoices` | "Choose one" species traits: offered, level-gated, changeable, and the resistance they imply |
| `spellpanel` | The spell panel appears only for a character with spells, from any source |
| `sourcefilter` | Presets narrow the pickers; content already on a character is kept and flagged |
| `weaponmastery` | Masteries are picked by weapon *type*, without owning the weapon |
| `conditions` | Exhaustion drags every d20 test down and says so; damage while concentrating prompts the save at the right DC |
| `upkeep` | A wand's charges across rests, a quiver's arrows and their recovery, and the reminder left by a skipped ability increase |
| `turnhelper` | The Actions panel greys out what live state has taken away — slots, charges, ammunition, concentration, conditions |
| `audit` | The Build Check reports a broken rule and an unclaimed choice, and says so when there is neither |
| `cards` | The Cards button builds a printable deck of the character's own spells and attacks, then puts the page back |
| `citations` | A breakdown names the rule behind each contribution, and shows the book's own text, source and page |
| `journal` | Play is recorded and written up per session, splits where asked, and reloading the sheet records nothing |
| `appearance` | The portrait is downscaled, stored, cleared and survives a reload; the brew utilities are initialised |
| `smokes` | Magic-item bonuses, Expertise offered and claimed, a background's origin feat, and the store round-trip |
| `sync` | With no account system deployed, the seam is inert: nothing loaded, nothing logged, storage still local |
| `defenses` | Resistances/immunities/senses come from species, trait picks and worn gear, credited to each, and gear's go when it comes off |
| `sidekick` | Both sidekick rulesets: an Essentials Kit type + role with its level table and level-up box, and any stat block + a Tasha's class; traits as editable rows |

## Writing a new one

Add `something.e2e.mjs` beside these, exporting `run({browser, check})`:

```js
import {openPage, pickClass, resolveModals} from "./util-e2e.mjs";

export async function run ({browser, check}) {
	const page = await openPage(browser);          // clean character store
	await pickClass(page, "Rogue (PHB'24)");
	await resolveModals(page);                     // answer whatever the pick asked
	check("something is true", await page.locator("#cs-class-panel").count() === 1);
	await page.close();
}
```

`util-e2e.mjs` has the shared pieces: `openPage`, `getState`, `pickClass`, `pickViaSearch`,
`resolveModals`, `closeModal`, `setField`, and `seedRogue` for a character built far enough to
exercise the sheet.

Two habits worth keeping:

- **Name checks as statements about behaviour**, not selectors — the output doubles as the
  feature's documentation.
- **Assert on state as well as on the DOM.** A panel can render the right thing from the wrong
  data; `getState(page)` catches that.

## Browsers

The helper looks for a Chromium in `CS_E2E_BROWSER`, then `PLAYWRIGHT_BROWSERS_PATH`, then the
usual system paths, and finally falls back to the `chrome` channel — so it works on a CI runner
with Chrome preinstalled and on a dev box with a Playwright download, without either being
mandatory. Point `CS_E2E_URL` elsewhere to test a different server.
