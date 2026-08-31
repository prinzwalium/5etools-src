/**
 * What a species and a background actually give you — and the two bugs that made the question worth
 * asking.
 *
 * A character built through the wizard came back with a Sailor background whose Origin feat existed
 * only as the words "Feat: Tavern Brawler" in a notes box: nothing counted it, nothing showed it,
 * and the feat's own choices were never asked. The same character had a "Choose Feat…" button on the
 * Warlock's *list* of Eldritch Invocations, which did nothing when clicked — the list was read as a
 * grant, and the category it found (`o`) never matched a feat's own (`O`).
 *
 * Both are structural, so both are driven here against the real data.
 */

import {BASE_URL, closeModal, openPage} from "./util-e2e.mjs";

const BUILDER_URL = `${BASE_URL}/charbuilder.html`;
const SHEET_URL = `${BASE_URL}/charactersheet.html`;

/** Rogue 4 / Warlock 3, Human, Sailor — the shape of the character that reported both bugs. */
const WARLOCK = {
	name: "Invocation Tester",
	level: 7,
	speciesText: "Human",
	backgroundText: "Sailor",
	refSpecies: {name: "Human", source: "XPHB"},
	refBackground: {name: "Sailor", source: "XPHB"},
	abil_str: 10,
	abil_dex: 16,
	abil_con: 14,
	abil_int: 12,
	abil_wis: 12,
	abil_cha: 16,
	hpMax: 44,
	hpCur: 44,
	classes: [
		{id: "a", name: "Rogue", source: "XPHB", level: 4, hdFaces: 8},
		{
			id: "b",
			name: "Warlock",
			source: "XPHB",
			level: 3,
			hdFaces: 8,
			subclass: {name: "Great Old One Patron", shortName: "Great Old One", source: "XPHB"},
			optionalFeatures: [
				{name: "Agonizing Blast", source: "XPHB", progressionName: "Eldritch Invocations"},
				{name: "Repelling Blast", source: "XPHB", progressionName: "Eldritch Invocations"},
				{name: "Lessons of the First Ones", source: "XPHB", progressionName: "Eldritch Invocations"},
			],
		},
	],
};

/** Matched by the card's own name: the *invocations* card mentions this one by name in its text. */
const LISTING_CARD = ".cs__feat-card:has(.cs__feat-name:has-text('Eldritch Invocation Options'))";

const storeOf = state => JSON.stringify({storeVersion: 1, currentId: "e2e", characters: {e2e: {version: 2, state}}});

