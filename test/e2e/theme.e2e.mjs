/**
 * A theme chosen per character, in the running page.
 *
 * The point of this feature only exists at runtime: the choice has to survive a reload, follow the
 * character rather than the browser, and put itself back when you switch between two characters
 * that want different things.
 */

import {BASE_URL, getState, openPage} from "./util-e2e.mjs";

const SHEET_URL = `${BASE_URL}/charactersheet.html`;
const BUILDER_URL = `${BASE_URL}/charbuilder.html`;

const storeOf = characters => JSON.stringify({storeVersion: 1, currentId: "a", characters});

const TWO_CHARACTERS = {
	a: {version: 2, state: {name: "Bright One", level: 1, theme: "parchment"}},
	b: {version: 2, state: {name: "Dark One", level: 1, theme: "arcane"}},
};

export async function run ({browser, check}) {
	const page = await openPage(browser, {url: SHEET_URL, state: storeOf(TWO_CHARACTERS)});
	await page.waitForTimeout(4000);

	// ---------- the picker is there, and reads the character's own theme ----------
	const sel = page.locator("#cs-theme-select");
	check("the sheet offers a theme picker", await sel.count() === 1);
	check("set to what this character carries", await sel.inputValue() === "parchment", await sel.inputValue());

	const hasAccent = name => page.evaluate(n => document.body.classList.contains(n), name);
	check("and the character's tint is on the page", await hasAccent("cs-theme--parchment"));
	check("a light theme leaves the page light",
		!(await page.evaluate(() => document.documentElement.classList.contains("ve-night-mode"))));

	// ---------- switching character brings its own ----------
	await page.selectOption("#cs-char-select", "b");
	await page.waitForTimeout(2000);

	check("switching character puts the other one's theme on", await hasAccent("cs-theme--arcane"));
	check("and takes the first one's off", !(await hasAccent("cs-theme--parchment")));
	check("a dark theme darkens the page",
		await page.evaluate(() => document.documentElement.classList.contains("ve-night-mode")));

	// ---------- changing it is stored on the character ----------
	await page.selectOption("#cs-theme-select", "verdant");
	await page.waitForTimeout(1500);

	check("choosing another applies it at once", await hasAccent("cs-theme--verdant"));
	const state = await getState(page);
	check("and it is stored on the character, not the browser", state?.theme === "verdant", state?.theme);

	await page.reload({waitUntil: "load"});
	await page.waitForTimeout(4000);
	check("so it survives a reload", await hasAccent("cs-theme--verdant"));

	check("no page errors", page.errors.length === 0, page.errors.join("\n"));
	await page.close();

	// ---------- and the builder reads the same field ----------
	const page2 = await openPage(browser, {url: BUILDER_URL, state: storeOf(TWO_CHARACTERS)});
	await page2.waitForTimeout(4000);

	check("the builder offers it too", await page2.locator("#cs-theme-select").count() === 1);
	check("with the same character's theme", await page2.locator("#cs-theme-select").inputValue() === "parchment");
	check("no page errors in the builder", page2.errors.length === 0, page2.errors.join("\n"));
	await page2.close();
}
