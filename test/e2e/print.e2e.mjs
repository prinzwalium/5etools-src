/**
 * Printing, which is also the export — "Save as PDF" is the only PDF path this fork has.
 *
 * Everything here was previously checked by eye, which is why it kept breaking: what the screen
 * shows and what a printer is handed are two different documents, and nothing about the second is
 * visible while working on the first. So this drives the real print path — `emulateMedia`, the
 * page's own print preparation, and Chromium's PDF writer — and asserts the things that actually go
 * wrong: a textarea that prints only the lines its box showed, a collapsed feature card printing as
 * a title, controls on paper, and a character running to more pages than it needs.
 */

import {BASE_URL, openPage, setField} from "./util-e2e.mjs";

const SHEET_URL = `${BASE_URL}/charactersheet.html`;

/**
 * A4 at 96dpi, less the 12mm margin the print styles set: what one page can actually hold. Measured
 * against, rather than assumed, because how much wraps depends on the width it wraps into.
 */
const PRINTABLE = {width: 794 - 91, height: 1123 - 91};
const SIDEKICK_URL = `${BASE_URL}/sidekick.html`;

/** The store a filled-in character prints from. Long enough to run over one page, deliberately. */
const FULL_CHARACTER = JSON.stringify({
	storeVersion: 1,
	currentId: "printme",
	characters: {
		printme: {
			version: 2,
			state: {
				name: "Ilsa Printworthy",
				level: 5,
				classes: [{id: "a", name: "Rogue", source: "XPHB", level: 5, subclass: {name: "Thief", source: "XPHB"}}],
				speciesText: "Human",
				backgroundText: "Criminal",
				abil_str: 10,
				abil_dex: 18,
				abil_con: 14,
				abil_int: 12,
				abil_wis: 13,
				abil_cha: 8,
				hpMax: 38,
				hpCur: 38,
				speed: "30 ft.",
				save_dex: true,
				save_int: true,
				skill_stealth: 2,
				skill_perception: 1,
				skill_acrobatics: 1,
				skill_deception: 1,
				// The fields that print as mirrored text rather than as a control
				featuresText: "Sneak Attack 3d6.\nCunning Action: Dash, Disengage or Hide as a bonus action.\nUncanny Dodge.\nFast Hands.\nSecond-Story Work.",
				equipmentText: "Shortsword, shortbow, 20 arrows, thieves' tools, burglar's pack, studded leather.",
				proficienciesText: "Light armour, simple weapons, hand crossbows, longswords, rapiers, shortswords, thieves' tools, Common, Thieves' cant.",
				personalityText: "Keeps a tally of every debt owed to her, and every debt she owes.",
				notes: "Owes the Pale Tabard three hundred gold and a favour.",
			},
		},
	},
});

