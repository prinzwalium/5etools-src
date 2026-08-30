/**
 * The fork's homebrew builders on `makebrew.html`.
 *
 * Upstream ships builders for creatures, spells and legendary groups only; these are the fork's
 * additions, and each is a vertical slice of the homebrew plan — author the thing as *fields*, save
 * it, and find it where the character builder looks. That last step is the one that matters: a
 * proficiency written as prose is invisible to everything, so the test worth having is whether the
 * sheet can see what the builder wrote.
 *
 * All three share one browser context and one brew source, because creating a source is slow and
 * the point is that they write into the same brew. The context is its own, because homebrew lives
 * in the browser's storage rather than the character store and must not follow the other suites
 * around.
 */

import {BASE_URL, openPage} from "./util-e2e.mjs";

const MAKEBREW_URL = `${BASE_URL}/makebrew.html`;
const BUILDER_URL = `${BASE_URL}/charbuilder.html`;

const FEAT_NAME = "Test Cellar Sense";
const LANGUAGE_NAME = "Test Cellarspeak";
const BACKGROUND_NAME = "Test Cellarer";

/** The builders' rows are labelled, not identified; the label is the only stable handle. */
const row = (page, label) => page.locator(`.mkbru__row:has(.mkbru__row-name:text-is("${label}"))`).first();
const rowIpt = (page, label) => row(page, label).locator("input").first();

const fill = async (page, label, value) => {
	const ipt = rowIpt(page, label);
	await ipt.fill(value);
	await ipt.dispatchEvent("change");
	await page.waitForTimeout(300);
};

/** Whatever the Data tab is showing, parsed. This is the entity exactly as it will be saved. */
const pGetWritten = page => page.evaluate(() => {
	const pre = [...document.querySelectorAll(".mkbru__wrp-output-tab-data pre, .mkbru__wrp-output-tab-data code")]
		.map(it => it.textContent).find(it => it && it.trim().startsWith("{"));
	return pre ? JSON.parse(pre) : null;
});

const pSwitchTo = async (page, builder) => {
	await page.locator("select:has(option[value='featBuilder'])").first().selectOption(builder);
	await page.waitForTimeout(2000);
};

