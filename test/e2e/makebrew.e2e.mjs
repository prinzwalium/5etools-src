/**
 * The fork's homebrew builders on `makebrew.html`.
 *
 * Upstream ships builders for creatures, spells and legendary groups only; these are the fork's
 * additions, and each is a vertical slice of the homebrew plan — author the thing as *fields*, save
 * it, and find it where the character builder looks. That last step is the one that matters: a
 * proficiency written as prose is invisible to everything, so the test worth having is whether the
 * sheet can see what the builder wrote.
 *
 * They share one browser context and one brew source, because creating a source is slow and
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
const SPECIES_NAME = "Test Cellarfolk";
const ITEM_NAME = "Test Cellarer's Tap";
const SUBCLASS_NAME = "Test Circle of the Cellar";
const CLASS_NAME = "Test Cellarer Class";

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
		["Feat", "Class", "Subclass", "Species", "Background", "Item", "Language"].every(it => modes.includes(it)), modes.join(" | "));

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

	/* ------------------------------------------------------------- species */
	await pSwitchTo(page, "speciesBuilder");
	await fill(page, "Name", SPECIES_NAME);

	await page.locator(".ve-ui-tab__btn-tab-head:has-text('Body')").first().click();
	await page.waitForTimeout(400);

	// Small *or* Medium: thirty species offer the choice, and it decides carrying capacity
	await row(page, "Size").locator("label:has-text('Small') input[type='checkbox']").first().check();
	await page.waitForTimeout(300);

	await row(page, "Creature Type").locator("label:has-text('Humanoid') input[type='checkbox']").first().check();
	await page.waitForTimeout(300);

	// Walking, plus a climb speed that defers to it rather than restating a number
	const speedRow = row(page, "Speed");
	const iptWalk = speedRow.locator("input[type='number']").first();
	await iptWalk.fill("25");
	await iptWalk.dispatchEvent("change");
	await page.waitForTimeout(500);

	const walkOnly = await pGetWritten(page);
	check("a species that only walks states a bare number, as 123 of them do",
		walkOnly?.speed === 25, JSON.stringify(walkOnly?.speed));

	await speedRow.locator("label:has-text('same as walking') input[type='checkbox']").nth(2).check();
	await page.waitForTimeout(300);

	const iptDark = row(page, "Senses").locator("input[type='number']").first();
	await iptDark.fill("60");
	await iptDark.dispatchEvent("change");
	await page.waitForTimeout(400);

	await page.locator(".ve-ui-tab__btn-tab-head:has-text('Traits')").first().click();
	await page.waitForTimeout(400);
	await row(page, "Resistances & Immunities").locator("label:has-text('Poison') input[type='checkbox']").first().check();
	await page.waitForTimeout(600);

	const species = await pGetWritten(page);
	check("a species offering two sizes stores both", JSON.stringify(species?.size) === `["S","M"]`, JSON.stringify(species?.size));
	check("its creature type is recorded", JSON.stringify(species?.creatureTypes) === `["humanoid"]`, JSON.stringify(species?.creatureTypes));
	check("a second kind of movement turns the speed into an object, keeping the walk",
		species?.speed?.walk === 25, JSON.stringify(species?.speed));
	check("and a kind that matches walking is stored as `true`, not as a copy of the number",
		species?.speed?.climb === true, JSON.stringify(species?.speed));
	check("darkvision is a field", species?.darkvision === 60, JSON.stringify(species?.darkvision));
	check("and a resistance is one too", (species?.resist || []).includes("poison"), JSON.stringify(species?.resist));

	await pSave(page);

	/* ---------------------------------------------------------------- item */
	await pSwitchTo(page, "itemBuilder");
	await fill(page, "Name", ITEM_NAME);
	await row(page, "Rarity").locator("select").first().selectOption({label: "Rare"});
	await page.waitForTimeout(300);

	const cbAttune = row(page, "Attunement").locator("input[type='checkbox']").first();
	await cbAttune.check();
	await page.waitForTimeout(300);

	const iptValue = row(page, "Value").locator("input[type='number']").first();
	await iptValue.fill("250");
	await iptValue.dispatchEvent("change");
	await page.waitForTimeout(400);

	await page.locator(".ve-ui-tab__btn-tab-head:has-text('Magic')").first().click();
	await page.waitForTimeout(400);

	// Typed without a sign, because that is what a person types
	const iptBonusAc = row(page, "Magic Bonuses").locator("input").nth(2);
	await iptBonusAc.fill("1");
	await iptBonusAc.dispatchEvent("change");
	await page.waitForTimeout(400);

	const iptCharges = row(page, "Charges").locator("input[type='number']").first();
	await iptCharges.fill("3");
	await iptCharges.dispatchEvent("change");
	await page.waitForTimeout(300);
	await row(page, "Charges").locator("select").first().selectOption({label: "Dawn"});
	await page.waitForTimeout(600);

	const item = await pGetWritten(page);
	check("the item's rarity is stored", item?.rarity === "rare", JSON.stringify(item?.rarity));
	check("attunement with no restriction is `true`, not a sentence", item?.reqAttune === true, JSON.stringify(item?.reqAttune));
	check("its price is stored in copper", item?.value === 25000, JSON.stringify(item?.value));
	check("an unsigned bonus is signed, because the sheet parses it as one", item?.bonusAc === "+1", JSON.stringify(item?.bonusAc));
	check("its charges and recharge are fields the inventory row can spend",
		item?.charges === 3 && item?.recharge === "dawn", JSON.stringify({charges: item?.charges, recharge: item?.recharge}));

	await pSave(page);

	/* ------------------------------------------------------------ subclass */
	await pSwitchTo(page, "subclassBuilder");
	await fill(page, "Name", SUBCLASS_NAME);
	await fill(page, "Short Name", "Cellar");
	await row(page, "Class").locator("select").first().selectOption({label: "Druid (PHB'24)"});
	await page.waitForTimeout(400);

	await page.locator(".ve-ui-tab__btn-tab-head:has-text('Features')").first().click();
	await page.waitForTimeout(400);
	await row(page, "Features").locator("button:has-text('Add Feature')").first().click();
	await page.waitForTimeout(300);

	const featureRow = row(page, "Features");
	const iptFeatName = featureRow.locator("input:not([type='number'])").first();
	await iptFeatName.fill("Cellar Sense");
	await iptFeatName.dispatchEvent("change");
	const iptFeatText = featureRow.locator("textarea").first();
	await iptFeatText.fill("You always know the way to the nearest cellar.");
	await iptFeatText.dispatchEvent("change");
	await page.waitForTimeout(600);

	const subclass = await pGetWritten(page);
	check("the subclass names its parent class by name and source",
		subclass?.className === "Druid" && subclass?.classSource === "XPHB",
		JSON.stringify({className: subclass?.className, classSource: subclass?.classSource}));
	check("its features are written inline, not as refs the brew cannot resolve",
		subclass?.subclassFeatures?.length === 1 && typeof subclass.subclassFeatures[0] === "object",
		JSON.stringify(subclass?.subclassFeatures)?.slice(0, 160));
	check("and each carries the level the sheet reads it by",
		subclass?.subclassFeatures?.[0]?.level === 3 && subclass?.subclassFeatures?.[0]?.name === "Cellar Sense",
		JSON.stringify(subclass?.subclassFeatures?.[0]));

	await pSave(page);

	/* --------------------------------------------------------------- class */
	await pSwitchTo(page, "classBuilder");
	await fill(page, "Name", CLASS_NAME);
	await row(page, "Hit Die").locator("select").first().selectOption({label: "d10"});
	await page.waitForTimeout(300);

	const saveRow = row(page, "Saving Throws");
	check("a class with no saving throws yet says nothing is wrong",
		!/exactly two/.test(await saveRow.textContent()), (await saveRow.textContent()).slice(0, 120));

	await saveRow.locator("label:has-text('Strength') input[type='checkbox']").first().check();
	await page.waitForTimeout(300);
	check("one is called out, because every class in the books grants two",
		/grants 1/.test(await saveRow.textContent()), (await saveRow.textContent()).slice(0, 160));

	await saveRow.locator("label:has-text('Constitution') input[type='checkbox']").first().check();
	await page.waitForTimeout(400);

	// A feature at level 1, and the one that opens the subclass at 3
	await page.locator(".ve-ui-tab__btn-tab-head:has-text('Features')").first().click();
	await page.waitForTimeout(400);
	const clsFeatures = row(page, "Features");

	const pAddClassFeature = async ({ix, level, name, isSubclass}) => {
		await clsFeatures.locator("button:has-text('Add Feature')").first().click();
		await page.waitForTimeout(300);
		const iptLevel = clsFeatures.locator("input[type='number']").nth(ix);
		await iptLevel.fill(`${level}`);
		await iptLevel.dispatchEvent("change");
		const iptName = clsFeatures.locator("input:not([type='number']):not([type='checkbox'])").nth(ix);
		await iptName.fill(name);
		await iptName.dispatchEvent("change");
		if (isSubclass) await clsFeatures.locator("label:has-text('opens the subclass') input[type='checkbox']").nth(ix).check();
		await page.waitForTimeout(400);
	};

	await pAddClassFeature({ix: 0, level: 1, name: "Cellar Lore"});
	await pAddClassFeature({ix: 1, level: 3, name: "Cellar Path", isSubclass: true});

	// The class table is where resources live; a class with an empty table grants none
	await page.locator(".ve-ui-tab__btn-tab-head:has-text('Table')").first().click();
	await page.waitForTimeout(400);
	const tableRow = row(page, "Class Table");
	await tableRow.locator("button:has-text('Add Column')").first().click();
	await page.waitForTimeout(300);
	const iptColLabel = tableRow.locator("input").nth(0);
	await iptColLabel.fill("Cellar Dice");
	await iptColLabel.dispatchEvent("change");
	const iptColValues = tableRow.locator("input").nth(1);
	await iptColValues.fill("2, 2, 3");
	await iptColValues.dispatchEvent("change");
	await page.waitForTimeout(700);

	const cls = await pGetWritten(page);
	check("the class's hit die is a die, not a number", cls?.hd?.faces === 10 && cls?.hd?.number === 1, JSON.stringify(cls?.hd));
	check("its saving throws are the `proficiency` list the sheet reads",
		JSON.stringify(cls?.proficiency) === `["str","con"]`, JSON.stringify(cls?.proficiency));
	check("its features are bucketed by level, index 0 being level 1",
		cls?.classFeatures?.[0]?.[0]?.name === "Cellar Lore" && cls?.classFeatures?.[1]?.length === 0
			&& cls?.classFeatures?.[2]?.[0]?.name === "Cellar Path",
		JSON.stringify((cls?.classFeatures || []).map(it => it.map(f => f.name))));
	check("and the one that opens the subclass carries the marker",
		cls?.classFeatures?.[2]?.[0]?.gainSubclassFeature === true, JSON.stringify(cls?.classFeatures?.[2]?.[0]?.gainSubclassFeature));
	check("the table is twenty rows however few values were typed",
		cls?.classTableGroups?.[0]?.rows?.length === 20, JSON.stringify(cls?.classTableGroups?.[0]?.rows?.length));
	check("and a column that stops changing holds its last value",
		cls?.classTableGroups?.[0]?.rows?.[19]?.[0] === "3", JSON.stringify(cls?.classTableGroups?.[0]?.rows?.slice(-1)));

	await pSave(page);

	/* ------------------------------------------- what the brew now holds */
	const stored = await page.evaluate(async () => {
		const brew = await BrewUtil2.pGetBrewProcessed();
		return {
			feats: (brew.feat || []).map(it => it.name),
			languages: (brew.language || []).map(it => it.name),
			backgrounds: (brew.background || []).map(it => it.name),
			species: (brew.race || []).map(it => it.name),
			items: (brew.item || []).map(it => it.name),
			subclasses: (brew.subclass || []).map(it => it.name),
			classes: (brew.class || []).map(it => it.name),
		};
	});
	check("all seven are saved into the one brew",
		stored.feats.includes(FEAT_NAME) && stored.languages.includes(LANGUAGE_NAME)
			&& stored.backgrounds.includes(BACKGROUND_NAME) && stored.species.includes(SPECIES_NAME)
			&& stored.items.includes(ITEM_NAME) && stored.subclasses.includes(SUBCLASS_NAME)
			&& stored.classes.includes(CLASS_NAME),
		JSON.stringify(stored));

	check("no page errors while authoring", page.errors.length === 0, page.errors.join("\n"));

	/* ----------------------------------- and what the character builder sees */
	const pageBuilder = await context.newPage();
	pageBuilder.errors = [];
	pageBuilder.on("pageerror", e => pageBuilder.errors.push(e.message));
	await pageBuilder.goto(BUILDER_URL, {waitUntil: "load"});
	await pageBuilder.waitForTimeout(6000);

	const seen = await pageBuilder.evaluate(async ({featName, bgName, speciesName, className}) => {
		const mod = await import("./js/charactersheet/charactersheet-classdata.js");
		const {CharacterSheetClassData} = mod;

		const feats = await CharacterSheetClassData.pGetAllFeatsUnfiltered();
		const bg = await CharacterSheetClassData.pGetBackground({name: bgName, source: "E2ETest"});
		const species = await CharacterSheetClassData.pGetSpecies({name: speciesName, source: "E2ETest"});

		const sc = await CharacterSheetClassData.pGetSubclass({
			className: "Druid", classSource: "XPHB", shortName: "Cellar", source: "E2ETest",
		});

		// The class's real bar is not "valid JSON" but "our own level engine reads it back"
		const engine = await import("./js/charactersheet/charactersheet-levelengine.js");
		const classes = await CharacterSheetClassData.pGetAllClassesUnfiltered();
		const cls = classes.find(it => it.name === className && it.source === "E2ETest");

		return {
			isFeatOffered: feats.some(it => it.name === featName),
			bgSkills: bg ? Object.keys(bg.skillProficiencies?.[0] || {}) : null,
			speciesSpeed: species ? species.speed : null,
			subclassName: sc?.name ?? null,
			// The claim the whole subclass builder rests on: inline features survive the loader,
			// which would otherwise try to dereference them against an array that is not there
			subclassFeatureNames: sc ? CharacterSheetClassData.getSubclassFeaturesAtLevel(sc, 3).map(it => it.name) : null,
			classHitDie: cls?.hd?.faces ?? null,
			classFeatureNamesAt3: cls
				? CharacterSheetClassData.getFeatureTimeline(cls, {level: 3}).map(it => it.feature.name)
				: null,
			classResourcesAt3: cls ? engine.getClassResources(cls, 3).map(it => `${it.label}:${it.value}`) : null,
		};
	}, {featName: FEAT_NAME, bgName: BACKGROUND_NAME, speciesName: SPECIES_NAME, subclassName: SUBCLASS_NAME, className: CLASS_NAME});

	check("a feat authored here is offered by the character builder", seen.isFeatOffered);
	check("and a background reaches it with its grants intact",
		(seen.bgSkills || []).includes("athletics") && (seen.bgSkills || []).includes("survival"), JSON.stringify(seen.bgSkills));
	check("and a species reaches it with the movement that defines it",
		seen.speciesSpeed?.walk === 25 && seen.speciesSpeed?.climb === true, JSON.stringify(seen.speciesSpeed));
	check("a homebrew subclass is found under the class it names", seen.subclassName === SUBCLASS_NAME, JSON.stringify(seen.subclassName));
	check("and its inline features survive the loader, which would otherwise dereference them away",
		(seen.subclassFeatureNames || []).includes("Cellar Sense"), JSON.stringify(seen.subclassFeatureNames));

	// A class is only built correctly if the fork's own level engine reads it back — "valid JSON"
	// is not the bar here
	check("a homebrew class is listed by the character builder with its hit die", seen.classHitDie === 10, JSON.stringify(seen.classHitDie));
	check("its features come back on the timeline, in level order",
		JSON.stringify(seen.classFeatureNamesAt3) === `["Cellar Lore","Cellar Path"]`, JSON.stringify(seen.classFeatureNamesAt3));
	check("and the level engine reads its table as a resource",
		(seen.classResourcesAt3 || []).some(it => /^Cellar Dice:3$/.test(it)), JSON.stringify(seen.classResourcesAt3));

	check("no page errors in the character builder", pageBuilder.errors.length === 0, pageBuilder.errors.join("\n"));
	await context.close();
}
