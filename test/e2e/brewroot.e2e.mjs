/**
 * A brew root that is not the 5etools homebrew repository.
 *
 * The whole homebrew plan rests on one claim: `BrewUtil2` will take any URL as its brew root, and
 * that root is five index files plus the documents they name. If that is true, the account system
 * can *be* the brew root and approved homebrew reaches every page with no client change and no
 * GitHub at runtime. If it is false, the plan needs rewriting — so it is worth falsifying cheaply,
 * and worth a standing test so it stays true across upstream merges.
 *
 * The tree under `test/e2e/fixture-brewroot/` is the same layout `PrinzWalium/5etools-homebrew`
 * holds, so what passes here is what that repository serves.
 *
 * Homebrew lives in the browser's own storage rather than the character store, so this suite runs
 * in a context of its own: a brew installed here must not follow the other suites around.
 */

import {BASE_URL, openPage} from "./util-e2e.mjs";

const BUILDER_URL = `${BASE_URL}/charbuilder.html`;
const BREW_ROOT = `${BASE_URL}/test/e2e/fixture-brewroot/`;

const storeOf = state => JSON.stringify({storeVersion: 1, currentId: "e2e", characters: {e2e: {version: 2, state}}});

export async function run ({browser, check}) {
	const context = await browser.newContext();
	const page = await openPage(context, {url: BUILDER_URL, state: storeOf({name: "Brew Tester", level: 1})});
	await page.waitForTimeout(4000);

	// ---------- the five indexes are all a root has to answer ----------
	const indexes = await page.evaluate(async root => {
		const names = [
			"index-sources.json", "index-props.json", "index-meta.json",
			"index-timestamps.json", "index-adventure-book-ids.json",
		];
		const out = {};
		for (const n of names) {
			const res = await fetch(`${root}_generated/${n}`);
			out[n] = res.ok ? await res.json() : null;
		}
		return out;
	}, BREW_ROOT);

	check("the root answers every index the loader asks for",
		Object.values(indexes).every(Boolean), JSON.stringify(Object.keys(indexes).filter(k => !indexes[k])));
	check("and names the source it publishes", !!indexes["index-sources.json"]?.HBExample, JSON.stringify(indexes["index-sources.json"]));

	// ---------- point the page at it ----------
	// Setting the custom URL reloads the page as its last act, which kills the evaluate; the
	// storage write is what matters, so let the navigation happen and wait for the page back
	await page.evaluate(root => { BrewUtil2.pSetCustomUrl(root); }, BREW_ROOT).catch(() => {});
	await page.waitForLoadState("load");
	await page.waitForTimeout(4000);

	const listed = await page.evaluate(async () => {
		const all = await BrewUtil2.pGetCombinedIndexes();
		return (all || []).map(it => ({name: it._brewName, author: it._brewAuthor, props: it.props, sources: it.sources, urlDownload: it.urlDownload}));
	});

	check("the manager lists what the root publishes", listed.length === 1, JSON.stringify(listed));
	check("with its name and author read off the filename",
		listed[0]?.name === "Example" && listed[0]?.author === "5etools-homebrew", JSON.stringify(listed[0]));
	check("and knows which source and which kind of thing it holds",
		(listed[0]?.props || []).includes("feat") && (listed[0]?.sources || []).includes("HBExample"), JSON.stringify(listed[0]));

	// ---------- installing it ----------
	await page.evaluate(async url => { await BrewUtil2.pAddBrewFromUrl(url); }, listed[0].urlDownload);

	// A fresh load, because what matters is that the brew is *there* on the next visit, not that
	// the tab that installed it happens to hold it in memory
	await page.reload({waitUntil: "load"});
	await page.waitForTimeout(5000);

	const isStored = await page.evaluate(async () => {
		const brew = await BrewUtil2.pGetBrewProcessed();
		return (brew.feat || []).some(it => it.name === "Cellar Sense" && it.source === "HBExample");
	});
	check("the brew is still installed after a reload", isStored);

	// ---------- and it reaches the builder's own picker ----------
	const isOffered = await page.evaluate(async () => {
		const mod = await import("./js/charactersheet/charactersheet-classdata.js");
		const feats = await mod.CharacterSheetClassData.pGetAllFeatsUnfiltered();
		return feats.some(it => it.name === "Cellar Sense" && it.source === "HBExample");
	});
	check("a homebrew feat is offered beside the books", isOffered);

	check("no page errors", page.errors.length === 0, page.errors.join("\n"));
	await context.close();
}
