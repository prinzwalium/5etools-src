/**
 * Rule citations: every number's breakdown says not just what went into it, but which rule lets
 * each part count — and the rule's own text is one click away, out of the book the app ships.
 */

import {BASE_URL, openPage, pickClass, resolveModals, setField} from "./util-e2e.mjs";

const SHEET_URL = `${BASE_URL}/charactersheet.html`;

/** Open the breakdown popover for an element and read what it offers. */
async function openBreakdown (page, selector) {
	await page.click(selector);
	await page.waitForTimeout(400);
	return page.evaluate(() => {
		const pop = document.getElementById("cs-breakdown-popover");
		if (!pop) return null;
		return {
			head: pop.querySelector(".cs__breakdown-head")?.textContent.trim() || null,
			rows: [...pop.querySelectorAll(".cs__breakdown-row")].map(row => ({
				label: row.querySelector(".cs__breakdown-label")?.textContent.trim(),
				value: row.querySelector(".cs__breakdown-value")?.textContent.trim() || null,
				cite: row.querySelector(".cs__cite-btn")?.textContent.trim() || null,
			})),
		};
	});
}

const readRuleModal = page => page.evaluate(() => {
	const body = document.querySelector(".cs__cite-body");
	if (!body) return null;
	return {
		title: document.querySelector(".ve-modal__title, .ui-modal__title")?.textContent.trim() || null,
		text: body.textContent.replace(/\s+/g, " ").trim(),
		source: body.querySelector(".cs__cite-source")?.textContent.trim() || null,
	};
});

export async function run ({browser, check}) {
	const page = await openPage(browser, {url: SHEET_URL});

	await setField(page, "cs-name", "Cite Test");
	await pickClass(page, "Fighter (PHB'24)");
	await resolveModals(page);
	await setField(page, "cs-level", 5);
	await resolveModals(page, {maxSteps: 6});
	await setField(page, "cs-abil-dex", 16);
	await page.waitForTimeout(800);

	// ---------- a save lists its parts, each with its rule ----------
	const save = await openBreakdown(page, "#cs-savename-dex");
	check("a save's breakdown opens as a list of contributions", !!save && save.rows.length >= 1, JSON.stringify(save));
	check("headed by the number it explains", /Dexterity save/.test(save.head || ""), save.head);

	const dexRow = save.rows.find(r => r.label === "Dexterity");
	check("the ability part is credited to the ability rule",
		dexRow?.cite === "Ability Score and Modifier", JSON.stringify(dexRow));
	check("and carries its own value", dexRow?.value === "+3", JSON.stringify(dexRow));

	// ---------- the rule's own text, from the book ----------
	await page.click(".cs__breakdown-row .cs__cite-btn");
	await page.waitForTimeout(2500);
	const rule = await readRuleModal(page);
	check("clicking a rule shows the book's own text", !!rule && rule.text.length > 40, JSON.stringify(rule)?.slice(0, 160));
	check("...for the rule that was clicked", /modifier/i.test(rule?.text || ""), rule?.text?.slice(0, 120));
	check("with the source and page it came from", /p\.\s*\d+/.test(rule?.source || ""), rule?.source);
	check("and no unresolved data tags", !/\{@/.test(rule?.text || ""), rule?.text?.slice(0, 120));

	await page.keyboard.press("Escape");
	await page.waitForTimeout(500);

	// ---------- a whole number gets the rule it is computed under ----------
	const passive = await openBreakdown(page, "#cs-passive-perception");
	check("passive Perception cites the passive Perception rule",
		passive?.rows.some(r => r.cite === "Passive Perception"), JSON.stringify(passive?.rows));

	// ---------- Armor Class, where the parts name their own rules ----------
	const ac = await openBreakdown(page, "#cs-ac-computed");
	check("an unarmored AC credits the Armor Class rule for its base",
		ac?.rows.some(r => r.label === "Unarmored" && r.cite === "Armor Class"), JSON.stringify(ac?.rows));
	check("and the ability rule for the Dexterity it adds",
		ac?.rows.some(r => r.label === "Dexterity" && r.cite === "Ability Score and Modifier"), JSON.stringify(ac?.rows));
	// The parts already point at the Armor Class rule, so repeating it as a trailing "Rule" row
	// would just be the same link twice
	check("a rule already named by a part is not repeated for the whole number",
		ac?.rows.filter(r => r.cite === "Armor Class").length === 1, JSON.stringify(ac?.rows));

	check("no page errors", page.errors.length === 0, page.errors.slice(0, 2).join(" | "));
	await page.close();
}
