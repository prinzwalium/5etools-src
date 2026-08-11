# The account system — what this repo provides, and what it expects

The account system is **a separate project**: <https://github.com/PrinzWalium/5etools-online>. This repository holds only the seam it plugs into
(`js/charactersheet/charactersheet-sync.js` plus a loader in `charactersheet-pagebase.js`), so that
the fork stays easy to update from upstream and every later sync feature ships from the other
repository instead of this one.

This document is the contract. It is written for whoever builds that other project.

---

## The shape of the deployment

One subdomain, a reverse proxy in front, two things behind it:

```
https://tools.example.com/            → the 5etools fork (static, this repo's Docker image)
https://tools.example.com/online/*    → the account system (its own container)
```

Same origin is the whole point:

- the browser's own session cookie authenticates every API call, so the client never holds a
  credential and there is nothing in `localStorage` to leak;
- there is no CORS to configure and no per-deployment client config to ship.

An absolute URL on another origin is *accepted* by the path config, but the session cookie will
likely not be sent — the page warns and carries on rather than pretending it works.

## Where it is mounted

The path is configuration, not a constant. Resolved most specific first:

1. `window.CHARACTER_SYNC_PATH` — for a `config.js` an image can drop in
2. `<meta name="character-sync-path" content="/online">` — easy for a reverse proxy to inject
3. `/online` — the default

Setting either source to `""`, `"off"` or `"none"` switches sync off entirely.

## What the pages do

During `pInit`, before the page builds, `_pLoadSyncAdapter` loads `<base>/client.js` and looks for
`window.CharacterSyncAdapter`.

**Every failure is silent and inert.** No account system deployed, a 404, a script that throws —
each leaves the pages exactly as they are without one. That is a supported deployment, not a
degraded one: the GitHub Pages build is static, with no proxy in front. Only one case is reported,
because it is a mistake rather than a choice: an adapter that exists but does not implement the
whole contract, which is refused with the missing method names rather than allowed to take storage
over and then fail partway.

## The adapter

`<base>/client.js` must define:

```js
window.CharacterSyncAdapter = {
	// → {id, name} | null   (null means "not signed in")
	async pWhoAmI () {},

	// → [{id, name, version, updatedAt, isSidekick, isMine, control, campaignId}]
	// `isMine` and `control` only matter for a sidekick shared with a table; an entry that says
	// nothing is the caller's own, which is what an older service's reply means. `campaignId` is
	// what a browser that has only just pulled a character knows its table from
	async pList () {},

	// → {envelope, version}
	async pLoad (id) {},

	// → {version}; throw SyncConflictError when the server holds a newer version
	async pSave (id, envelope, {version}) {},

	async pDelete (id) {},

	// where to send someone to sign in — the OIDC dance is entirely the account app's business
	getLoginUrl () {},

	// optional
	getLogoutUrl () {},

	// optional; what the service can actually do *today*, as opposed to what the shape implies
	getCapabilities () { return {characters: true}; },
};
```

`envelope` is **the existing save-file envelope**, unchanged. A *Save to File* export is therefore a
valid upload, and there is no second schema to keep in step with this one.

The five `p*` methods are required; an adapter missing any of them is refused.

`getCapabilities` is how an account system that is still being built stays honest. Defining the five
methods only proves the right *shape*; a service can have sign-in working while character storage is
not open yet. Returning `{characters: false}` says so, and the badge then reads "this browser is
still the only copy" instead of promising storage that would fail on first use. An adapter that says
nothing is taken at its word that everything works.

## The badge

When — and only when — an account system answers, the three pages grow a badge in the toolbar
(`#cs-sync-badge`, built by the page base so the pages cannot drift). It has three states:

| State | Reads | Meaning |
| --- | --- | --- |
| `signedIn` | *Online — Ada* | `pWhoAmI()` returned somebody. Amber, not green, if `characters` is false |
| `signedOut` | *Signed out* | The service answered; nobody is signed in. Clicking offers `getLoginUrl()` |
| `error` | *Offline* | The adapter is incomplete, or `pWhoAmI()` threw. Clicking shows the error itself |

Clicking it opens the whole truth: the path it looked at, who the server says you are, the role, and
whatever went wrong. That is the point — a connection problem should be readable on purpose rather
than found in the console.

**With no account system deployed there is no badge at all.** Decorating a static build with a red
badge would report the absence of a feature as a fault.

## Push and pull

Clicking the badge, when signed in to a service that stores characters, opens the panel that moves
them. Each character is listed as being **in both**, **this browser only**, or **online only**, with
a *Push* / *Pull* button as appropriate, plus one button to upload everything not yet online — which
is what a first sign-in amounts to.

**Nothing moves on its own, in either direction.** Deciding which side is "newer" would mean
trusting clocks across two devices and a server, and being wrong once means overwriting somebody's
evening. `planSync` therefore reports only *where* each character is and leaves the choice to a
person.

A push states the version it is replacing — remembered per character in the store's `syncMeta`. If
the server holds a newer one it refuses, and the page asks:

