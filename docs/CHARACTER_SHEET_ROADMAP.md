# Character Sheet — roadmap

What is worth building next, and why. Ordered by value, not by effort. Tick items off as they
land; add new ones at the bottom of their tier.

Done so far: the builder and sheet themselves, the choice engine, the leveling engine, structured
proficiencies, "choose one" species traits, per-character source filtering, stat provenance,
the UI rework, the sidekick builder, print/PDF export, and the test/CI setup below.

**Status: everything on this list is built.** The one unticked box is struck through — a party
sheet, which was built instead as a screen in the account system, where a server made the version
worth having possible. Two things arrived after this list was written and have their own section at
the bottom: **the 2024 books as the default**, and **homebrew authoring** — seven builders on
`makebrew.html` and the hand-off that sends what they write to an account. What is left is not on
this list and not in this repository: the homebrew mirror to `5etools-homebrew`, and whatever the
next playtest turns up. New work goes at the bottom of its tier, as before.

---

## Now

- [x] **CI that runs the tests.** `npm test` existed but nothing invoked it; a push ran nothing.
      Now `.github/workflows/charactersheet-ci.yml` lints, unit-tests, checks the generated pages
      match their templates, and runs the browser tests on every push and pull request.
- [x] **Browser tests in the repo.** 136 checks across eight suites in `test/e2e/`, promoted from
      throwaway scripts. They caught real regressions repeatedly while the sheet was being built.
- [x] **Sidekick builder** (`sidekick.html`, in the DM menu). Both published rulesets, read from
      data: the Essentials Kit's three types with their roles (healer/mage, attacker/defender) and
      its fixed level table driving a one-click level-up, and any bestiary stat block plus a TCE
      sidekick class for levels past 6. Traits & Actions is a list of editable rows. Everything
      stays hand-editable, and a sidekick is just a character with `isSidekick: true`, so it reuses
      the whole engine.
- [x] **Print / PDF output.** The *Print* button on every page. Character pages print as a plain
      sheet, sidekicks as a stat-block card. `_bindPrintPrep` works around what browsers refuse
      to print: textarea overflow, closed `<details>`, and panels with nothing in them.

---

## Next — rules gaps a player hits at the table

- [x] **Resistances, immunities and senses are structured.** A *Defenses & Senses* panel on all
      three pages, grouped by kind and attributed to whatever granted each one — species, feat,
      trait pick, equipped item, or added by hand. Read from the data in every case. Gear grants
      only while it is worn (and the chip says so); a trait pick's resistance follows the pick.
      Nothing is copied into the notes box any more.
- [x] **Exhaustion now costs what it should.** −2 per level on every d20 test: ability checks,
      saving throws, skills, initiative, passive Perception and attack rolls, weapon and spell
      alike. Not on a spell save DC, which is set rather than rolled, and not on damage. Each
      affected number's breakdown names exhaustion as the reason, and the counter says what it is
      costing ("−4 to d20 tests, −10 ft. speed").
- [x] **The concentration save is prompted.** Losing hit points while concentrating raises a
      prompt with the DC (10, or half the damage), the spell's name, a Constitution save to roll,
      and *Kept it* / *Lost it* — the latter clearing the spell. Watches the hit-point value rather
      than the Damage button, so typing a lower number counts; healing and switching characters do
      not.
- [x] **Item charges and ammunition.** An item with charges shows what it has left and spends them
      a click at a time; a rest gives back exactly what the item says (`1d6 + 1` at dawn is rolled,
      not assumed), and only on the rest that recharges it. Ammunition has *Fire*, and the
      battlefield search that recovers half of what was spent.
- [x] **Stale "assign manually" notes.** A skipped ability increase is now an outstanding offer
      shown beside the ability scores, with *Assign now* (which walks the original choice) and
      *Dismiss*. Assigning settles it, and an old character's note is migrated into one on load.

## Next — the turn helper

