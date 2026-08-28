/**
 * What a species gives a character, in the running page.
 *
 * Sixty-nine species and subspecies grant spells through the same `additionalSpells` shape a
 * subclass uses, and only the `{choose}` entries were ever resolved — so a Tiefling's Thaumaturgy,
 * an Aasimar's Light and a Drow's Darkness reached nothing at all. A species also has speeds beyond
 * walking, which only `speed.walk` was ever read from.
 *
 * Driven through the sheet rather than the builder, because the point is that these arrive without
 * anybody choosing them.
 */

import {BASE_URL, getState, openPage} from "./util-e2e.mjs";

const SHEET_URL = `${BASE_URL}/charactersheet.html`;

const storeOf = state => JSON.stringify({storeVersion: 1, currentId: "e2e", characters: {e2e: {version: 2, state}}});

/*
 * A Tiefling Fighter: a species that grants spells, on a character whose class grants none. If the
 * panel opens at all, it is the species that opened it.
 */
const TIEFLING_FIGHTER = {
	name: "Species Tester",
	level: 3,
	abil_str: 16,
	abil_dex: 12,
	abil_con: 14,
	abil_int: 10,
	abil_wis: 10,
	abil_cha: 12,
	speciesText: "Tiefling",
	refSpecies: {name: "Tiefling", source: "PHB", tag: "Tiefling|PHB"},
	classes: [{id: "a", name: "Fighter", source: "PHB", level: 3, hdFaces: 10, subclass: null}],
};

export async function run ({browser, check}) {
	const page = await openPage(browser, {url: SHEET_URL, state: storeOf(TIEFLING_FIGHTER)});
	await page.waitForTimeout(6000);

	// ---------- the species' spells arrive without being chosen ----------
	const known = page.locator("#cs-spells-known");
	const text = await known.textContent();
	check("a species' cantrip reaches the sheet", /Thaumaturgy/i.test(text), text.slice(0, 400));
	check("and it says what granted it", /Tiefling/.test(text), text.slice(0, 400));

	const state = await getState(page);
	check("without being written into the character's own spell list",
		!(state?.spellsKnown || []).some(sp => /thaumaturgy/i.test(sp.name)),
		JSON.stringify(state?.spellsKnown));

	// The panel is only shown for a character with spellcasting; a Fighter has none of its own
	check("the spellbook opens for a class that casts nothing",
		!(await page.locator("#cs-spell-body").getAttribute("class") || "").includes("ve-hidden"));

	await page.close();

	// ---------- a species' speed is more than its walking speed ----------
	const page2 = await openPage(browser, {url: SHEET_URL, state: storeOf({name: "Speed Tester", level: 1})});
	await page2.waitForTimeout(4000);

	await page2.click("#cs-pick-species");
	await page2.waitForFunction(() => {
		const inp = document.querySelector(".ve-ui-modal__overlay input");
		return !!inp;
	}, {timeout: 20000});
	await page2.fill(".ve-ui-modal__overlay input", "Aarakocra");
	await page2.waitForTimeout(1200);
	await page2.keyboard.press("Enter");
	await page2.waitForTimeout(2500);

	const speed = await page2.inputValue("#cs-speed").catch(() => "");
	check("a flying species records its flying speed", /fly \d+ ft\./.test(speed), speed);
	check("and its walking speed first", /^\d+ ft\./.test(speed), speed);

	check("no page errors", page2.errors.length === 0, page2.errors.join("\n"));
	await page2.close();
}
