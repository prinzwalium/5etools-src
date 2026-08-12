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
