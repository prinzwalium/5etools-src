/**
 * The per-character source filter: presets, what the pickers then offer, and the rule that content
 * already on a character is kept and flagged rather than hidden.
 */

import {closeModal, getState, openPage, STORAGE_KEY} from "./util-e2e.mjs";

const modal = page => page.locator(".ve-ui-modal__overlay").last();

const readClassOptions = async page => {
	await page.click("#cs-pick-class");
	await page.waitForFunction(() => {
		const sel = document.querySelector(".ve-ui-modal__overlay select");
		return sel && sel.options.length > 1;
	}, {timeout: 20000});
	return page.evaluate(() => [...document.querySelectorAll(".ve-ui-modal__overlay select option")]
		.map(o => o.textContent.trim())
		.filter(o => !/^Select/.test(o)));
};

export async function run ({browser, check}) {
	const page = await openPage(browser);

	check("the toolbar starts unfiltered", (await page.locator("#cs-sources-label").textContent()).trim() === "All sources");

	const allClasses = await readClassOptions(page);
	await closeModal(page);
	// The default is every book, with the newest printing of anything printed twice — so the 2024
	// classes are offered, the 2014 ones they reprint are not, and a class the new books never
	// printed is still there. `preferreprints` drives that rule; this only checks the starting point
	check("the 2024 classes are offered by default", allClasses.some(c => /PHB'24/.test(c)), `n=${allClasses.length}`);
	check("and the 2014 ones they reprint are not", !allClasses.some(c => /PHB'14/.test(c)), allClasses.filter(c => /PHB'14/.test(c)).join(", ") || "none");
	check("while a class the 2024 books never printed remains", allClasses.some(c => /Artificer/.test(c)), allClasses.filter(c => /Artificer/.test(c)).join(", ") || "none");

	// ---------- switch to 2024 only ----------
	await page.click("#cs-btn-sources");
	await page.waitForTimeout(900);
	check("the sources dialog offers presets", await modal(page).locator("button:has-text('2024 rules only')").count() >= 1);
	await modal(page).locator("button:has-text('2024 rules only')").first().click();
	await page.waitForTimeout(400);
	check("a preset says how many books it allows", /allows \d+ of \d+ books/.test(await modal(page).textContent()));
	await modal(page).locator("button:has-text('Save')").last().click();
	await page.waitForTimeout(900);

	check("the toolbar reflects the choice", (await page.locator("#cs-sources-label").textContent()).trim() === "2024 rules only");
	let state = await getState(page);
	check("the filter is stored on the character", state.sourceFilter?.mode === "modern", JSON.stringify(state.sourceFilter));

	// ---------- pickers narrow ----------
	const modernClasses = await readClassOptions(page);
	check("the class picker drops 2014 classes", !modernClasses.some(c => /PHB'14/.test(c)), modernClasses.filter(c => /PHB'14/.test(c)).slice(0, 3).join(", ") || "none");
	check("and keeps the 2024 ones", modernClasses.some(c => /PHB'24/.test(c)), `n=${modernClasses.length}`);
	await closeModal(page);

	// ---------- content already on the character is kept, and flagged ----------
	await page.evaluate(key => {
		const store = JSON.parse(localStorage.getItem(key));
		const env = store.characters[store.currentId];
		// A 2014 Rogue with a 2014 subclass, under a 2024-only filter
		env.state.classes = [{
			id: "c1",
			name: "Rogue",
			source: "PHB",
			level: 3,
			hdFaces: 8,
			subclass: {name: "Thief", shortName: "Thief", source: "PHB"},
			optionalFeatures: [],
			asiFeatChoices: [],
		}];
		env.state.sourceFilter = {mode: "modern", sources: {}};
		localStorage.setItem(key, JSON.stringify(store));
	}, STORAGE_KEY);
	await page.reload({waitUntil: "load"});
	await page.waitForTimeout(2500);

	const note = await page.locator("#cs-sources-note").textContent();
	check("out-of-filter content is flagged", /outside its source filter/.test(note) && /PHB/.test(note), note.replace(/\s+/g, " ").slice(0, 140));

	const panelTxt = await page.locator("#cs-class-panel").textContent();
	check("but the class still renders", /Rogue/.test(panelTxt));
	check("and its subclass features still resolve", /Thief/.test(panelTxt) && /Sneak Attack/.test(panelTxt), panelTxt.replace(/\s+/g, " ").slice(0, 120));

	// ---------- custom mode ----------
	await page.click("#cs-btn-sources");
	await page.waitForTimeout(900);
	await modal(page).locator("button:has-text('Custom')").first().click();
	await page.waitForTimeout(500);
	const nBoxes = await modal(page).locator("input[type=checkbox]").count();
	check("custom mode lists the books individually", nBoxes > 10, `checkboxes=${nBoxes}`);
	check("and starts from the previous preset", (await modal(page).locator("input[type=checkbox]:checked").count()) > 0);

	await modal(page).locator("button:has-text('None')").first().click();
	await page.waitForTimeout(300);
	await modal(page).locator("button:has-text('Save')").last().click();
	await page.waitForTimeout(900);

	state = await getState(page);
	check("a custom filter is stored", state.sourceFilter?.mode === "custom", JSON.stringify(state.sourceFilter?.mode));
	check("and the toolbar shows the book count", /\d+ books?/.test(await page.locator("#cs-sources-label").textContent()));

	check("no page errors", page.errors.length === 0, page.errors.slice(0, 2).join(" | "));
	await page.close();
}
