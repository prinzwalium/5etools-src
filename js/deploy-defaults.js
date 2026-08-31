/**
 * Deploy-time defaults: which books a *new* visitor starts with.
 *
 * 5etools decides a source's default filter state in code (`PageFilterBase.defaultSourceSelFn`) and
 * remembers each visitor's own choices in their browser. That is right for the public site and wrong
 * for a table: a group that plays 2024-only, plus a handful of homebrew, wants every new browser to
 * start that way rather than repeat the same twenty clicks on eleven pages.
 *
 * So this reads a small config written at container start from the Compose environment, and applies
 * it before the filters are built.
 *
 * **It seeds; it does not enforce.** A default only decides the state of a pill nobody has touched —
 * anyone who has used the site keeps their own saved filters, and anyone can tick a denied book back
 * on. Forcing the list on every load would override a deliberate choice, which is a different
 * feature and a worse one.
 *
 * The config arrives as a global rather than a `fetch`, because the source filter is built during
 * page init and an awaited round-trip loses that race about half the time. `docker/entrypoint.sh`
 * writes it as a one-line classic script and injects both tags into the served HTML — so nothing
 * here is imported by a page, and the fork's four upstream merge-conflict points stay four.
 */

/** Where the entrypoint leaves the parsed environment. */
export const CONFIG_GLOBAL = "DEPLOY_DEFAULTS";

/** Remembers which listed homebrew this browser has installed, so each book is fetched once. */
export const STORAGE_KEY_BREW = "deployDefaults_brewInstalled";

/**
 * Normalise the config, whatever the environment handed us.
 *
 * Sources are upper-cased because that is how the data spells them (`PHB`, `XPHB`) and how somebody
 * typing an env var will not. Homebrew names keep their case — they are titles, not codes.
 *
 * @return {{allow: Array<string>, deny: Array<string>, brew: Array<string>, isConfigured: boolean}}
 */
export function parseDeployConfig (raw) {
	const asList = val => {
		if (val == null) return [];

		// A semicolon anywhere makes semicolons *the* separator, rather than one of two. Book
		// titles contain commas — "The Griffon's Saddlebag, Book 1" is one book — so splitting on
		// both would quietly halve a list somebody had punctuated correctly.
		const arr = Array.isArray(val)
			? val
			: String(val).includes(";") ? String(val).split(";") : String(val).split(",");

		return arr.map(it => String(it).trim()).filter(Boolean);
	};

	const allow = asList(raw?.allow ?? raw?.defaultLoad).map(it => it.toUpperCase());
	const deny = asList(raw?.deny ?? raw?.defaultDeny).map(it => it.toUpperCase());
	const brew = asList(raw?.brew ?? raw?.defaultBrew);

	return {allow, deny, brew, isConfigured: !!(allow.length || deny.length || brew.length)};
}

/**
 * Whether a source should start selected.
 *
 * `deny` beats `allow`, because a deny list is the stricter statement and the one somebody reaches
 * for when a book must not appear. An `allow` list, when given, is exhaustive: naming the books you
 * play with means the others are off, which is the whole point of naming them. With no `allow` list
 * the site's own default stands, minus anything denied.
 *
 * @param fnDefault the upstream default, called when nothing here has an opinion.
 */
export function isSourceDefaultSelected (source, {allow, deny}, fnDefault) {
	const src = String(source?.item ?? source ?? "").toUpperCase();
	if (!src) return !!fnDefault?.(source);

	if (deny.includes(src)) return false;
	if (allow.length) return allow.includes(src);
	return !!fnDefault?.(source);
}

/** Homebrew named in the config that this browser has not installed yet. */
export function getBrewToInstall ({brew, installed}) {
	const have = new Set((installed || []).map(it => String(it).toLowerCase()));
	return (brew || []).filter(it => !have.has(String(it).toLowerCase()));
}

/**
 * Every brew index entry a configured name asks for.
 *
 * Matched loosely, and returning a list, because both are what the names people write mean. Somebody
 * putting `Grim Hollow` in a Compose file is naming a shelf — three books — while `Humblewood
 * Campaign Setting` names one; and neither is spelled the way the index keys it, which is
 * `"Author; Title.json"`. So: an exact title wins alone, and short of that every book whose title,
 * filename or source code starts with — failing that, contains — the name.
 */
