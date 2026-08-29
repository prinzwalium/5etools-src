/**
 * The guided setup, end to end: its eight steps, its validation rules, and every field it is
 * supposed to write onto the sheet when it applies.
 *
 * The eighth step's own behaviour — what it lists and how answering one thing reveals another —
 * lives in `guide.e2e.mjs`; this suite is about the seven that build the draft.
 */

import {BASE_URL, getState, openPage} from "./util-e2e.mjs";

/** The wizard's own nested search modals are opened by button text, not by a stable id. */
async function pickViaWizardSearch (page, {btnText, query, rowText, srcText = null}) {
	await page.click(`.ve-ui-modal__overlay button:has-text('${btnText}')`);
	await page.waitForTimeout(1500);
	const top = page.locator(".ve-ui-modal__overlay").last();
	const ipt = top.locator(".ve-ui-search__ipt-search").first();
	await ipt.click();
	await ipt.pressSequentially(query, {delay: 40});
	await page.waitForTimeout(1200);

	const ix = await top.evaluate((_e, {rowText, srcText}) => {
		const rows = [...document.querySelectorAll(".ve-ui-modal__overlay:last-of-type .ve-ui-search__row")];
		return rows.findIndex(r => {
			const spans = r.querySelectorAll("span");
			return (spans[0]?.textContent || "").trim() === rowText && (!srcText || (spans[1]?.textContent || "").includes(srcText));
		});
	}, {rowText, srcText});
	if (ix < 0) throw new Error(`No wizard search row "${rowText}"`);

	await top.locator(".ve-ui-search__row").nth(ix).click();
	await page.waitForTimeout(800);
}

const clickNext = async page => {
	await page.click(".ve-ui-modal__footer button:has-text('Next')");
	await page.waitForTimeout(600);
};