- [x] **"What can I do right now?"** The Actions panel now says what is *possible*, not just what
      exists. A spell with no slot left, an empty wand, an empty quiver and a spent class resource
      are greyed with the reason beside them; a concentration spell warns that it would drop what
      is already running; an incapacitating condition blocks the whole turn, and exhaustion, being
      prone and being grappled are stated once above the list. Equipped items with charges are
      listed as actions in their own right, which they never were. No mainstream sheet gates its
      action list on live resources.

## Later — quality of life

- [x] **Print polish.** A level-5 character used five pages and was checked by eye, which is why it
      kept breaking: what the screen shows and what the printer is handed are two different
      documents, and nothing about the second is visible while working on the first.
      Now **one page is the sheet you play from** — the header, the six abilities across as a stat
      block puts them, saves and skills in two columns each, combat, attacks, actions, conditions —
      and the reference column starts a fresh page after it, deliberately (`cs__col--reference`).
      Three pages in total for a level-5 Rogue, down from five: 12mm margins, panel spacing tuned
      for paper rather than a monitor, the session journal left off (a log of past evenings is not
      part of the sheet you play from), and the feature timeline printed as *text* — the pencils,
      tick boxes, running counts and "choose a feat" prompts are choosing apparatus, and an option
      nobody picked is not a fact about the character.
      Held in place by `test/e2e/print.e2e.mjs`, which drives the real path — `emulateMedia`, the
      page's own print preparation, and Chromium's PDF writer, the same one behind "Save as PDF" —
      and measures the play half against the height a page actually has. Writing it turned up that
      a *string* where the structured proficiency or defence list belongs took the whole page down;
      a save file is an input from outside, so both merges now survive one.
- [x] **Accessibility.** Audited all three pages rather than guessed at, and the findings fixed:
      every field labelled (the class/background/species inputs had a label-shaped `<span>` that was
      not one; four textareas had only a placeholder), the six death-save dots named and reporting
      `aria-pressed`, attack-row inputs named. The real one: **the breakdowns were mouse-only** —
      "every number cites its rule" opened from a click delegate on plain `<span>`s, so the whole
      feature was unreachable by keyboard. Those are now controls with a role, a tab stop,
      Enter/Space to open, Escape to close, and a focus ring. Held in place by
      `test/e2e/a11y.e2e.mjs`, which resolves `aria-labelledby` rather than trusting its presence —
      a dangling reference reads as a label to a naive check and as nothing at all to a screen
      reader, and it caught exactly that twice while this was being written.
- [x] **Character portrait and appearance fields.** An *Appearance* panel on the sheet and the
      builder: age, height, weight, eyes, skin and hair, and a portrait. The portrait is downscaled
      to 400px on its longest edge and re-encoded as JPEG before it is stored, and one over half a
      megabyte is refused — every character in the store shares one `localStorage` quota, so an
      untouched phone photo would break saving for all of them, not just the one it was added to.
- [x] **Sharing a character** with a DM — a read-only link, from the *Share* button on any character
      that is online. Whoever follows it needs no account and is never asked for one, and the link
      can be taken back: one live link per character, revocable, optionally expiring. The session
      journal is not part of what is shared. Served by the account system; with none deployed there
      is no Share button, like everything else on that seam.
- [x] **Homebrew.** Not what this said it was. `charactersheet-classdata.js` had *always* asked the
      `DataLoader` for brew alongside site content, and `SearchWidget` already indexes brew for the
      species/background/item pickers — but none of it can return anything until `BrewUtil2.pInit()`
      has run, and no character page ever ran it. So the builder was not ignoring homebrew; it was
      missing one line of setup, and every brew-aware call it already made was dead code. The three
      pages now initialise prerelease, brew and the exclusion list before building, and carry on with
      a toast if that fails — a character matters more than the content it could have picked from.
      A *Homebrew* button in each toolbar opens 5etools' own manager, so brew added here is the same
      brew every other page sees.

