/**
 * The Guided Setup and the Species/Background panels, told to agree.
 *
 * They did not. The guide applied a background's skills, answered its choices and took its Origin
 * feat — and the panels, which read the *entity* rather than the character, then asked for all of it
 * again: "choose 1 skill", "apply ability score increases", an Origin feat the Build Check
 * simultaneously called taken and owed. Nothing was wrong with the character; the two halves simply
 * had no shared record of what had been done.
 *
 * So this walks the guide with a 2024 species and background — the shape where every kind of grant
 * appears at once — and then asks the panels what is left. The answer has to be "nothing".
 */

import {BASE_URL, openPage} from "./util-e2e.mjs";

const BUILDER_URL = `${BASE_URL}/charbuilder.html`;

/** The guide's nested search modals are opened by button text, not by a stable id. */
async function pickViaWizardSearch (page, {btnText, query, rowText, srcText = null}) {
	await page.click(`.ve-ui-modal__overlay button:has-text('${btnText}')`);
	await page.waitForTimeout(1500);
	const top = page.locator(".ve-ui-modal__overlay").last();
	const ipt = top.locator(".ve-ui-search__ipt-search").first();
	await ipt.click();
	await ipt.pressSequentially(query, {delay: 40});
	await page.waitForTimeout(1400);

	const ix = await top.evaluate((_e, {rowText, srcText}) => {
		const rows = [...document.querySelectorAll(".ve-ui-modal__overlay:last-of-type .ve-ui-search__row")];
		return rows.findIndex(r => {
			const spans = r.querySelectorAll("span");
			return (spans[0]?.textContent || "").trim() === rowText && (!srcText || (spans[1]?.textContent || "").includes(srcText));
		});
	}, {rowText, srcText});
	if (ix < 0) throw new Error(`No wizard search row "${rowText}"`);

	await top.locator(".ve-ui-search__row").nth(ix).click();
	await page.waitForTimeout(900);
}

const clickNext = async page => {
	await page.click(".ve-ui-modal__footer button:has-text('Next')");
	await page.waitForTimeout(800);
};