export function findBrewsInIndex (name, indexEntries) {
	const needle = String(name).trim().toLowerCase();
	if (!needle || !indexEntries?.length) return [];

	const namesOf = it => [
		it?._brewName,
		String(it?.name ?? "").replace(/\.json$/i, ""),
		...(it?.sources || []),
	].filter(Boolean).map(pt => String(pt).toLowerCase());

	const exact = indexEntries.find(it => namesOf(it).includes(needle));
	if (exact) return [exact];

	const startsWith = indexEntries.filter(it => namesOf(it).some(pt => pt.startsWith(needle)));
	if (startsWith.length) return startsWith;

	return indexEntries.filter(it => namesOf(it).some(pt => pt.includes(needle)));
}

/* -------------------------------------------- the wiring -------------------------------------------- */

/**
 * Read the config and apply it. On a page with no config, this does nothing at all.
 *
 * Kept apart from the pure functions above so importing this module has no side effects, which is
 * what lets the decisions be unit-tested without a browser.
 */
export function initDeployDefaults () {
	const raw = globalThis[CONFIG_GLOBAL];
	if (!raw) return;

	const config = parseDeployConfig(raw);
	if (!config.isConfigured) return;

	_applySourceDefaults(config);
	// Deliberately not awaited: a slow homebrew download must not hold up the page
	_pInstallBrew(config).catch(() => {});
}

/**
 * Wrap the site's own default, rather than replacing it.
 *
 * Every source filter asks these for the state of a pill it has nothing saved for, so wrapping them
 * covers every page at once — and keeps upstream's answer for every source the config says nothing
 * about, including homebrew the visitor added themselves. The `…StandardPartnered` variant is the
 * one used when "deselect homebrew by default" is on; a denied book has to stay denied there too.
 */
function _applySourceDefaults (config) {
	if (typeof PageFilterBase === "undefined") return;

	["defaultSourceSelFn", "defaultSourceSelFnStandardPartnered"].forEach(prop => {
		const fnUpstream = PageFilterBase[prop].bind(PageFilterBase);
		PageFilterBase[prop] = source => isSourceDefaultSelected(source, config, fnUpstream);
	});
}

async function _pInstallBrew (config) {
	if (!config.brew.length || typeof BrewUtil2 === "undefined") return;

	const installed = (typeof StorageUtil !== "undefined" && await StorageUtil.pGet(STORAGE_KEY_BREW)) || [];
	const wanted = getBrewToInstall({brew: config.brew, installed});
	if (!wanted.length) return;

	const index = await BrewUtil2.pGetCombinedIndexes().catch(() => null);
	const added = [];
	let cntBooks = 0;

	for (const name of wanted) {
		// A full URL is taken as given; anything else is a name to look up
		const urls = /^https?:\/\//i.test(name)
			? [name]
			: findBrewsInIndex(name, index || []).map(it => it.urlDownload).filter(Boolean);
		if (!urls.length) continue;

		let isAnyAdded = false;
		for (const url of urls) {
			try {
				await BrewUtil2.pAddBrewFromUrl(url, {isLazy: true});
				isAnyAdded = true;
				++cntBooks;
			} catch (e) {
				// One unreachable book must not stop the rest
			}
		}
		// Recorded by the *configured* name: renaming it in the config installs it again, rather
		// than silently not
		if (isAnyAdded) added.push(name);
	}

	if (!added.length) return;

	await BrewUtil2.pAddBrewsLazyFinalize().catch(() => {});
	if (typeof StorageUtil !== "undefined") await StorageUtil.pSet(STORAGE_KEY_BREW, [...installed, ...added]);

	if (typeof JqueryUtil !== "undefined") {
		JqueryUtil.doToast(`Loaded ${cntBooks} homebrew book${cntBooks === 1 ? "" : "s"} for this server.`);
	}
}

// The injected tag loads this module; nothing else imports it
initDeployDefaults();