export async function run ({browser, check}) {
	const page = await openPage(browser, {url: BUILDER_URL, state: storeOf(WARLOCK)});
	// The class panel loads its data before it can draw a card; wait for the card rather than a clock
	await page.locator(LISTING_CARD).waitFor({timeout: 20000});

	// ---------- the invocation *list* grants nothing ----------
	await page.evaluate(() => document.querySelectorAll("#cs-class-panel details").forEach(d => d.open = true));
	await page.waitForTimeout(400);

	const listingCard = page.locator(LISTING_CARD);
	check("the list of invocations is still shown as a feature", await listingCard.count() === 1);
	check("but it no longer asks you to choose a feat",
		await listingCard.locator(".cs__feat-choice").count() === 0,
		(await listingCard.innerText().catch(() => "")).slice(0, 200));

	// ---------- the invocation that *does* grant one, asks for it ----------
	const grant = page.locator(".cs__feat-choice--nested", {hasText: "Lessons of the First Ones"});
	check("an invocation that grants a feat asks for it, under the invocation", await grant.count() === 1);
	check("and names what kind of feat it is", (await grant.innerText()).includes("Origin Feat"),
		await grant.innerText().catch(() => ""));

	// The button used to do nothing at all: the data says `category=o`, a feat says `category: "O"`
	await grant.locator("button", {hasText: "Choose"}).click();
	await page.waitForTimeout(1500);
	const picker = page.locator(".ve-ui-modal__inner").last();
	const offered = await picker.locator("option").allTextContents();
	check("choosing it opens a picker with real feats in it", offered.length > 1, JSON.stringify(offered.slice(0, 4)));
	check("and they are origin feats", offered.some(it => /Alert|Crafter|Healer|Tough/.test(it)), JSON.stringify(offered.slice(0, 8)));
	await closeModal(page);

	check("no page errors (invocations)", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));

	// ---------- what the background grants, and whether you have it ----------
	const bg = page.locator("#cs-background-panel");
	const bgText = await bg.innerText();
	check("the background panel lists what it grants", /Acrobatics|Perception/.test(bgText), bgText.slice(0, 200));
	check("including its origin feat", /Tavern Brawler/.test(bgText), bgText.slice(0, 300));
	check("and marks the feat as not taken", /○ Tavern Brawler/.test(bgText), bgText.slice(0, 300));

	// The Build Check says the same thing in the place that lists what is owed
	check("the build check says the origin feat is owed",
		/Tavern Brawler/.test(await page.locator("#cs-audit").innerText()),
		(await page.locator("#cs-audit").innerText()).slice(0, 200));

	// ---------- taking it, for real ----------
	await bg.locator("button", {hasText: "Take it"}).click();
	await page.waitForTimeout(1200);
	await page.locator(".ve-ui-modal__inner button", {hasText: "Add"}).last().click();
	await page.waitForTimeout(1500);

	const taken = await page.evaluate(() => (window.__csPage._comp._state.originFeats || []).map(it => it.name));
	check("taking it records a real feat, not a line of text", taken.includes("Tavern Brawler"), JSON.stringify(taken));
	check("the panel ticks it", /✓ Tavern Brawler/.test(await bg.innerText()), (await bg.innerText()).slice(0, 300));
	check("and the build check stops asking",
		!/Tavern Brawler/.test(await page.locator("#cs-audit").innerText()),
		(await page.locator("#cs-audit").innerText()).slice(0, 200));

	// ---------- the species half of the same idea ----------
	const species = page.locator("#cs-species-panel");
	const speciesText = await species.innerText();
	check("the species panel shows its traits", /Resourceful|Skillful|Versatile/.test(speciesText), speciesText.slice(0, 200));
	check("and what it still wants chosen", /choose/i.test(speciesText), speciesText.slice(0, 200));

	check("no page errors (origin panels)", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
	await page.close();

	await runRolledHp({browser, check});
	await runPlaytestFindings({browser, check});
}

/**
 * Hit points that were rolled at the table.
 *
 * The sheet used to roll for you, which is wrong the moment somebody rolls their own dice: it
 * invents a number and adds it. Now it asks for the dice and adds the rest itself.
 */