const pSave = async page => {
	await page.locator("button.mkbru__cnt-save").first().click();
	await page.waitForTimeout(2500);
};

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

	const modes = await page.locator("select:has(option[value='featBuilder']) option").allTextContents();
	check("the fork's builders are all on the menu",
		["Feat", "Background", "Language"].every(it => modes.includes(it)), modes.join(" | "));

	/* ---------------------------------------------------------------- feat */
	await pSwitchTo(page, "featBuilder");
	await fill(page, "Name", FEAT_NAME);
	await row(page, "Category").locator("select").first().selectOption({label: "Origin"});
	await page.waitForTimeout(300);

	// A level prerequisite, which is what 145 of the books' feats state
	await row(page, "Prerequisite").locator("input[type='number']").first().fill("4");
	await row(page, "Prerequisite").locator("input[type='number']").first().dispatchEvent("change");
	await page.waitForTimeout(400);

	await page.locator(".ve-ui-tab__btn-tab-head:has-text('Benefits')").first().click();
	await page.waitForTimeout(400);
	await row(page, "Ability Score Increase").locator("label:has-text('Wisdom') input[type='checkbox']").first().check();
	await page.waitForTimeout(300);
	await row(page, "Skill Proficiencies").locator("label:has-text('Perception') input[type='checkbox']").first().check();
	await page.waitForTimeout(500);

	const feat = await pGetWritten(page);
	check("the feat's name and category are structured", feat?.name === FEAT_NAME && feat?.category === "O", JSON.stringify({name: feat?.name, category: feat?.category}));
	check("its prerequisite is a level, not prose", feat?.prerequisite?.[0]?.level === 4, JSON.stringify(feat?.prerequisite));
	check("its ability increase is a choice the sheet can resolve", feat?.ability?.[0]?.choose?.from?.includes("wis"), JSON.stringify(feat?.ability));
	check("its skill proficiency is a field", feat?.skillProficiencies?.[0]?.perception === true, JSON.stringify(feat?.skillProficiencies));

	await pSave(page);

	/* ------------------------------------------------------------ language */
	await pSwitchTo(page, "languageBuilder");
	await fill(page, "Name", LANGUAGE_NAME);
	await row(page, "Type").locator("select").first().selectOption({label: "Exotic"});
	await page.waitForTimeout(300);
	await fill(page, "Script", "Dwarvish");

	await row(page, "Dialects").locator("button:has-text('Add Dialect')").first().click();
	await page.waitForTimeout(200);
	const iptDialect = row(page, "Dialects").locator("input").first();
	await iptDialect.fill("Deep Cellarspeak");
	await iptDialect.dispatchEvent("change");
	await page.waitForTimeout(500);

	const language = await pGetWritten(page);
	check("the language is written with its type and script",
		language?.name === LANGUAGE_NAME && language?.type === "exotic" && language?.script === "Dwarvish", JSON.stringify(language));
	check("and its dialects as a list", language?.dialects?.includes("Deep Cellarspeak"), JSON.stringify(language?.dialects));

	await pSave(page);

	/* ---------------------------------------------------------- background */
	await pSwitchTo(page, "backgroundBuilder");
	await fill(page, "Name", BACKGROUND_NAME);

	await page.locator(".ve-ui-tab__btn-tab-head:has-text('Benefits')").first().click();
	await page.waitForTimeout(400);

	// A 2024 background states three abilities, and grants nothing until it does
	const abilRow = row(page, "Ability Scores");
	check("an incomplete ability trio says so rather than writing half of one",
		/Ticked 0 of 3/.test(await abilRow.textContent()), (await abilRow.textContent()).slice(0, 120));

	for (const abil of ["Strength", "Constitution", "Wisdom"]) {
		await abilRow.locator(`label:has-text('${abil}') input[type='checkbox']`).first().check();
		await page.waitForTimeout(200);
	}

	await row(page, "Skill Proficiencies").locator("label:has-text('Athletics') input[type='checkbox']").first().check();
	await page.waitForTimeout(200);
	await row(page, "Skill Proficiencies").locator("label:has-text('Survival') input[type='checkbox']").first().check();
	await page.waitForTimeout(200);

	await row(page, "Tool Proficiencies").locator("button:has-text('Add Tool')").first().click();
	await page.waitForTimeout(200);
	const iptTool = row(page, "Tool Proficiencies").locator("input[type='text'], input:not([type])").first();
	await iptTool.fill("Brewer's Supplies");
	await iptTool.dispatchEvent("change");
	await page.waitForTimeout(300);

	const iptLangs = row(page, "Languages").locator("input").first();
	await iptLangs.fill("2");
	await iptLangs.dispatchEvent("change");
	await page.waitForTimeout(400);

	await page.locator(".ve-ui-tab__btn-tab-head:has-text('Equipment')").first().click();
	await page.waitForTimeout(400);
	const iptGp = row(page, "Starting Equipment").locator("input[type='number']").first();
	await iptGp.fill("15");
	await iptGp.dispatchEvent("change");
	await page.waitForTimeout(600);

	const bg = await pGetWritten(page);
	check("the background offers both ability options the books state",
		bg?.ability?.length === 2
			&& JSON.stringify(bg.ability[0]?.choose?.weighted?.weights) === "[2,1]"
			&& JSON.stringify(bg.ability[1]?.choose?.weighted?.weights) === "[1,1,1]",
		JSON.stringify(bg?.ability));
	check("over the three abilities that were ticked",
		JSON.stringify(bg?.ability?.[0]?.choose?.weighted?.from) === `["str","con","wis"]`, JSON.stringify(bg?.ability?.[0]));
	check("its skills are granted outright", bg?.skillProficiencies?.[0]?.athletics === true && bg?.skillProficiencies?.[0]?.survival === true, JSON.stringify(bg?.skillProficiencies));
	check("its tool is lowercased to match the item it names", bg?.toolProficiencies?.[0]?.["brewer's supplies"] === true, JSON.stringify(bg?.toolProficiencies));
	check("its languages are a count", bg?.languageProficiencies?.[0]?.anyStandard === 2, JSON.stringify(bg?.languageProficiencies));
	check("and its coin is stored in copper", bg?.startingEquipment?.[0]?._?.some(it => it?.value === 1500), JSON.stringify(bg?.startingEquipment));

	await pSave(page);

	/* ------------------------------------------- what the brew now holds */
	const stored = await page.evaluate(async () => {
		const brew = await BrewUtil2.pGetBrewProcessed();
		return {
			feats: (brew.feat || []).map(it => it.name),
			languages: (brew.language || []).map(it => it.name),
			backgrounds: (brew.background || []).map(it => it.name),
		};
	});
	check("all three are saved into the one brew",
		stored.feats.includes(FEAT_NAME) && stored.languages.includes(LANGUAGE_NAME) && stored.backgrounds.includes(BACKGROUND_NAME),
		JSON.stringify(stored));

	check("no page errors while authoring", page.errors.length === 0, page.errors.join("\n"));

	/* ----------------------------------- and what the character builder sees */
	const pageBuilder = await context.newPage();
	pageBuilder.errors = [];
	pageBuilder.on("pageerror", e => pageBuilder.errors.push(e.message));
	await pageBuilder.goto(BUILDER_URL, {waitUntil: "load"});
	await pageBuilder.waitForTimeout(6000);

	const seen = await pageBuilder.evaluate(async ({featName, bgName}) => {
		const mod = await import("./js/charactersheet/charactersheet-classdata.js");
		const feats = await mod.CharacterSheetClassData.pGetAllFeatsUnfiltered();
		const bg = await mod.CharacterSheetClassData.pGetBackground({name: bgName, source: "E2ETest"});
		return {
			isFeatOffered: feats.some(it => it.name === featName),
			bgSkills: bg ? Object.keys(bg.skillProficiencies?.[0] || {}) : null,
		};
	}, {featName: FEAT_NAME, bgName: BACKGROUND_NAME});

	check("a feat authored here is offered by the character builder", seen.isFeatOffered);
	check("and a background reaches it with its grants intact",
		(seen.bgSkills || []).includes("athletics") && (seen.bgSkills || []).includes("survival"), JSON.stringify(seen.bgSkills));

	check("no page errors in the character builder", pageBuilder.errors.length === 0, pageBuilder.errors.join("\n"));
	await context.close();
}