export async function run ({browser, check}) {
	const page = await openPage(browser, {url: BUILDER_URL});

	await page.click("#cs-btn-wizard");
	await page.waitForSelector(".ve-ui-modal__overlay", {timeout: 10000});

	// ---------- species, class, background ----------
	await pickViaWizardSearch(page, {btnText: "Choose Species...", query: "human", rowText: "Human", srcText: "PHB'24"});
	await clickNext(page);

	await page.waitForSelector("#cs-wiz-sel-class", {timeout: 10000});
	await page.waitForFunction(() => document.querySelector("#cs-wiz-sel-class").options.length > 1, {timeout: 15000});
	await page.selectOption("#cs-wiz-sel-class", {label: "Rogue (PHB'24)"});
	await page.fill("#cs-wiz-ipt-level", "1");
	await page.dispatchEvent("#cs-wiz-ipt-level", "change");
	await clickNext(page);

	await pickViaWizardSearch(page, {btnText: "Choose Background...", query: "sailor", rowText: "Sailor", srcText: "PHB'24"});
	await clickNext(page);

	// ---------- abilities ----------
	await page.selectOption("#cs-wiz-sel-abil-method", "standardArray");
	await page.waitForTimeout(300);
	const abvs = ["str", "dex", "con", "int", "wis", "cha"];
	const vals = ["15", "14", "13", "12", "10", "8"];
	for (let i = 0; i < 6; ++i) await page.selectOption(`[data-cs-wiz-abv='${abvs[i]}']`, vals[i]);
	await clickNext(page);

	// ---------- choices: answer every one the guide offers ----------
	const overlay = page.locator(".ve-ui-modal__overlay");
	const choicesText = await overlay.textContent();
	check("the guide asks for the species' skill", choicesText.includes("Species: Human"), choicesText.slice(0, 200));
	check("and for the background's ability increases", choicesText.includes("Background: Sailor"), choicesText.slice(0, 200));

	// Tick until each group is satisfied; the guide refuses to over-pick, so this settles at the count
	const boxes = overlay.locator("input[type=checkbox]");
	for (let i = 0; i < await boxes.count(); ++i) await boxes.nth(i).check().catch(() => {});
	// Ability packages are radios/selects rather than boxes
	const selects = overlay.locator("select");
	for (let i = 0; i < await selects.count(); ++i) {
		const opts = await selects.nth(i).locator("option").count();
		if (opts > 1) await selects.nth(i).selectOption({index: 1}).catch(() => {});
	}
	await page.waitForTimeout(400);
	await clickNext(page);

	// ---------- equipment, review, finish ----------
	await clickNext(page);

	const reviewText = await overlay.textContent();
	check("the review names the origin feat it is about to grant", /Tavern Brawler/.test(reviewText), reviewText.slice(0, 400));

	await page.click(".ve-ui-modal__footer button:has-text('Finish')");
	await page.waitForTimeout(1500);

	// Finishing asks what the grants ask: "add this feat?", "which Origin feat?", the feat's own
	// questions. Answer all of them, since the point is that a finished guide leaves nothing owed
	let isOfferedFeatPicker = false;
	for (let i = 0; i < 10; ++i) {
		const ov = page.locator(".ve-ui-modal__overlay");
		if (!(await ov.count())) break;
		const top = ov.last();

		const sel = top.locator("select").first();
		if (await sel.count()) {
			const opts = await sel.locator("option").count();
			if (opts > 1) {
				isOfferedFeatPicker = isOfferedFeatPicker || /Origin feat/i.test(await top.innerText());
				await sel.selectOption({index: 1}).catch(() => {});
			}
		}

		const btn = top.locator("button", {hasText: /^(OK|Add|Apply)$/}).first();
		if (!(await btn.count())) break;
		await btn.click().catch(() => {});
		await page.waitForTimeout(900);
	}
	await page.waitForTimeout(1500);

	// The Human's Versatile is "an Origin feat of your choice" — a picker, not a yes/no
	check("the guide asks which Origin feat the species grants", isOfferedFeatPicker);

	// ---------- what the panels make of it ----------
	const bgText = await page.locator("#cs-background-panel").innerText();
	check("the background's skills are ticked, not asked for again", /✓ Acrobatics/.test(bgText) && /✓ Perception/.test(bgText), bgText.slice(0, 300));
	check("its origin feat is ticked", /✓ Tavern Brawler/.test(bgText), bgText.slice(0, 300));
	check("and it has nothing left to ask", !/STILL TO CHOOSE/i.test(bgText), bgText.slice(0, 400));

	const speciesText = await page.locator("#cs-species-panel").innerText();
	// The guide answered the Human's skill choice; asking again is the bug this suite exists for
	check("the species' skill choice is not asked twice", !/Choose 1 skill/i.test(speciesText), speciesText.slice(0, 300));
	check("and the species has nothing left to ask either", !/STILL TO CHOOSE/i.test(speciesText), speciesText.slice(0, 400));

	// The two surfaces have to say the same thing about the same feat
	const auditText = await page.locator("#cs-audit").innerText();
	const isPanelOwed = /STILL TO CHOOSE[\s\S]*Origin feat/i.test(speciesText);
	const isAuditOwed = /origin feat/i.test(auditText);
	check("the panel and the Build Check agree about the origin feat", isPanelOwed === isAuditOwed,
		`panel=${isPanelOwed} audit=${isAuditOwed} :: ${auditText.slice(0, 200)}`);

	// The traits belong to the panel that renders them from the data, not to a notes box
	const features = await page.locator("#cs-features").inputValue();
	check("the species' traits are not copied into the notes", !/Human Traits/.test(features), features.slice(0, 200));

	check("no page errors (guided setup)", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
	await page.close();
}
