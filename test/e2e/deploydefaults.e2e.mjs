/**
 * The deploy-time default books, in a real page.
 *
 * The unit tests cover the decisions; what they cannot cover is whether wrapping
 * `PageFilterBase.defaultSourceSelFn` actually reaches the source filter a page builds — which
 * depends on script order, on the page booting from `window.onload`, and on the filter having
 * nothing saved to prefer. That is the half that would break silently, so it is checked here, with
 * the tags injected exactly the way `docker/inject-defaults.sh` injects them at build time.
 */

import {BASE_URL} from "./util-e2e.mjs";

/** What the entrypoint writes and injects, reproduced here so the two cannot drift unnoticed. */
const SNIPPET = config => `<script type="text/javascript">globalThis.DEPLOY_DEFAULTS = ${JSON.stringify(config)};</script>`
	+ `<script type="module" src="js/deploy-defaults.js"></script>`;

async function pOpenWithConfig (browser, config, {url = `${BASE_URL}/spells.html`} = {}) {
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", e => errors.push(e.message));
	page.errors = errors;

	// The container edits the file on disk; here the same edit is made to the response
	await page.route(url, async route => {
		const resp = await route.fetch();
		const body = (await resp.text()).replace("</body>", `${SNIPPET(config)}</body>`);
		await route.fulfill({response: resp, body, headers: {...resp.headers(), "content-length": undefined}});
	});

	await page.goto(url, {waitUntil: "load"});
	// A fresh profile each time, so nothing saved outranks the default
	await page.evaluate(() => localStorage.clear());
	await page.reload({waitUntil: "load"});
	await page.waitForTimeout(2500);
	return page;
}

/** The source filter's own state, as the page built it. */
const getSourceState = page => page.evaluate(() => {
	const filter = globalThis.dbg_page?._pageFilter?._sourceFilter;
	return filter ? JSON.parse(JSON.stringify(filter._state)) : null;
});

export async function run ({browser, check}) {
	/* ---------- a deny list ---------- */

	const page = await pOpenWithConfig(browser, {allow: "", deny: "PHB,MM,DMG", brew: ""});

	const wrapped = await page.evaluate(() => ({
		phb: PageFilterBase.defaultSourceSelFn("PHB"),
		xphb: PageFilterBase.defaultSourceSelFn("XPHB"),
		scag: PageFilterBase.defaultSourceSelFn("SCAG"),
	}));
	check("a denied book stops being a default", wrapped.phb === false, JSON.stringify(wrapped));
	check("its 2024 replacement is untouched", wrapped.xphb === true);
	check("and so is every book the config never mentions", wrapped.scag === true);

	const state = await getSourceState(page);
	check("the page's own source filter was built with it", state && state.PHB !== state.XPHB, JSON.stringify({PHB: state?.PHB, XPHB: state?.XPHB}));
	check("the denied book is deselected", !state?.PHB, `PHB=${state?.PHB}`);
	check("the 2024 book is selected", !!state?.XPHB, `XPHB=${state?.XPHB}`);
	check("the page raised no errors", page.errors.length === 0, page.errors.slice(0, 2).join(" | "));

	await page.close();

	/* ---------- an allow list is exhaustive ---------- */

	const pageAllow = await pOpenWithConfig(browser, {allow: "XPHB", deny: "", brew: ""});
	const stateAllow = await getSourceState(pageAllow);
	check("naming books turns the rest off", !!stateAllow?.XPHB && !stateAllow?.PHB && !stateAllow?.SCAG,
		JSON.stringify({XPHB: stateAllow?.XPHB, PHB: stateAllow?.PHB, SCAG: stateAllow?.SCAG}));
	await pageAllow.close();

	/* ---------- and an unconfigured page is the site as it was ---------- */

	const pagePlain = await pOpenWithConfig(browser, {allow: "", deny: "", brew: ""});
	const statePlain = await getSourceState(pagePlain);
	check("an empty config changes nothing", !!statePlain?.PHB && !!statePlain?.XPHB,
		JSON.stringify({PHB: statePlain?.PHB, XPHB: statePlain?.XPHB}));
	await pagePlain.close();
}
