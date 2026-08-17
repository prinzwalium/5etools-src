/**
 * The level-up preview, and the panels that used to go stale.
 *
 * Every sheet walks you through a level-up; none says what the outcome will be first, so the way to
 * learn what 5th level gives a Fighter was to become 5th level and look — and the way back from a
 * mis-typed level was undoing a scatter of changes by hand.
 *
 * The panel half is the other subject: a panel that renders a prop it does not watch shows
 * yesterday's answer until a reload, which happened four separate times. The panels now watch the
 * whole state, so this drives an answer and reads the panel in the same visit.
 */

import {BASE_URL, openPage} from "./util-e2e.mjs";

const SHEET_URL = `${BASE_URL}/charactersheet.html`;
const BUILDER_URL = `${BASE_URL}/charbuilder.html`;

const storeOf = state => JSON.stringify({storeVersion: 1, currentId: "e2e", characters: {e2e: {version: 2, state}}});

const FIGHTER_4 = {
	name: "Level Tester",
	level: 4,
	abil_str: 16,
	abil_dex: 12,
	abil_con: 14,
	abil_int: 10,
	abil_wis: 10,
	abil_cha: 8,
	hpMax: 36,
	hpCur: 36,
	classes: [{id: "a", name: "Fighter", source: "XPHB", level: 4, hdFaces: 10, subclass: {name: "Champion", shortName: "Champion", source: "XPHB"}}],
};

export async function run ({browser, check}) {
	const page = await openPage(browser, {url: SHEET_URL, state: storeOf(FIGHTER_4)});
	await page.waitForTimeout(4000);

	await page.fill("#cs-level", "5");
	await page.dispatchEvent("#cs-level", "change");
	await page.waitForTimeout(2500);

	const modal = page.locator(".ve-ui-modal__inner").last();
	const text = (await modal.innerText()).replace(/\s+/g, " ");

	check("levelling up shows what the level brings, before committing", /Level 4 . 5/.test(text), text.slice(0, 300));
	check("including the hit points, with the arithmetic shown",
		/\+8 hit points/.test(text) && /Constitution/.test(text), text.slice(0, 300));
	check("the proficiency bonus when it moves", /Proficiency bonus/.test(text) && /\+2 . \+3/.test(text), text.slice(0, 300));
	check("the features gained", /Extra Attack/.test(text), text.slice(0, 300));
	check("and the subclass's own feature, named for it", /Champion/.test(text), text.slice(0, 300));

	// Declining leaves the character exactly as it was — the point of previewing at all
	await modal.locator("button", {hasText: "Cancel"}).first().click();
	await page.waitForTimeout(1500);

	check("declining puts the level back", await page.inputValue("#cs-level") === "4", await page.inputValue("#cs-level"));
	check("and gains no hit points", await page.inputValue("#cs-hp-max") === "36", await page.inputValue("#cs-hp-max"));

	// Accepting goes through to the existing hit-point prompt
	await page.fill("#cs-level", "5");
	await page.dispatchEvent("#cs-level", "change");
	await page.waitForTimeout(2000);
	await page.locator(".ve-ui-modal__inner button", {hasText: "Level up"}).last().click();
	await page.waitForTimeout(1800);

	const hpPrompt = (await page.locator(".ve-ui-modal__inner").last().innerText()).replace(/\s+/g, " ");
	check("accepting carries on to the hit-point prompt", /Level up to 5|How do you want/i.test(hpPrompt), hpPrompt.slice(0, 200));

	check("no page errors (level-up preview)", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
	await page.close();

	await runPanelFreshness({browser, check});
}

/**
 * A panel shows the answer you just gave, without a reload.
 *
 * Four bugs of this shape reached the app — a lineage, a class-granted feat, a size, an origin feat
 * — each one a prop the panel rendered and did not watch. The panels now watch the whole state.
 */
async function runPanelFreshness ({browser, check}) {
	const page = await openPage(browser, {
		url: BUILDER_URL,
		state: storeOf({
			name: "Freshness",
			level: 1,
			abil_str: 10,
			abil_dex: 10,
			abil_con: 10,
			abil_int: 10,
			abil_wis: 10,
			abil_cha: 10,
			hpMax: 8,
			hpCur: 8,
			classes: [],
			speciesText: "Aasimar",
			refSpecies: {name: "Aasimar", source: "XPHB"},
		}),
	});
	await page.locator("#cs-species-panel").waitFor({timeout: 20000});
	await page.waitForTimeout(2500);

	const species = page.locator("#cs-species-panel");
	const sizeRow = species.locator("div.ve-flex-v-center.ve-small").filter({hasText: "Size"});
	check("the species asks for the size it left open", await sizeRow.count() === 1, (await species.innerText()).slice(0, 300));

	// Write the answer straight to the model: the subject here is the *render*, not the picker
	await page.evaluate(() => window.__csPage._comp.setSize("S"));
	await page.waitForTimeout(600);

	check("answering it updates the panel without a reload", await sizeRow.count() === 0, (await species.innerText()).slice(0, 300));
	check("and the header shows the chosen size, not the menu",
		/Small/.test(await species.innerText()) && !/Small\/Medium/.test(await species.innerText()),
		(await species.innerText()).slice(0, 200));

	// The build audit reads more of the character than any other panel, so it is the one that broke
	// most. Four attuned items breaks a rule, and it should say so the moment they are there
	await page.evaluate(() => {
		window.__csPage._comp._state.inventory = [1, 2, 3, 4]
			.map(n => ({id: `i${n}`, name: `Item ${n}`, quantity: 1, attuned: true}));
	});
	await page.waitForTimeout(600);
	check("the build check updates in place, with no reload",
		/Attuned to 4 items/.test(await page.locator("#cs-audit").innerText()),
		(await page.locator("#cs-audit").innerText()).slice(0, 250));

	check("no page errors (panel freshness)", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
	await page.close();
}