## Ideas worth building, easiest first

- [x] **A guide that finishes the character.** The guided setup stopped at equipment, which is where
      a character stops being *decidable in advance* and starts needing to exist: a level-5 Cleric
      came out of it with no subclass, no Ability Score Improvement and no spells, none of it
      mentioned anywhere. It now has an eighth step that runs on the applied character and walks
      what is left — subclass, ASIs, Expertise, weapon masteries, optional features, origin feats,
      spells, hit points — using the panels' own pickers, and re-reading the list after each answer
      because one answer can reveal the next. `charactersheet-buildsteps.js` computes the list and
      is unit-tested; the Build Check reads the same rules, so the two cannot drift.

- [x] **Printable spell and action cards.** The *Cards* button on the sheet prints the character's
      known spells and attacks as index-card-sized cards, two across a page: name, level and school,
      casting time, range, components, duration, the spell's own text and its at-higher-levels
      clause — plus *their* save DC or attack bonus rather than a formula to work out. Concentration
      and ritual are flagged. The deck is built only when asked for, since it needs the whole spell
      list loaded, and exists only on paper.
- [x] **Level-up preview.** Raising the level now shows what it brings *before* anything is
      committed — hit points with the arithmetic spelled out, the proficiency bonus when it moves,
      each feature gained (the subclass's named for it), new spell slots as "0 → 2", and below that
      what the level will then ask you to choose: an Ability Score Improvement, a subclass, weapon
      masteries, cantrips. **Cancel puts the level back and changes nothing else**, which is the
      point: a mis-typed level used to mean undoing a scatter of changes by hand.
      `charactersheet-levelpreview.js` is pure — derive at N, derive at N+1, subtract — and reports
      without writing, which is what makes declining free. It reads both shapes class data takes
      (the loader's dereferenced features and the files' raw string refs), because a preview that
      cannot be unit-tested is a preview nobody can trust.
- [x] **Build audit.** A *Build Check* panel on the builder, in two halves: what breaks a rule (a
      fourth attuned item, an unmet multiclass prerequisite read from the class's own
      `multiclassing.requirements`, over-encumbered, class levels that do not add up, hit points
      never set) and what is unclaimed (an ability increase never assigned, an Expertise pick, a
      weapon mastery, a missing class/species/background). It reports and never blocks — a DM
      ruling beats it. The counts come from the same pure functions the class panel uses to *offer*
      those choices, so the audit cannot drift from what the panel asks for.
- [x] **Every number cites its rule.** A breakdown is now a list rather than a line, and beside each
      contribution sits the rule that lets it count — one click away from the book's own paragraph,
      with its source and page. The mapping turned out to need no curated prose at all: the 2024
      rules glossary states Proficiency, Ability Score and Modifier, Armor Class, Passive Perception,
      Initiative and the rest as their own addressable entries, so a "Proficiency +3" part points at
      the actual rule, and gear, fighting styles and the exhaustion condition point at themselves. A
      magic bonus names the item responsible when exactly one is — with two contributing there is no
      single rule to show, and it stays unlinked rather than inventing one. So does a house-ruled
      Misc. A unit test asserts every catalogue entry exists in the shipped data, so a citation
      cannot rot into an empty modal.
- [x] **A session journal the sheet writes itself.** A *Session Journal* panel on the sheet, newest
      session first, each written up as a sentence: "Took 47 damage across three fights, went down
      once, burned six slots, two long rests, gained a level and fired 23 pieces of ammunition and
      recovered 11." Nothing is typed — every hit point, death save, rest, spent slot, class
      resource, condition, charge and arrow is recorded as it happens.
      *Sessions* split on a six-hour silence, or wherever *New session* is pressed, because a player
      who says a session ended knows better than a clock. *Fights* are inferred from bursts of
      damage separated by quiet or by a rest — approximate by design, since the sheet is never told
      initiative was rolled. *Storage* is capped at 1000 events, oldest dropped, so it cannot grow
      forever beside the character. *Recording pauses while loading*, so re-opening the sheet and
      restoring a saved hit-point total does not read as a fight — the same `hpCur` hook the
      concentration prompt uses, so the two can never disagree about what damage is.

## Maybe

- [x] **A party sheet. Built — as a screen in the account system's own app.** The catch below was
      real and the answer was the thing that removed it: a server. The tables app reads every
      character at a table in one request and summarises them with **this fork's own rules
      modules**, imported by URL, so the page that answers "does anyone have darkvision" computes
      from the same code the sheet does and there is no second implementation to drift.
      The original plan, for the record, and why it was not built:

- [ ] ~~**A party sheet.**~~ One page for the whole party: senses, resistances and immunities,
      languages, tool proficiencies, passive Perception, spells known — the columns that answer
      "does anyone have darkvision / speak Draconic / resist fire", which is the question that
      actually stops play. No other sheet answers it, and everything it needs is structured here.
      *The catch:* characters live in each player's own browser, and live sync would need a server
      or WebRTC signalling — which costs the no-account, static-site property. The workable version
      is snapshots: players send a *Save to File* export (or a link whose payload sits in the URL
      fragment and never reaches a server) once per level-up, and the page flags a stale one
      ("level 4 snapshot, party is level 6"). The columns that matter are build data, so a snapshot
      is nearly as good as live — but it costs every player a send at each level-up, and only the
      DM sees the benefit. Worth doing if that trade stops feeling annoying.

- [x] **Accounts and server-side characters. Built, in a separate repository.** Sign-in against
      Authentik, characters that follow a player between devices with conflict resolution rather
      than last-write-wins, history and restore, campaigns with invites and roles, share links, a
      support console, a sidekick the whole table can play, and a character a player can lend to
      their DM. This fork holds only the seam: `charactersheet-sync.js` and the wiring in the page
      base. With nothing deployed the pages behave exactly as they always have, which is still the
      supported state — the Pages build is static. See `docs/ACCOUNT_SYSTEM.md` and
      <https://github.com/PrinzWalium/5etools-online>.

  **It lives in its own repository**, deployed behind the same subdomain on its own path by a
  reverse proxy — *not* in this repo. That decision does the most work of any here:

  - the four shared upstream files stay four, and this repo gains no server, no second dependency
    tree and no second CI;
  - every later sync feature ships from that repo, with no change to 5etools-src at all;
  - same-origin means the browser's own session cookie authenticates each call. No token in
    `localStorage`, nothing for the client to store or leak, and no CORS to configure.

  **Authentication is OIDC against an existing Authentik instance.** The account app is a
  confidential OIDC client; this fork never sees a token, an identity or a password — only whether
  `pWhoAmI()` answers. Nothing here has to own credentials, resets or revocation.

  **What is already in this repo** (`charactersheet-sync.js`, fork-owned, tested):

  - the adapter contract — `pWhoAmI`, `pList`, `pLoad`, `pSave`, `pDelete`, `getLoginUrl`;
  - the mount path as configuration, defaulting to `/online`, overridable by
    `window.CHARACTER_SYNC_PATH` or a `<meta name="character-sync-path">` a proxy can inject, and
    settable to `""` to switch the whole thing off;
  - `_pLoadSyncAdapter` in the page base, which loads `<base>/client.js` during `pInit` and keeps
    the adapter only if it implements the whole contract. A half-implemented one is refused with a
    reason rather than allowed to take storage over and fail partway;
  - a `SyncConflictError` carrying what the server holds, so a clash asks *keep mine / take theirs*
    rather than attempting a merge — characters are single-writer in practice.

  **Nothing deployed is a supported state, not a fallback.** No account app, a 404, a script that
  throws — each leaves the pages exactly as they are today, which is what the static Pages build
  needs. A browser suite (`test/e2e/sync.e2e.mjs`) holds that: no adapter, no console error, and a
  character still edited and persisted locally across a reload.

  **What the other repository still owns:** the OIDC dance, sessions, character envelopes with
  ownership, campaign invite codes, and the `client.js` implementing the adapter. The wire format is
  the existing save-file envelope, so an export is a valid upload and there is no second schema.
  Concurrency by a per-character version and `If-Match`. Writes stay **local-first**: `localStorage`
  always, then a queued push, so the UI never blocks on the network and play survives the wifi
  dying mid-session.

  **The real cost is still not the code.** It is owning uptime, backups and restores for data that
  today cannot be lost except by the user's own browser. Delegating identity to Authentik removes
  the worst of the liability, not all of it.

  **The service exists and all six of its phases are built**:
  <https://github.com/PrinzWalium/5etools-online>, whose plan (`docs/PLAN.md`) runs from an
  OIDC-only proof through characters, campaigns and roles, automatic push with conflict resolution,
  history and restore, to the party sheet — plus an account overview, a GM write loan, a sidekick
  the whole table can play, and handing a character to another player. The fork side of each landed
  with it: the status bubble, the Online panel and its first-sign-in migration, the campaign
  selector, the conflict dialog, the History view. None of it added an upstream conflict point.

  What is left there is **operations, not code**: nightly database backups with at least one
  rehearsed restore, and a per-user quota on characters and bytes that fails with a clear message
  rather than silently. Neither belongs in this repository, and neither changes a line here.

## Housekeeping

- [x] **A deployment can say which books it starts you with.** A self-hosted 5etools serves one
      table, and that table plays a particular set of books — but every new browser started with
      everything ticked and no homebrew, so the first thing anyone did was repeat the same twenty
      clicks across eleven filter panels. `DEFAULT_LOAD`, `DEFAULT_DENY` and `DEFAULT_BREW` in the
      Compose environment now decide it (`docs/DEFAULT_BOOKS.md`). There is no server to read a
      config file, so the answer reaches the browser as part of the page: the **image build**
      injects two script tags and leaves one world-writable config file, and **start-up** overwrites
      that file from the environment. Splitting it that way is what lets the container run as a
      non-root user, and start-up is never fatal — an unwritable config says which of its two causes
      it is and serves the site unconfigured. It **seeds and does not enforce**: a browser that has
      set its own filters keeps them, and anyone can tick a denied book back on.

- [x] **The last three unread fields.** A field-versus-code sweep had turned up three the app never
      looked at, and they turned out not to be uniform in value. `heightAndWeight` — 35 species
      carry a Random Height and Weight table — is now a *Roll* button beside the Appearance fields,
      with the range in its tooltip; the roll follows the book's actual rule, where the height roll
      *multiplies* the weight modifier rather than being rolled beside it, which is the difference
      between a tall character being heavy in proportion and being 118 lb. `primaryAbility` is a
      line in the guide's ability-score step, which is the one moment a new player wants to know
      where the 15 goes and the one place the class already said. And `traitTags` are shown on the
      species panel — but one of them was never cosmetic at all: **Powerful Build** counts a
      character as one size larger for carrying capacity, so fifteen species had been told, for the
      life of this feature, that they could carry half what they can.


- [x] **Panels watch the whole character, not a list of props.** Every panel used to name the props
      it re-rendered on, and the rule was that a panel watches every prop it renders. That rule was
      broken four separate times — a lineage, a class-granted feat, a size, an origin feat — each
      one showing an answer the player had already given until the page was reloaded. The list is
      invisible from the render code that depends on it and nothing checks the two agree, so it is
      the kind of convention that fails quietly. The small panels (species, background, Build Check)
      now re-render on any state change, debounced a frame so a burst collapses into one render
      (`charactersheet-panelrender.js`). The big ones keep explicit lists: their renders load entity
      data, and their props have not gone stale.

- [x] **Protect `main`.** Branch rulesets are in place for `main` and `beta`, so the
      "Sync fork → Discard commits" button can no longer wipe the fork.
      (It already did once; see `CHARACTER_SHEET_MAINTENANCE.md`.)
- [x] **Prove the nightly upstream sync.** It had fired — three times, all green — and proved
      nothing: upstream had not moved, so every run skipped ten of its twelve steps. Both real
      paths are now exercised by `scripts/rehearse-upstream-sync.sh`, which replays the workflow's
      own steps over a synthetic upstream in a throwaway clone: a clean merge (regenerates 56
      pages, lints, tests, would push) and a conflict in `js/navigation.js` (markers committed,
      nothing built, nothing pushed). Rehearsing the two side by side turned up a real defect —
      a conflicted night finished **green**, because the merge failure was swallowed by the step's
      own `if`, so the one morning needing attention looked like every other. It now ends red.
      The workflow also gained `force` / `dry_run` dispatch inputs, so the merge path can be run
      on demand instead of only on a night upstream happens to move, and it now lints
      `js/sidekick.js` along with the other two entry points.
- [x] **Port the remaining ad-hoc smokes.** All four are now `test/e2e/smokes.e2e.mjs`: a magic
      item's AC bonus appearing and going again with the armour, Expertise offered and claimed, a
      2024 background's origin feat, and the store surviving a reload with a second character beside
      it. Writing them corrected three assumptions about the app that were simply wrong: Expertise
      is *offered*, never taken automatically (the panel says "gain skill proficiencies first" when
      there is nothing to double), an origin feat is offered rather than forced, and the shared
      `resolveModals` helper clicks *Skip* by design — right for other suites, wrong for a suite
      whose subject is the optional grant, so this one accepts instead.


---

## Since this list was written

Two features that were not on it, kept here rather than retrofitted into a tier they were never
planned in.

- [x] **The 2024 books as the default.** The data says which entries a later printing supersedes,
      in `reprintedAs` — 361 PHB spells, 695 items, 65 subclasses, 13 classes, 50 feats, 97 species.
      `filterReprinted` drops an entry when its reprint is *also on offer*, and every picker applies
      it unless the character opts out (`isPreferReprints`, in the source filter). Two properties
      make it safe: it runs **after** the source filter, so a 2014-only character loses nothing —
      the 2024 reprint is not in the list to supersede it — and it only ever drops an entry whose
      replacement is present, so Artificer, most subclasses and whole books stay. A subclass's
      reprint uid carries its parent class in the middle
      (`"Berserker|Barbarian|XPHB|XPHB"`), which is why those 65 had been silent no-ops.

- [x] **Homebrew authoring.** Upstream's `makebrew.html` ships a builder framework with builders for
      creatures, spells and legendary groups, and nothing else. The fork adds **seven**: feat,
      language, background, species, item, subclass and class, on a shared `ForkBuilderBase` holding
      what is true of every kind. The point is not the JSON — it is that what a table writes lands in
      *fields*: a proficiency written as prose is invisible to the character sheet, and the same
      proficiency in `skillProficiencies` ticks a box.

      The two deep kinds share one obstacle. A class's `classFeatures` and a subclass's
      `subclassFeatures` are string refs into arrays a one-entity brew document has nowhere to put,
      so every ref would dangle. The loader short-circuits dereferencing when no element is a string
      or carries a feature key, so both write features **inline** — in different shapes, because a
      subclass's are read `.flat().filter(level)` and a class's are read `classFeatures[level - 1]`.

      `makebrew-account.js` is the hand-off: a *Save to Account* button sends the active source to
      the account system, which stores it opaquely and serves it as a **brew root** every 5etools
      page in the deployment can read. Nothing appears unless one is deployed on the same origin.
      The service's half, and the mirror still to build, are `docs/HOMEBREW.md` in
      <https://github.com/PrinzWalium/5etools-online>.
