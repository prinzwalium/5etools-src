/**
 * Accessibility, held in place.
 *
 * These are not aspirations — every rule here was failing when it was written, and each one is
 * cheap to break again by adding a control the ordinary way. The audit that found them lived for an
 * afternoon; this is the part that has to outlast it.
 *
 * Scoped to `#charsheet` and our own toolbar, because the navbar and the dice roller are upstream's
 * and fixing them here would be a merge conflict every time upstream touches them.
 */

import {BASE_URL, openPage} from "./util-e2e.mjs";

const PAGES = ["charactersheet.html", "charbuilder.html", "sidekick.html"];

/** Runs in the browser: what has no accessible name, and what has no label. */
const AUDIT = () => {
	const isVisible = ele => !!(ele.offsetWidth || ele.offsetHeight || ele.getClientRects().length);
	const brief = ele => ele.outerHTML.slice(0, 110).replace(/\s+/g, " ");

	const textOf = ids => (ids || "").split(/\s+/).filter(Boolean)
		.map(id => (document.getElementById(id)?.textContent || "").trim())
		.join(" ").trim();

	// `aria-labelledby` is resolved rather than merely present: a dangling id reads as a label to a
	// naive check and as nothing at all to a screen reader. That exact mistake got past the first
	// version of this audit.
	const nameOf = ele => (ele.getAttribute("aria-label") || "").trim()
		|| textOf(ele.getAttribute("aria-labelledby"))
		|| (ele.getAttribute("title") || "").trim()
		|| (ele.textContent || "").trim();

	const scope = ["#charsheet", ".cs__toolbar"];
	const findAll = sel => scope.flatMap(root => [...document.querySelectorAll(`${root} ${sel}`)]).filter(isVisible);

	const out = {unnamed: [], unlabelled: [], positiveTabindex: []};

	findAll("button, a[href]").forEach(ele => { if (!nameOf(ele)) out.unnamed.push(brief(ele)); });

	findAll("input, select, textarea").forEach(ele => {
		if (ele.type === "hidden") return;
		const isLabelled = (ele.id && document.querySelector(`label[for="${CSS.escape(ele.id)}"]`))
			|| ele.closest("label")
			|| nameOf(ele);
		if (!isLabelled) out.unlabelled.push(brief(ele));
	});

	// A positive tabindex reorders the whole page's focus, not just its own element
	findAll("[tabindex]").forEach(ele => { if (Number(ele.getAttribute("tabindex")) > 0) out.positiveTabindex.push(brief(ele)); });

	return out;
};

export async function run ({browser, check}) {
	for (const name of PAGES) {
		const page = await openPage(browser, {url: `${BASE_URL}/${name}`});
		const found = await page.evaluate(AUDIT);

		check(`${name}: every control says what it is`, !found.unnamed.length, found.unnamed.slice(0, 4).join(" | "));
		check(`${name}: every field has a label`, !found.unlabelled.length, found.unlabelled.slice(0, 4).join(" | "));
		check(`${name}: nothing hijacks the tab order`, !found.positiveTabindex.length, found.positiveTabindex.slice(0, 3).join(" | "));

		await page.close();
	}

	// ---------- the citations, by keyboard ----------
	// "Every number cites its rule" was reachable by mouse and by nothing else: the breakdowns open
	// from a click delegate on plain spans, which no keyboard can reach.
	const page = await openPage(browser, {url: `${BASE_URL}/charactersheet.html`});

	const target = page.locator("[data-cs-breakdown]").first();
	check("a value with a breakdown is a control", await target.getAttribute("role") === "button",
		await target.getAttribute("role") ?? "(no role)");
	check("and is in the tab order", await target.getAttribute("tabindex") === "0",
		await target.getAttribute("tabindex") ?? "(none)");

	await target.focus();
	check("so it can hold focus", await page.evaluate(() => document.activeElement?.hasAttribute("data-cs-breakdown")));

	await page.keyboard.press("Enter");
	await page.waitForTimeout(400);
	check("Enter opens the breakdown", await page.locator("#cs-breakdown-popover").count() === 1);
	check("and the control says it is open", await target.getAttribute("aria-expanded") === "true");

	await page.keyboard.press("Escape");
	await page.waitForTimeout(400);
	check("Escape closes it again", await page.locator("#cs-breakdown-popover").count() === 0);
	check("and the control says so", await target.getAttribute("aria-expanded") === "false");

	// ---------- death saves ----------
	// Six identical circles: one control to a mouse, six anonymous buttons to anything else
	const dot = page.locator("#cs-death-success .cs__death-dot").first();
	check("a death save dot says which it is", (await dot.getAttribute("aria-label")) === "Death save success 1",
		await dot.getAttribute("aria-label") ?? "(none)");
	check("and starts unset", await dot.getAttribute("aria-pressed") === "false");

	await dot.click();
	await page.waitForTimeout(400);
	check("and reports being set once it is", await dot.getAttribute("aria-pressed") === "true");

	check("no page errors", page.errors.length === 0, page.errors.slice(0, 2).join(" | "));
	await page.close();
}
