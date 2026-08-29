/**
 * The feat builder on `makebrew.html`.
 *
 * Upstream ships builders for creatures, spells and legendary groups only; this is the fork's first
 * addition, and it is the first vertical slice of the homebrew plan — author a feat as *fields*,
 * save it, and find it offered in the character builder's own feat picker. What matters is that
 * last step: a proficiency written as prose is invisible to everything, so the test that counts is
 * whether the sheet can see what the builder wrote.
 *
 * It runs in a browser context of its own, because homebrew lives in the browser's storage rather
 * than the character store and must not follow the other suites around.
 */

import {BASE_URL, openPage} from "./util-e2e.mjs";

const MAKEBREW_URL = `${BASE_URL}/makebrew.html`;
const BUILDER_URL = `${BASE_URL}/charbuilder.html`;

const FEAT_NAME = "Test Cellar Sense";

/** The builder's rows are labelled, not identified; the label is the only stable handle. */
const rowIpt = (page, label) => page.locator(`.mkbru__row:has(.mkbru__row-name:text-is("${label}")) input`).first();

export async function run ({browser, check}) {
	const context = await browser.newContext();
	const page = await openPage(context, {url: MAKEBREW_URL});
	await page.waitForTimeout(4000);

	// ---------- a brew source has to exist before anything can be saved to it ----------
	const iptsSource = page.locator(".ve-ui-source__ipt-named");
	if (await iptsSource.count()) {
		await iptsSource.nth(0).fill("End To End");
		await iptsSource.nth(1).fill("E2E");
		await iptsSource.nth(2).fill("E2ETest");
		await page.locator("button:has-text('OK')").first().click();
		await page.waitForTimeout(2500);
	}

	// ---------- the builder is on the menu ----------
	const selMode = page.locator("select:has(option[value='featBuilder'])").first();
	check("the feat builder is offered as a mode", await selMode.count() === 1);

	await selMode.selectOption("featBuilder");
	await page.waitForTimeout(2000);

	// ---------- author it ----------
	await rowIpt(page, "Name").fill(FEAT_NAME);
	await rowIpt(page, "Name").dispatchEvent("change");
	await page.waitForTimeout(400);

	await page.locator(".mkbru__row:has(.mkbru__row-name:text-is('Category')) select").first().selectOption({label: "Origin"});
	await page.waitForTimeout(300);

	// Prerequisite: a level, which is what 145 of the books' feats state
	await page.locator(".mkbru__row:has(.mkbru__row-name:text-is('Prerequisite')) input[type='number']").first().fill("4");
	await page.locator(".mkbru__row:has(.mkbru__row-name:text-is('Prerequisite')) input[type='number']").first().dispatchEvent("change");
	await page.waitForTimeout(400);

	// Benefits: an ability increase and a skill proficiency, as fields rather than as prose
	await page.locator(".ve-ui-tab__btn-tab-head:has-text('Benefits')").first().click();
	await page.waitForTimeout(400);

	const abilRow = page.locator(".mkbru__row:has(.mkbru__row-name:text-is('Ability Score Increase'))").first();
	await abilRow.locator("label:has-text('Wisdom') input[type='checkbox']").first().check();
	await page.waitForTimeout(300);

	const skillRow = page.locator(".mkbru__row:has(.mkbru__row-name:text-is('Skill Proficiencies'))").first();
	await skillRow.locator("label:has-text('Perception') input[type='checkbox']").first().check();
	await page.waitForTimeout(500);

	// ---------- what it wrote ----------
	const written = await page.evaluate(() => {
		const pre = [...document.querySelectorAll(".mkbru__wrp-output-tab-data pre, .mkbru__wrp-output-tab-data code")]
			.map(it => it.textContent).find(it => it && it.trim().startsWith("{"));
		return pre ? JSON.parse(pre) : null;
	});

	check("the data tab shows the feat as JSON", !!written, JSON.stringify(written)?.slice(0, 200));
	check("the name and category are structured", written?.name === FEAT_NAME && written?.category === "O", JSON.stringify({name: written?.name, category: written?.category}));
	check("the prerequisite is a level, not prose", written?.prerequisite?.[0]?.level === 4, JSON.stringify(written?.prerequisite));
	check("the ability increase is a choice the sheet can resolve",
		written?.ability?.[0]?.choose?.from?.includes("wis"), JSON.stringify(written?.ability));
	check("the skill proficiency is a field", written?.skillProficiencies?.[0]?.perception === true, JSON.stringify(written?.skillProficiencies));

	// ---------- save it into the browser's homebrew ----------
	await page.locator("button.mkbru__cnt-save").first().click();
	await page.waitForTimeout(3000);

	const isSaved = await page.evaluate(async name => {
		const brew = await BrewUtil2.pGetBrewProcessed();
		return (brew.feat || []).some(it => it.name === name);
	}, FEAT_NAME);
	check("saving puts it in the browser's homebrew", isSaved);

	// ---------- and the character builder offers it ----------
	const pageBuilder = await context.newPage();
	pageBuilder.errors = [];
	pageBuilder.on("pageerror", e => pageBuilder.errors.push(e.message));
	await pageBuilder.goto(BUILDER_URL, {waitUntil: "load"});
	await pageBuilder.waitForTimeout(6000);

	const isOffered = await pageBuilder.evaluate(async name => {
		const mod = await import("./js/charactersheet/charactersheet-classdata.js");
		const feats = await mod.CharacterSheetClassData.pGetAllFeatsUnfiltered();
		return feats.some(it => it.name === name);
	}, FEAT_NAME);
	check("a feat authored here is offered by the character builder", isOffered);

	check("no page errors in the builder", page.errors.length === 0, page.errors.join("\n"));
	await context.close();
}