async function runRolledHp ({browser, check}) {
	const page = await openPage(browser, {
		url: SHEET_URL,
		state: storeOf({
			name: "Roller",
			level: 1,
			hpMax: 12,
			hpCur: 12,
			hpPolicy: "roll",
			abil_str: 10,
			abil_dex: 10,
			abil_con: 16,
			abil_int: 10,
			abil_wis: 10,
			abil_cha: 10,
			classes: [{id: "a", name: "Fighter", source: "XPHB", level: 1, hdFaces: 10}],
			originFeats: [{id: "f", name: "Tough", source: "XPHB", displayName: "Tough", bonuses: {}}],
		}),
	});

	await page.fill("#cs-level", "3");
	await page.dispatchEvent("#cs-level", "change");
	await page.waitForTimeout(1800);

	const prompt = page.locator(".ve-ui-modal__inner").last();
	const promptText = (await prompt.innerText()).replace(/\s+/g, " ");
	check("rolling asks for the dice rather than rolling for you", /2d10/.test(promptText), promptText.slice(0, 200));
	check("and says what it will add to them",
		/Constitution per level/.test(promptText) && /from feats/.test(promptText), promptText.slice(0, 250));

	await prompt.locator("input").first().fill("9");
	await prompt.locator("button", {hasText: "OK"}).first().click();
	await page.waitForTimeout(1200);

	// 12 + 9 rolled + 2 levels × (+3 Constitution +2 Tough) = 31
	check("the dice are added as rolled, with Constitution and feats on top",
		await page.inputValue("#cs-hp-max") === "31", await page.inputValue("#cs-hp-max"));

	check("no page errors (rolled hp)", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
	await page.close();
}

/**
 * The three things a playtest matrix turned up, driven against the real data.
 *
 * An Elf Wizard built through the guide reached the table with an unanswered Elven Lineage and a
 * Sage background whose granted feat was taken and *still* listed as owed — the uid
 * `"magic initiate; wizard|xphb"` narrows the feat as well as naming it, and the whole string was
 * being matched against the feat's own name. And a Human Fighter offered Acrobatics by both its
 * species and its class could spend two of its three skill picks on one skill, because a skill
 * records a state rather than a count and the second grant lands on a box that is already ticked.
 */
export async function runPlaytestFindings ({browser, check}) {
	const ELF_WIZARD = {
		name: "Lineage Tester",
		level: 3,
		speciesText: "Elf",
		backgroundText: "Sage",
		refSpecies: {name: "Elf", source: "XPHB"},
		refBackground: {name: "Sage", source: "XPHB"},
		abil_str: 8,
		abil_dex: 14,
		abil_con: 13,
		abil_int: 16,
		abil_wis: 12,
		abil_cha: 10,
		hpMax: 20,
		hpCur: 20,
		classes: [{id: "a", name: "Wizard", source: "XPHB", level: 3, hdFaces: 6}],
		// The feat is taken, under the name a feat is actually stored with
		originFeats: [{id: "f", name: "Magic Initiate", source: "XPHB", displayName: "Magic Initiate — Wizard", bonuses: {}, from: "Sage"}],
	};

	const page = await openPage(browser, {url: BUILDER_URL, state: storeOf(ELF_WIZARD)});
	await page.locator("#cs-background-panel").waitFor({timeout: 20000});
	await page.waitForTimeout(2500);

	// ---------- a granted feat, taken, is not still owed ----------
	const bgText = await page.locator("#cs-background-panel").innerText();
	check("a narrowing feat uid ticks against the feat that was taken",
		/✓ Magic Initiate — Wizard/.test(bgText), bgText.slice(0, 300));
	check("and the build check does not ask for it again",
		!/Magic Initiate/.test(await page.locator("#cs-audit").innerText()),
		(await page.locator("#cs-audit").innerText()).slice(0, 250));

	// ---------- a "choose one of the following" trait is a question, not a trait card ----------
	const species = page.locator("#cs-species-panel");
	const speciesText = await species.innerText();
	// Matched as its own row, not anywhere in the panel — the lineage is also a trait card below
	const lineageRow = species.locator("div.ve-flex-v-center.ve-small").filter({hasText: "Elven Lineage"});
	check("the species panel asks for the lineage it has not been given",
		await lineageRow.count() === 1, speciesText.slice(0, 400));
	// Listed, not necessarily ticked: this character was loaded whole rather than built, so it never
	// went through the species-apply path — and the panel says so honestly with a ○
	check("the species panel lists the senses it grants outright",
		/Darkvision 60 ft\. \(sense\)/.test(speciesText), speciesText.slice(0, 300));
	check("and the build check says the same",
		/Elven Lineage/.test(await page.locator("#cs-audit").innerText()),
		(await page.locator("#cs-audit").innerText()).slice(0, 250));

	// Answering it clears it from both, without a reload
	await lineageRow.locator("button").first().click();
	await page.waitForTimeout(1500);
	const picker = page.locator(".ve-ui-modal__inner").last();
	await picker.locator("select").first().selectOption({index: 1});
	await picker.locator("button", {hasText: "OK"}).first().click();
	await page.waitForTimeout(1800);

	check("picking it records the choice",
		await page.evaluate(() => (window.__csPage._comp._state.traitChoices || []).some(it => it.trait === "Elven Lineage")),
		JSON.stringify(await page.evaluate(() => window.__csPage._comp._state.traitChoices)));
	check("the panel stops asking, without a reload",
		await lineageRow.count() === 0, (await species.innerText()).slice(0, 400));
	check("and so does the build check",
		!/Elven Lineage/.test(await page.locator("#cs-audit").innerText()),
		(await page.locator("#cs-audit").innerText()).slice(0, 250));

	check("no page errors (lineage)", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
	await page.close();

	// ---------- the same skill cannot be spent twice ----------
	const page2 = await openPage(browser, {url: BUILDER_URL, state: storeOf({name: "Skill Tester", level: 1, classes: []})});
	await page2.waitForTimeout(3000);
	await page2.click("#cs-btn-wizard");
	await page2.waitForSelector(".ve-ui-modal__overlay", {timeout: 15000});

	await pickWizardEntity(page2, {btnText: "Choose Species...", query: "human", rowText: "Human", srcText: "PHB'24"});
	await clickWizardNext(page2);
	await page2.waitForFunction(() => document.querySelector("#cs-wiz-sel-class")?.options.length > 1, {timeout: 20000});
	await page2.selectOption("#cs-wiz-sel-class", {label: "Fighter (PHB'24)"});
	await clickWizardNext(page2);
	await pickWizardEntity(page2, {btnText: "Choose Background...", query: "soldier", rowText: "Soldier", srcText: "PHB'24"});
	await clickWizardNext(page2);
	await page2.selectOption("#cs-wiz-sel-abil-method", "standardArray");
	await page2.waitForTimeout(400);
	// The step will not advance with the array unassigned
	const scores = ["15", "14", "13", "12", "10", "8"];
	const abvs = ["str", "dex", "con", "int", "wis", "cha"];
	for (let i = 0; i < 6; ++i) await page2.selectOption(`[data-cs-wiz-abv='${abvs[i]}']`, scores[i]);
	await clickWizardNext(page2);
	await page2.waitForTimeout(800);

	// Human's "choose 1 skill (any)" and Fighter's "choose 2 skills" overlap; taking Acrobatics for
	// one must take it off the table for the other
	const wiz = page2.locator(".ve-ui-modal__overlay").first();
	const acrobatics = wiz.locator("label", {hasText: "Acrobatics"});
	check("both choices offer the overlapping skill to begin with", await acrobatics.count() === 2, `${await acrobatics.count()}`);

	await acrobatics.first().locator("input").check();
	await page2.waitForTimeout(400);
	check("taking it for one source takes it off the other's list",
		await acrobatics.nth(1).locator("input").isDisabled(),
		(await wiz.innerText()).replace(/\s+/g, " ").slice(0, 400));
	check("and says why", /already chosen/i.test(await acrobatics.nth(1).getAttribute("title") || ""),
		await acrobatics.nth(1).getAttribute("title") || "(no title)");

	// Unticking hands it back
	await acrobatics.first().locator("input").uncheck();
	await page2.waitForTimeout(400);
	check("giving it up hands it back", !(await acrobatics.nth(1).locator("input").isDisabled()));

	// A skill the background grants outright is never offered as a pick either — the background is
	// not applied yet, so only the draft knows
	const athletics = wiz.locator("label", {hasText: "Athletics"});
	check("a skill the background will grant outright cannot be picked again",
		await athletics.first().locator("input").isDisabled(),
		(await wiz.innerText()).replace(/\s+/g, " ").slice(0, 500));

	check("no page errors (duplicate skills)", page2.errors.length === 0, page2.errors.slice(0, 3).join(" | "));
	await page2.close();

	await runReviewAttribution({browser, check});
}

/**
 * Every granted feat on the review says which entity grants it.
 *
 * A Human noble read "Species: Human … Origin Feat: Skilled, one of your choice", and the obvious
 * reading — that the species had granted Skilled — was the wrong one. The Human grants a feat of
 * your choice and one skill; Skilled comes from the Noble background. Nothing on that screen said
 * so, and the character it built was right while the summary that described it was not.
 */
async function runReviewAttribution ({browser, check}) {
	const page = await openPage(browser, {url: BUILDER_URL, state: storeOf({name: "Review Tester", level: 1, classes: []})});
	await page.waitForTimeout(3000);
	await page.click("#cs-btn-wizard");
	await page.waitForSelector(".ve-ui-modal__overlay", {timeout: 15000});

	await pickWizardEntity(page, {btnText: "Choose Species...", query: "human", rowText: "Human", srcText: "PHB'24"});
	await clickWizardNext(page);
	await page.waitForFunction(() => document.querySelector("#cs-wiz-sel-class")?.options.length > 1, {timeout: 20000});
	await page.selectOption("#cs-wiz-sel-class", {label: "Fighter (PHB'24)"});
	await clickWizardNext(page);
	// Noble grants Skilled by name; the Human grants one of your choice. Both must be attributed.
	await pickWizardEntity(page, {btnText: "Choose Background...", query: "noble", rowText: "Noble", srcText: "PHB'24"});
	await clickWizardNext(page);

	await page.selectOption("#cs-wiz-sel-abil-method", "standardArray");
	await page.waitForTimeout(400);
	const scores2 = ["15", "14", "13", "12", "10", "8"];
	const abvs2 = ["str", "dex", "con", "int", "wis", "cha"];
	for (let i = 0; i < 6; ++i) await page.selectOption(`[data-cs-wiz-abv='${abvs2[i]}']`, scores2[i]);
	await clickWizardNext(page);
	await clickWizardNext(page); // choices
	await clickWizardNext(page); // equipment

	const review = (await page.locator(".ve-ui-modal__overlay").first().innerText()).replace(/\s+/g, " ");
	check("the review names the entity that grants a feat by name",
		/Skilled \(from Noble\)/.test(review), review.slice(0, 500));
	check("and the entity whose feat is still to choose",
		/one of your choice \(from Human\)/.test(review), review.slice(0, 500));

	check("no page errors (review attribution)", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
	await page.close();

	await runFeatOwnChoices({browser, check});
	await runClassTableGrants({browser, check});
}

/**
 * What the *class table* grants, in both editions.
 *
 * Two fields nobody was reading. `featProgression` holds the 2024 Fighting Style (Fighter 1,
 * Paladin 2) and the Epic Boon at 19 — a Fighting Style is a feat of category `FS` now, not an
 * optional feature, so a 2024 Fighter went through the whole guided setup and was never once asked
 * for one. And `preparedSpellsProgression` replaced the 2014 formula with an exact by-level table,
 * so every 2024 prepared caster had no prepared limit at all.
 */
async function runClassTableGrants ({browser, check}) {
	const page = await openPage(browser, {
		url: BUILDER_URL,
		state: storeOf({
			name: "Table Tester",
			level: 5,
			abil_str: 16,
			abil_dex: 12,
			abil_con: 14,
			abil_int: 10,
			abil_wis: 10,
			abil_cha: 8,
			hpMax: 44,
			hpCur: 44,
			classes: [{id: "a", name: "Fighter", source: "XPHB", level: 5, hdFaces: 10}],
		}),
	});
	await page.locator("#cs-class-panel").waitFor({timeout: 20000});
	await page.waitForTimeout(3000);

	// The choosers live inside the collapsed "Features by level" section
	await page.evaluate(() => document.querySelectorAll("#cs-class-panel details").forEach(d => d.open = true));
	await page.waitForTimeout(400);

	const panelText = await page.locator("#cs-class-panel").innerText();
	check("the class panel offers the 2024 Fighter its Fighting Style",
		/Fighting Style \(0\/1\)/.test(panelText), panelText.slice(0, 400));
	// Offered once, not twice: the feature card and the class table describe the same grant
	check("and offers it exactly once",
		(panelText.match(/Choose Fighting Style/g) || []).length === 1, panelText.slice(0, 600));
	check("and the build check says it is owed",
		/Fighting Style/.test(await page.locator("#cs-audit").innerText()),
		(await page.locator("#cs-audit").innerText()).slice(0, 300));

	// Taking it clears both
	await page.locator("#cs-class-panel button", {hasText: "Choose Fighting Style"}).first().click();
	await page.waitForTimeout(1500);
	const picker = page.locator(".ve-ui-modal__inner").last();
	await picker.locator("select").first().selectOption({index: 1});
	await picker.locator("button", {hasText: /^OK$/}).first().click();
	await page.waitForTimeout(2000);

	const taken = await page.evaluate(() => (window.__csPage._comp._state.featureFeats || [])
		.filter(it => it.category === "FS").map(it => it.name));
	check("choosing one records a real feat of that category", taken.length === 1, JSON.stringify(taken));
	check("and the build check stops asking",
		!/Fighting Style/.test(await page.locator("#cs-audit").innerText()),
		(await page.locator("#cs-audit").innerText()).slice(0, 300));

	check("no page errors (class table feats)", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
	await page.close();

	// ---------- the 2024 prepared caster ----------
	const pageCleric = await openPage(browser, {
		url: BUILDER_URL,
		state: storeOf({
			name: "Prep Tester",
			level: 5,
			abil_str: 10,
			abil_dex: 10,
			abil_con: 14,
			abil_int: 10,
			abil_wis: 16,
			abil_cha: 10,
			hpMax: 38,
			hpCur: 38,
			classes: [{id: "a", name: "Cleric", source: "XPHB", level: 5, hdFaces: 8}],
		}),
	});
	await pageCleric.locator("#cs-class-panel").waitFor({timeout: 20000});
	await pageCleric.waitForTimeout(3000);

	// The 2024 table gives a Cleric 5 nine prepared spells, and does not use the ability modifier
	check("a 2024 prepared caster has a prepared limit at all",
		/prepares 9/.test(await pageCleric.locator("#cs-class-panel").innerText()),
		(await pageCleric.locator("#cs-class-panel").innerText()).slice(0, 500));

	check("no page errors (prepared spells)", pageCleric.errors.length === 0, pageCleric.errors.slice(0, 3).join(" | "));
	await pageCleric.close();
}

/**
 * A granted feat asks its own questions.
 *
 * Taking Skilled used to grant nothing at all: the 2024 feat states "any combination of three skills
 * or tools of your choice" in a sentence and carries no `skillProficiencies`, so there was nothing
 * to read and nothing to ask. Crafter and Musician *are* structured, and fared no better — their
 * three tools were written into a notes box, where nothing counts them. A proficiency as prose is
 * invisible to everything, exactly as an origin feat as prose was.
 */
async function runFeatOwnChoices ({browser, check}) {
	const base = {
		name: "Feat Tester",
		level: 1,
		abil_str: 10,
		abil_dex: 10,
		abil_con: 10,
		abil_int: 10,
		abil_wis: 10,
		abil_cha: 10,
		hpMax: 10,
		hpCur: 10,
		classes: [{id: "a", name: "Fighter", source: "XPHB", level: 1, hdFaces: 10}],
	};

	/** Take the background's granted feat, answering `n` of its own picks with the first option. */
	const pTake = async (page, n) => {
		await page.locator("#cs-background-panel button", {hasText: "Take it"}).first().click();
		await page.waitForTimeout(1200);
		await page.locator(".ve-ui-modal__inner button", {hasText: "Add" }).last().click();
		await page.waitForTimeout(1200);
		for (let i = 0; i < n; ++i) {
			const top = page.locator(".ve-ui-modal__inner").last();
			const sel = top.locator("select").first();
			if (!await sel.count()) break;
			await sel.selectOption({index: 1}).catch(() => {});
			await top.locator("button", {hasText: /^OK$/}).first().click().catch(() => {});
			await page.waitForTimeout(900);
		}
		await page.waitForTimeout(1200);
	};

	// ---------- Skilled: prose-only, three skills or tools ----------
	const pageSkilled = await openPage(browser, {
		url: BUILDER_URL,
		state: storeOf({...base, backgroundText: "Noble", refBackground: {name: "Noble", source: "XPHB"}}),
	});
	await pageSkilled.locator("#cs-background-panel").waitFor({timeout: 20000});
	await pageSkilled.waitForTimeout(2500);

	await pTake(pageSkilled, 3);

	const afterSkilled = await pageSkilled.evaluate(() => {
		const s = window.__csPage._comp._getState();
		return {
			feats: (s.originFeats || []).map(f => f.name),
			skills: Object.entries(s).filter(([k, v]) => k.startsWith("skill_") && Number(v) > 0).map(([k]) => k.slice(6)),
			tools: (s.proficiencies || []).filter(p => p.kind === "tool").length,
		};
	});
	check("Skilled is taken as a real feat", afterSkilled.feats.includes("Skilled"), JSON.stringify(afterSkilled));
	// Three picks, from one pool the feat lets you mix freely
	check("and its three skills-or-tools land on the character",
		afterSkilled.skills.length + afterSkilled.tools >= 3, JSON.stringify(afterSkilled));
	check("no page errors (Skilled)", pageSkilled.errors.length === 0, pageSkilled.errors.slice(0, 3).join(" | "));
	await pageSkilled.close();

	// ---------- Crafter: structured tool choice, previously only a note ----------
	const pageCrafter = await openPage(browser, {
		url: BUILDER_URL,
		state: storeOf({...base, backgroundText: "Artisan", refBackground: {name: "Artisan", source: "XPHB"}}),
	});
	await pageCrafter.locator("#cs-background-panel").waitFor({timeout: 20000});
	await pageCrafter.waitForTimeout(2500);

	await pTake(pageCrafter, 3);

	const afterCrafter = await pageCrafter.evaluate(() => {
		const s = window.__csPage._comp._getState();
		return {
			feats: (s.originFeats || []).map(f => f.name),
			tools: (s.proficiencies || []).filter(p => p.kind === "tool").map(p => p.source),
			profText: s.proficienciesText || "",
		};
	});
	check("Crafter is taken as a real feat", afterCrafter.feats.includes("Crafter"), JSON.stringify(afterCrafter));
	check("and its three tools are stored as proficiencies",
		afterCrafter.tools.filter(src => src === "Crafter").length === 3, JSON.stringify(afterCrafter));
	check("rather than as a line of text nothing counts",
		!/Crafter/.test(afterCrafter.profText), afterCrafter.profText.slice(0, 200));
	check("no page errors (Crafter)", pageCrafter.errors.length === 0, pageCrafter.errors.slice(0, 3).join(" | "));
	await pageCrafter.close();
}

async function pickWizardEntity (page, {btnText, query, rowText, srcText}) {
	await page.click(`.ve-ui-modal__overlay button:has-text('${btnText}')`);
	await page.waitForTimeout(1500);
	const top = page.locator(".ve-ui-modal__overlay").last();
	const ipt = top.locator(".ve-ui-search__ipt-search").first();
	await ipt.click();
	await ipt.pressSequentially(query, {delay: 30});
	await page.waitForTimeout(1400);
	const ix = await top.evaluate((_e, {rowText, srcText}) => {
		const rows = [...document.querySelectorAll(".ve-ui-modal__overlay:last-of-type .ve-ui-search__row")];
		return rows.findIndex(r => {
			const spans = r.querySelectorAll("span");
			return (spans[0]?.textContent || "").trim() === rowText && (spans[1]?.textContent || "").includes(srcText);
		});
	}, {rowText, srcText});
	if (ix < 0) throw new Error(`No row "${rowText}" for "${query}"`);
	await top.locator(".ve-ui-search__row").nth(ix).click();
	await page.waitForTimeout(1000);
}

const clickWizardNext = async page => {
	await page.click(`.ve-ui-modal__footer button:has-text('Next')`);
	await page.waitForTimeout(900);
};