export async function run ({browser, check}) {
	// The play sheet, because the wizard's results land on its saves/skills/inventory
	const page = await openPage(browser, {url: `${BASE_URL}/charactersheet.html`});

	await page.click("#cs-btn-wizard");
	await page.waitForSelector(".ve-ui-modal__overlay", {timeout: 10000});
	check("the wizard opens on step 1", (await page.locator(".ve-ui-modal__overlay").textContent()).includes("Step 1 of 8"));

	// ---------- 1. species ----------
	await pickViaWizardSearch(page, {btnText: "Choose Species...", query: "elf", rowText: "Elf", srcText: "PHB'24"});
	check("a species can be picked", (await page.locator("#cs-wiz-disp-species").textContent()).includes("Elf"));
	await clickNext(page);

	// ---------- 2. class ----------
	await page.waitForSelector("#cs-wiz-sel-class", {timeout: 10000});
	await page.waitForFunction(() => document.querySelector("#cs-wiz-sel-class").options.length > 1, {timeout: 15000});
	// The 2024 printing: preferring the newest is the default, so the 2014 Fighter it supersedes is
	// not on the menu
	await page.selectOption("#cs-wiz-sel-class", {label: "Fighter (PHB'24)"});
	await page.fill("#cs-wiz-ipt-level", "3");
	await page.dispatchEvent("#cs-wiz-ipt-level", "change");
	await page.waitForTimeout(300);
	check("the class's hit die is shown", (await page.locator("#cs-wiz-disp-class").textContent()).includes("d10"));
	await clickNext(page);

	// ---------- 3. background ----------
	await pickViaWizardSearch(page, {btnText: "Choose Background...", query: "anthropologist", rowText: "Anthropologist", srcText: "ToA"});
	check("a background can be picked", (await page.locator("#cs-wiz-disp-background").textContent()).includes("Anthropologist"));
	await clickNext(page);

	// ---------- 4. ability scores ----------
	await page.selectOption("#cs-wiz-sel-abil-method", "standardArray");
	await page.waitForTimeout(300);
	const abvs = ["str", "dex", "con", "int", "wis", "cha"];
	const vals = ["15", "14", "13", "12", "10", "8"];
	for (let i = 0; i < 6; ++i) await page.selectOption(`[data-cs-wiz-abv='${abvs[i]}']`, vals[i]);
	await page.waitForTimeout(200);
	check("the standard array can be assigned", (await page.locator("#cs-wiz-disp-abil-status").textContent()).includes("6 / 6"));

	await page.selectOption("[data-cs-wiz-abv='cha']", "15");
	await clickNext(page);
	check("assigning a value twice blocks the step", (await page.locator("#cs-wiz-validation").textContent()).includes("exactly once"));
	await page.selectOption("[data-cs-wiz-abv='cha']", "8");
	await clickNext(page);

	// ---------- 5. choices ----------
	const choicesText = await page.locator(".ve-ui-modal__overlay").textContent();
	check("the queue lists the species' choices", choicesText.includes("Species: Elf"));
	check("the queue lists the class's skill choice", choicesText.includes("Class: Fighter"));
	check("the queue lists the background's language choice", choicesText.includes("Background: Anthropologist"));

	const checkOption = async (sectionText, optText) => {
		const section = page.locator(".ve-ui-modal__overlay .ve-mb-3", {hasText: sectionText}).first();
		await section.locator(`label:has-text("${optText}") input[type='checkbox']`).first().check();
	};
	await checkOption("Species: Elf", "Perception");
	await checkOption("Class: Fighter", "Athletics");
	await checkOption("Class: Fighter", "Intimidation");
	await checkOption("Background: Anthropologist", "Elvish");
	await checkOption("Background: Anthropologist", "Giant");

	const fighterSection = page.locator(".ve-ui-modal__overlay .ve-mb-3", {hasText: "Class: Fighter"}).first();
	const cbExtra = fighterSection.locator("label:has-text('History') input").first();
	await cbExtra.click();
	check("a choice cannot be over-picked", !await cbExtra.isChecked());
	await clickNext(page);

	// ---------- 6. equipment ----------
	const equipText = await page.locator("#cs-wiz-wrp-equipment").textContent();
	check("the class's starting equipment is offered", equipText.includes("chain mail"));
	check("the background's is too", /ink|quill/i.test(equipText));
	await clickNext(page);

	// ---------- 7. review, then finish ----------
	const reviewText = await page.locator(".ve-ui-modal__overlay").textContent();
	check("the review shows the class and level", reviewText.includes("Fighter 3"));
	check("the review shows the abilities", reviewText.includes("STR 15"));
	check("the review suggests hit points", reviewText.includes("25"));

	await page.fill("#cs-wiz-ipt-name", "Wiz Ard");
	await page.dispatchEvent("#cs-wiz-ipt-name", "change");

	// "Apply" writes the character; the guide then walks whatever could not be decided before it
	// existed, and closing that last step is what hands the sheet back
	await page.click(".ve-ui-modal__footer button:has-text('Apply')");
	await page.waitForTimeout(1200);

	const finishText = await page.locator(".ve-ui-modal__overlay").first().innerText();
	check("applying moves on to the last step rather than closing", /Step 8 of 8/.test(finishText), finishText.slice(0, 160));

	await page.locator(".ve-ui-modal__footer button", {hasText: "Done"}).click();
	await page.waitForTimeout(900);

	// ---------- what it wrote ----------
	check("the name is applied", await page.locator("#cs-name").inputValue() === "Wiz Ard");
	check("the species is applied", await page.locator("#cs-species").inputValue() === "Elf");
	check("the class and level are applied", await page.locator("#cs-classlevel").inputValue() === "Fighter 3");
	check("the background is applied", await page.locator("#cs-background").inputValue() === "Anthropologist");
	check("the level is applied", await page.locator("#cs-level").inputValue() === "3");
	check("the ability scores are applied", await page.locator("#cs-abil-str").inputValue() === "15");
	check("the hit dice are applied", await page.locator("#cs-hd-total").inputValue() === "3d10");
	check("the suggested hit points are applied", await page.locator("#cs-hp-max").inputValue() === "25");
	check("the class's saving throws are applied", await page.locator("#cs-save-str").isChecked() && await page.locator("#cs-save-con").isChecked());
	check("the proficiency bonus follows the level", (await page.locator("#cs-pb").textContent()) === "+2");
	check("a chosen class skill is proficient", (await page.locator("#cs-skillroll-athletics").textContent()).includes("+4"));
	check("a chosen species skill is proficient", (await page.locator("#cs-skillroll-perception").textContent()).includes("+2"));

	const profChips = await page.evaluate(() => [...document.querySelectorAll("#cs-prof-list .cs__prof-chip")].map(c => c.textContent));
	check("chosen languages become structured proficiencies", profChips.some(t => /Elvish/.test(t)) && profChips.some(t => /Giant/.test(t)), JSON.stringify(profChips));

	const invText = await page.locator("#cs-inventory").textContent();
	check("concrete equipment lands in the inventory", invText.includes("Chain Mail"));
	check("only category placeholders stay as notes", (await page.locator("#cs-equipment").inputValue()).includes("(choose)"));

	const state = await getState(page);
	check("the structured class is persisted", state?.classes?.[0]?.name === "Fighter" && state?.classes?.[0]?.level === 3);

	check("no page errors", page.errors.length === 0, page.errors.slice(0, 2).join(" | "));
	await page.close();
}
