/**
 * The 2024 books as the default.
 *
 * Where the new books reprint something, only that printing is offered; anything they never
 * reprinted is left exactly where it was. Both halves matter, and only the running page can show
 * them: the picker is what a player actually sees.
 */

import {BASE_URL, getState, openPage} from "./util-e2e.mjs";

const BUILDER_URL = `${BASE_URL}/charbuilder.html`;

const storeOf = state => JSON.stringify({storeVersion: 1, currentId: "e2e", characters: {e2e: {version: 2, state}}});

/** Every option in the picker the given button opens. */
async function pGetClassOptions (page) {
	await page.click("#cs-pick-class");
	await page.waitForFunction(() => {
		const sel = document.querySelector(".ve-ui-modal__overlay select");
		return sel && sel.options.length > 5;
	}, {timeout: 20000});
	const labels = await page.locator(".ve-ui-modal__overlay select option").allTextContents();
	await page.keyboard.press("Escape");
	await page.waitForTimeout(400);
	return labels.map(it => it.trim());
}

export async function run ({browser, check}) {
	const page = await openPage(browser, {url: BUILDER_URL, state: storeOf({name: "Reprint Tester", level: 1})});
	await page.waitForTimeout(5000);

	// ---------- superseded printings are gone ----------
	const labels = await pGetClassOptions(page);
	const has = re => labels.some(it => re.test(it));

	check("the 2024 Fighter is offered", has(/Fighter \(PHB'24\)/), labels.join(" | ").slice(0, 300));
	check("and the 2014 one it replaces is not", !has(/Fighter \(PHB'14\)/), labels.filter(it => /Fighter/.test(it)).join(" | "));

	// ---------- what the new books never reprinted stays ----------
	check("a class the 2024 books never printed is still there", has(/Artificer/), labels.filter(it => /Artificer/.test(it)).join(" | "));

	// ---------- and it can be turned off ----------
	await page.click("#cs-btn-sources");
	await page.waitForTimeout(900);
	const cb = page.locator(".ve-ui-modal__overlay input[type=checkbox]").first();
	check("the sources dialog offers the preference", await cb.count() === 1 || await cb.isVisible());
	check("which starts on", await cb.isChecked());

	await cb.uncheck();
	await page.locator(".ve-ui-modal__overlay button:has-text('Save')").click();
	await page.waitForTimeout(1200);

	const state = await getState(page);
	check("turning it off is stored on the character", state?.sourceFilter?.isPreferReprints === false, JSON.stringify(state?.sourceFilter));

	const labelsAfter = await pGetClassOptions(page);
	check("and both printings come back",
		labelsAfter.some(it => /Fighter \(PHB'14\)/.test(it)) && labelsAfter.some(it => /Fighter \(PHB'24\)/.test(it)),
		labelsAfter.filter(it => /Fighter/.test(it)).join(" | "));

	check("no page errors", page.errors.length === 0, page.errors.join("\n"));
	await page.close();
}