export async function run ({browser, check}) {
	const page = await openPage(browser, {url: SHEET_URL, state: FULL_CHARACTER});

	// ---------- what the screen shows and what paper gets are different documents ----------
	await page.emulateMedia({media: "print"});
	await page.evaluate(() => window.__csPage?._doPrintPrep?.());
	await page.waitForTimeout(300);

	const onPaper = await page.evaluate(() => {
		const isShown = sel => {
			const ele = document.querySelector(sel);
			return !!ele && getComputedStyle(ele).display !== "none";
		};
		const mirrors = [...document.querySelectorAll("#charsheet .cs__print-text")]
			.filter(ele => getComputedStyle(ele).display !== "none")
			.map(ele => ele.textContent.trim());

		return {
			isToolbar: isShown(".cs__toolbar"),
			isTextarea: isShown("#cs-features"),
			mirrors,
			// The break that makes the first page the one you keep in front of you
			breakBefore: getComputedStyle(document.querySelector(".cs__col--reference")).breakBefore,
			isDetailsOpen: [...document.querySelectorAll("#charsheet details")].every(ele => ele.open),
			// Anything a pen cannot fill in has no business on paper
			visibleButtons: [...document.querySelectorAll("#charsheet button")]
				.filter(ele => getComputedStyle(ele).display !== "none" && getComputedStyle(ele).visibility !== "hidden").length,
		};
	});

	check("the toolbar is not printed", onPaper.isToolbar === false);
	check("a textarea is replaced by its text, which can wrap and flow", onPaper.isTextarea === false);
	check("and that text is really the character's", onPaper.mirrors.some(it => it.includes("Cunning Action")),
		JSON.stringify(onPaper.mirrors).slice(0, 200));
	check("every collapsed section is opened for paper", onPaper.isDetailsOpen);
	check("the reference column starts its own page", onPaper.breakBefore === "page", onPaper.breakBefore);

	// ---------- how much paper, which is the whole of "print polish" ----------
	// Measured at the width a page actually has, since that is what decides how much wraps
	await page.setViewportSize({width: PRINTABLE.width, height: PRINTABLE.height});
	await page.waitForTimeout(400);

	const playHeight = await page.evaluate(() => {
		const reference = document.querySelector(".cs__col--reference");
		const top = document.querySelector("#charsheet").getBoundingClientRect().top;
		return Math.round(reference.getBoundingClientRect().top - top);
	});
	check("everything a turn needs fits on the first page", playHeight <= PRINTABLE.height,
		`${playHeight}px of ${PRINTABLE.height}px`);

	const pages = await pCountPdfPages(page);
	check("and the whole character is three pages, not five", pages <= 3, `${pages} pages`);

	// ---------- and nothing is left changed afterwards ----------
	await page.emulateMedia({media: "screen"});
	await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
	await page.waitForTimeout(300);

	const after = await page.evaluate(() => ({
		isToolbar: getComputedStyle(document.querySelector(".cs__toolbar")).display !== "none",
		isTextarea: getComputedStyle(document.querySelector("#cs-features")).display !== "none",
		reclosed: document.querySelectorAll("#charsheet details[data-cs-reclose]").length,
	}));
	check("the page comes back as the player left it", after.isToolbar && after.isTextarea && after.reclosed === 0,
		JSON.stringify(after));

	check("no page errors (sheet print)", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
	await page.close();

	await runEmptyPanels({browser, check});
	await runSidekickCard({browser, check});
}

/**
 * An empty panel is a heading with nothing under it: on screen a promise, on paper wasted space —
 * and wasted space is what pushes a character onto another page. So an untouched character is the
 * case to drive: nothing is marked, and nearly everything should therefore be left off.
 */
async function runEmptyPanels ({browser, check}) {
	const page = await openPage(browser, {url: SHEET_URL});
	await page.emulateMedia({media: "print"});
	await page.evaluate(() => window.__csPage?._doPrintPrep?.());
	await page.waitForTimeout(300);

	const flagged = await page.evaluate(() => [...document.querySelectorAll("#charsheet .cs__panel--print-empty")]
		.map(ele => ({
			title: ele.querySelector(".cs__panel-title")?.textContent.trim() || "",
			isHidden: getComputedStyle(ele).display === "none",
		})));

	check("a panel whose lists are all unmarked is flagged", flagged.length > 0, JSON.stringify(flagged));
	check("and flagged means hidden on paper", flagged.every(it => it.isHidden), JSON.stringify(flagged));

	// A blank sheet still prints — as something to fill in by hand, on one page
	const pages = await pCountPdfPages(page);
	check("a character with nothing in it is not three pages of headings", pages <= 2, `${pages} pages`);

	// And a filled-in one keeps the panels it filled in
	const full = await openPage(browser, {url: SHEET_URL, state: FULL_CHARACTER});
	await full.emulateMedia({media: "print"});
	await full.evaluate(() => window.__csPage?._doPrintPrep?.());
	await full.waitForTimeout(300);

	const kept = await full.evaluate(() => [...document.querySelectorAll("#charsheet .cs__panel")]
		.filter(ele => getComputedStyle(ele).display !== "none")
		.map(ele => ele.querySelector(".cs__panel-title")?.textContent.trim() || "")
		.filter(Boolean));
	check("the panels with something in them are still printed",
		kept.includes("Saving Throws") && kept.includes("Skills") && kept.includes("Equipment"), JSON.stringify(kept));
	// A log of past evenings is not part of the sheet somebody plays from
	check("the session journal is not printed", !kept.includes("Session Journal"), JSON.stringify(kept));

	check("no page errors (empty panels)", page.errors.length === 0 && full.errors.length === 0,
		[...page.errors, ...full.errors].slice(0, 3).join(" | "));
	await page.close();
	await full.close();
}

/**
 * A sidekick prints as a stat-block card rather than a character sheet — a DM runs it from the page
 * the way they run anything else in the book. So it must *not* take the sheet's page break, and it
 * must fit on one page.
 */
async function runSidekickCard ({browser, check}) {
	const page = await openPage(browser, {url: SIDEKICK_URL});
	await setField(page, "cs-name", "Sir Braun");
	await setField(page, "cs-hp-max", 22);
	await page.waitForTimeout(600);

	await page.emulateMedia({media: "print"});
	await page.evaluate(() => window.__csPage?._doPrintPrep?.());
	await page.waitForTimeout(300);

	const card = await page.evaluate(() => ({
		isStatCard: document.querySelector("main")?.classList.contains("cs__page--sidekick"),
		hasReferenceBreak: !!document.querySelector(".cs__col--reference"),
		isToolbar: getComputedStyle(document.querySelector(".cs__toolbar")).display !== "none",
	}));

	check("a sidekick prints as its own stat card", card.isStatCard === true);
	check("and is never split at the sheet's page break", card.hasReferenceBreak === false);
	check("with the controls off the page", card.isToolbar === false);

	const pages = await pCountPdfPages(page);
	check("a sidekick card is one page", pages === 1, `${pages} pages`);

	check("no page errors (sidekick card)", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
	await page.close();
}

/**
 * How many pages the browser would actually produce.
 *
 * Chromium's own PDF writer is the same one behind "Save as PDF", so this is the export itself
 * rather than a guess about it. The page count is read straight out of the file: a PDF names every
 * page object, and counting them needs no parser.
 */
async function pCountPdfPages (page) {
	const buf = await page.pdf({format: "A4", printBackground: false});
	const matches = buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g);
	return matches ? matches.length : 0;
}