| Choice | What happens |
| --- | --- |
| Keep this browser's copy | Save again over the version the server actually holds |
| Keep the online copy | The server's envelope replaces the local one |
| Keep both | The local copy becomes a **new character**, renamed *(this device)*, and is uploaded; the original takes the server's copy |

*Keep both* is the safety valve: it is the only answer that cannot lose anything, and the one to
reach for mid-session.

There is no merge. A character is one document, and mine/theirs/both are the only honest options.

### Automatic push

A character the server already knows about uploads itself. Edits queue, debounced (4s quiet, forced
after 30s so a long session still saves), and flush on `visibilitychange`/`pagehide` so locking a
phone does not lose the last few seconds. The badge reads *Unsaved (n)*, then *Saving…*, then goes
back to naming you.

Two limits, both deliberate:

- **Only characters already online.** Signing in must never silently upload everything in a browser;
  the first upload stays an explicit act.
- **Push only.** Downloading over what is on screen is always a decision.

A failed push keeps the character queued and retries — a minute offline must not cost the session —
and reports itself once rather than on every attempt. A conflict still opens the same dialog.

The whole thing can be switched off in the panel (`syncAuto` in the store); it is something the page
does on your behalf, so it is yours to stop.

## History

A character that is in both places grows a *History* button. The list is timestamps — that is all
the server can honestly label a snapshot with, since it does not read inside an envelope — and
*Look* fetches one and shows what the character **was**, computed here from the same rules the sheet
uses. A restore is then a decision made after looking rather than a guess at a date.

**Restoring writes forward**: the old contents become a new version, so the restore is itself in the
history and itself undoable. The browser pulls straight afterwards, because the point of restoring
is to be looking at the restored character.

Only whoever may *write* the character can see its history — its owner, or the table a sidekick was
handed to — and an admin. Not a GM of a player's character, not the rest of the table, whatever
party visibility says.

## Tables

When the adapter does campaigns, the panel grows a **Tables** section: the campaigns you belong to
with the role you hold, a *New table*, a *Join with a code*, and — for a GM — an *Invite* that mints
a code. The current character's table is a dropdown there rather than a field on the sheet, because
which table a character sits at is an account-system fact, not part of the character. It stays
disabled until the character has been uploaded, since there is nothing to place otherwise.

*Characters* on a table lists the party; opening one shows a **read-only card**.

### A sidekick the table can play

A sidekick is the one thing at a table that is not read-only. A GM builds one and the players
usually command it, the GM taking it over for narrative moments — so when the current character is a
**sidekick that sits at a table**, the Tables section offers *Let the table play this sidekick*.
Checked, every member of that table gets it in their own character list and writes the same copy;
there is one of it, not a copy each. It stays the GM's: they can take it back, and only they can
delete it or move it. Moving it to another table resets it, because being handed to one table is not
consent to be handed to the next.

A sidekick somebody else shared shows as *shared with you* in the character list, with no share link
offered — it is theirs to play, not theirs to publish.

The whole offer appears only when the adapter implements `pSetCharacterControl`; a service with
tables but not this is an ordinary older deployment.

That card is read-only *by construction*, not by a flag. `charactersheet-summary.js` takes a plain
state, computes with the same pure modules the sheet uses, and returns values — no model, no store,
no path by which a GM looking at a sheet could change it. The server enforces the same rule from the
other side. It is also the groundwork for the party sheet, which asks the same question of several
characters at once.

## Endpoints the client script is expected to use

Given a base of `/online`, `getSyncEndpoints` documents the shape:

| Purpose | Path |
| --- | --- |
| Who is signed in | `/online/api/whoami` |
| Begin sign-in | `/online/login` |
| Sign out | `/online/logout` |
| List / create characters | `/online/api/characters` |
| One character | `/online/api/characters/:id` |

These are a convention for the other project, not something this repo calls directly — the adapter
is free to do otherwise as long as it satisfies the contract above.

## Authentication

**OIDC against an existing Authentik instance.** The account app is a confidential OIDC client and
owns the whole flow; this fork never sees a token, an identity, or a password. It only ever learns
whether `pWhoAmI()` answers.

That is deliberate: it means nothing in this repository — and nothing in the account app either —
has to store password hashes, or own resets and revocation.

## Rules for the other project to honour

- **Local-first, never server-first.** Write `localStorage` always, then queue a push. The UI must
  never block on the network: play has to survive the wifi dying mid-session.
- **Single-writer conflicts.** Concurrency by a per-character version and `If-Match`. On a clash,
  throw `SyncConflictError` carrying the server's version and envelope so the user can be asked
  *keep mine / take theirs*. Do not attempt a merge — characters are single-writer in practice.
- **Own the character, not the rules.** The account app stores envelopes. It should never need to
  understand a class, a spell or a level.

## Testing it from this side

- `test/jest/CharacterSheetSync.test.js` — the path resolution, the contract check, the conflict
  error.
- `test/e2e/sync.e2e.mjs` — the no-account-system state: nothing picked up, nothing logged, and a
  character still edited and persisted locally across a reload.

When there is an account app to test against, point a dev proxy at it and add a suite beside those.
