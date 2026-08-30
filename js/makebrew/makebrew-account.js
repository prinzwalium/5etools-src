import {getSyncBasePath, getSyncClientUrl} from "../charactersheet/charactersheet-sync.js";

/**
 * The hand-off: getting homebrew authored here into the account system.
 *
 * Everything `makebrew.html` saves lives in this browser and nowhere else. That is fine for one
 * person on one machine and useless for a table — which is the whole reason
 * `PrinzWalium/5etools-online` grew a homebrew store. This module is the seam between them, and it
 * is deliberately the only place in the fork that knows the account system has one.
 *
 * The same rules as character sync apply, for the same reasons:
 *
 *  - **With nothing deployed, nothing happens.** The script 404s, the button is never built, and
 *    `makebrew.html` behaves exactly as upstream's does. That is a supported deployment, not a
 *    fallback: the GitHub Pages build is static with no proxy in front of it.
 *  - **The browser decides what a brew contains**, and sends that along as a summary. The service
 *    stores the document opaquely and could not tell a feat from a spell — so if it had to work out
 *    what was inside, the two repositories would be coupled again.
 *
 * What is sent is one *source*: everything authored under the source currently selected, gathered
 * into a brew document of its own. That is the unit the account system stores and the unit
 * `BrewUtil2` installs, so it is the unit to hand over.
 */

/** Props that are bookkeeping rather than content. */
const _META_PROPS = new Set(["_meta", "siteVersion"]);

/**
 * The brew document for one source, built out of the editable brew.
 *
 * A person's editable brew can hold several sources at once — they wrote a feat for one table and a
 * species for another — so what goes to the account system is filtered down to the source they are
 * looking at. Entities carry their own `source`, which is what makes that possible without this
 * function knowing what any of them are.
 */
export function getBrewDocumentForSource ({brewDoc, source, sourceMeta}) {
	const body = brewDoc?.body || {};
	const out = {
		_meta: {
			sources: [MiscUtil.copyFast(sourceMeta || {json: source})],
			dateAdded: Math.round(Date.now() / 1000),
			dateLastModified: Math.round(Date.now() / 1000),
			...(body._meta?.edition ? {edition: body._meta.edition} : {}),
		},
	};

	Object.entries(body)
		.filter(([prop]) => !_META_PROPS.has(prop))
		.forEach(([prop, arr]) => {
			if (!Array.isArray(arr)) return;
			const mine = arr.filter(it => (it?.source || "").toLowerCase() === String(source).toLowerCase());
			if (mine.length) out[prop] = MiscUtil.copyFast(mine);
		});

	return out;
}

/**
 * What the *browser* found inside the document, which is the only thing the service is told about
 * its contents. Props, how many of each, and which ruleset — enough to build an index and to draw a
 * listing, and not rules knowledge.
 */
export function getBrewSummary (document) {
	const props = Object.keys(document || {}).filter(prop => !_META_PROPS.has(prop) && Array.isArray(document[prop]));
	return {
		props,
		counts: props.mergeMap(prop => ({[prop]: document[prop].length})),
		edition: document?._meta?.edition === "classic" ? "classic" : "one",
	};
}

/** Whether there is anything to send at all. An empty source is a button that would do nothing. */
export const isBrewDocumentEmpty = document => !getBrewSummary(document).props.length;

/* -------------------------------------------- */

/**
 * Load the account system's client script, if one is deployed there.
 *
 * The same script the character pages load, and the same silence when it is absent — this is the
 * ordinary state of a deployment with no account system, not an error worth a toast.
 */
async function _pLoadAdapter () {
	if (window.CharacterSyncAdapter) return window.CharacterSyncAdapter;

	const url = getSyncClientUrl(getSyncBasePath());
	if (!url) return null;

	try {
		await new Promise((resolve, reject) => {
			const script = document.createElement("script");
			script.src = url;
			script.async = true;
			script.onload = resolve;
			script.onerror = () => reject(new Error("no account system is deployed there"));
			document.head.appendChild(script);
		});
	} catch (e) {
		return null;
	}

	return window.CharacterSyncAdapter || null;
}

/** An adapter that predates the homebrew routes is an ordinary older deployment, not a broken one. */
const _hasBrewSupport = adapter => typeof adapter?.pCreateBrew === "function" && typeof adapter?.pListBrews === "function";

/* -------------------------------------------- */

/**
 * Build the *Save to my account* button, if there is an account system that can take one.
 *
 * Returns null when there is not, which is how `makebrew.js` stays a two-line change: it appends
 * whatever this gives it, and nothing is what it usually gets.
 */
export async function pGetAccountButton ({ui}) {
	const adapter = await _pLoadAdapter();
	if (!_hasBrewSupport(adapter)) return null;

	const btn = veT`<button class="ve-btn ve-btn-xs ve-btn-default ve-mr-2" title="Send this source's homebrew to your account, so your table can use it">Save to Account</button>`
		.vee.onn("click", () => pSaveActiveSource({ui, adapter}));

	return btn;
}

/**
 * Send the active source to the account system, creating it or replacing what is there.
 *
 * Matching by source rather than by id is what makes this idempotent across browsers: somebody who
 * saves from their laptop and then from their desktop has updated one brew, not made two — and two
 * brews claiming one source code is the collision the brew index cannot resolve.
 */
export async function pSaveActiveSource ({ui, adapter}) {
	const source = ui.source;
	if (!source) return JqueryUtil.doToast({type: "warning", content: "Choose a source first."});

	const user = await adapter.pWhoAmI().catch(() => null);
	if (!user) {
		return JqueryUtil.doToast({
			type: "warning",
			content: `<div>You are not signed in. <a href="${adapter.getLoginUrl()}">Sign in</a> and try again.</div>`,
		});
	}

	const brewDoc = await BrewUtil2.pGetEditableBrewDoc();
	const document = getBrewDocumentForSource({
		brewDoc,
		source,
		sourceMeta: BrewUtil2.sourceJsonToSource(source),
	});

	if (isBrewDocumentEmpty(document)) {
		return JqueryUtil.doToast({type: "warning", content: `Nothing has been saved under "${source}" yet.`});
	}

	const summary = getBrewSummary(document);
	const name = BrewUtil2.sourceJsonToFull(source) || source;

	try {
		const existing = (await adapter.pListBrews()).find(it => it.isMine && it.source === source);

		const saved = existing
			? await adapter.pSaveBrew(existing.id, {name, document, summary, version: existing.version})
			: await adapter.pCreateBrew({name, source, document, summary});

		const what = summary.props.map(prop => `${summary.counts[prop]} ${prop}`).join(", ");
		JqueryUtil.doToast({
			type: "success",
			content: `Saved "${name}" to your account (${what}). Share it with a table from the account page.`,
		});
		return saved;
	} catch (e) {
		// A conflict here means somebody else's browser saved the same source in between, which is a
		// thing to say plainly rather than to resolve behind their back
		const content = e?.status === 409
			? `"${name}" was saved elsewhere since this page loaded. Reload and try again.`
			: `Could not save to your account: ${e.message}`;
		JqueryUtil.doToast({type: "danger", content});
		return null;
	}
}
