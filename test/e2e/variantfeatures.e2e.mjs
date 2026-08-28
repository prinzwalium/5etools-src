/**
 * Tasha's optional class features, in the running builder.
 *
 * The data references them from `classFeatures` *beside* the features they replace, so a 2014
 * Ranger's level-1 list is Favored Enemy, Favored Foe, Natural Explorer, Deft Explorer — both
 * halves of two either/or pairs — and nothing read the flag that tells them apart. A character was
 * therefore granted all four, and the replaced ones still counted.
 *
 * They are a permission the table gives, so they default to off, and taking one strikes out what it
 * replaces. That last part only exists in the running page, which is why it is checked here.
 */

import {BASE_URL, getState, openPage} from "./util-e2e.mjs";

const BUILDER_URL = `${BASE_URL}/charbuilder.html`;

const storeOf = state => JSON.stringify({storeVersion: 1, currentId: "e2e", characters: {e2e: {version: 2, state}}});

// The 2014 Ranger, because it is where every replacement variant lives
const RANGER_1 = {
	name: "Variant Tester",
	level: 1,
	abil_str: 12,
	abil_dex: 16,
	abil_con: 14,
	abil_int: 10,
	abil_wis: 14,
	abil_cha: 8,
	classes: [{id: "a", name: "Ranger", source: "PHB", level: 1, hdFaces: 10, subclass: null}],
};

const cardFor = (page, name) => page.locator("#cs-class-panel .cs__feat-card", {hasText: name}).first();

export async function run ({browser, check}) {
	const page = await openPage(browser, {url: BUILDER_URL, state: storeOf(RANGER_1)});
	await page.waitForTimeout(5000);

	// ---------- offered, not granted ----------
	const deft = cardFor(page, "Deft Explorer");
	check("the optional feature is listed", await deft.count() >= 1);
	check("and marked as optional", await deft.locator(".cs__feat-badge--variant").count() >= 1);

	const toggle = deft.locator(".cs__feat-choice input[type=checkbox]").first();
	check("it carries a switch of its own", await toggle.count() >= 1);
	check("which starts off, because taking one is the table's decision", !(await toggle.isChecked()));

	const choiceText = await deft.locator(".cs__feat-choice").first().textContent();
	check("and says what it would replace", /Natural Explorer/.test(choiceText), choiceText);

	const natural = cardFor(page, "Natural Explorer");
	check("the feature it would replace is still in force", await natural.count() >= 1
		&& (await natural.getAttribute("class")).indexOf("cs__feat-card--replaced") < 0,
	await natural.getAttribute("class"));

	// ---------- take it ----------
	await deft.locator("summary").click();
	await page.waitForTimeout(200);
	await toggle.check();
	await page.waitForTimeout(1200);

	const state = await getState(page);
	const taken = state?.classes?.[0]?.featureVariants || [];
	check("taking it is recorded against the class entry", taken.some(it => it.name === "Deft Explorer"), JSON.stringify(taken));

	const naturalAfter = cardFor(page, "Natural Explorer");
	const clsAfter = await naturalAfter.getAttribute("class");
	check("and what it replaces is struck out rather than silently kept", /cs__feat-card--replaced/.test(clsAfter), clsAfter);

	const naturalText = await naturalAfter.locator("summary").textContent();
	check("naming what replaced it", /Deft Explorer/.test(naturalText), naturalText);

	// ---------- and given back ----------
	const deftAfter = cardFor(page, "Deft Explorer");
	if (!(await deftAfter.evaluate(el => el.open))) {
		await deftAfter.locator("summary").click();
		await page.waitForTimeout(200);
	}
	await deftAfter.locator(".cs__feat-choice input[type=checkbox]").first().uncheck();
	await page.waitForTimeout(1200);

	const stateBack = await getState(page);
	check("it can be given back", !(stateBack?.classes?.[0]?.featureVariants || []).some(it => it.name === "Deft Explorer"));

	const naturalBack = await cardFor(page, "Natural Explorer").getAttribute("class");
	check("and the replaced feature comes back with it", !/cs__feat-card--replaced/.test(naturalBack), naturalBack);

	check("no page errors", page.errors.length === 0, page.errors.join("\n"));
	await page.close();
}
