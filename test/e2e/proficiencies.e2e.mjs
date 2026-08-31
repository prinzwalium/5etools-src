/**
 * Structured armor / weapon / tool / language proficiencies: what the data grants, who granted it,
 * and adding or removing one by hand.
 */

import {BASE_URL, getState, openPage, pickClass, pickViaSearch, resolveModals} from "./util-e2e.mjs";

const readGroups = page => page.evaluate(() => [...document.querySelectorAll("#cs-prof-list .cs__prof-group")].map(g => ({
	label: g.querySelector(".cs__prof-group-lbl").textContent,
	items: [...g.querySelectorAll(".cs__prof-chip")].map(c => ({name: c.firstChild.textContent, title: c.title})),
})));

export async function run ({browser, check}) {
	/*
	 * With the newest printing preferred — the default — the 2014 Fighter and the ToA Archaeologist
	 * are superseded and never offered. This suite is about proficiency plumbing across the 2014-era
	 * content that exercises it (a Kaladesh Dwarf's artisan's-tool choice, a background's tool and
	 * language choices), so it asks for every printing rather than swapping in entries that grant
	 * nothing to choose.
	 */
	const stored = JSON.stringify({
		storeVersion: 1,
		currentId: "e2e",
		characters: {e2e: {version: 2, state: {name: "Prof Tester", level: 1, sourceFilter: {mode: "all", sources: {}, isPreferReprints: false}}}},
	});
	const page = await openPage(browser, {state: stored});
	const byLabel = (groups, label) => groups.find(g => g.label === label);

	check("the empty state says where these come from", /picking content/i.test(await page.textContent("#cs-prof-list")));

	// ---------- class ----------
	await pickClass(page, "Fighter (PHB'14)");
	await resolveModals(page);
	let groups = await readGroups(page);
	check("class armor proficiencies are listed", (byLabel(groups, "Armor")?.items || []).some(i => i.name === "Heavy"), JSON.stringify(byLabel(groups, "Armor")?.items?.map(i => i.name)));
	check("class weapon proficiencies are listed", (byLabel(groups, "Weapons")?.items || []).some(i => i.name === "Martial"));
	check("each entry names the source that granted it", byLabel(groups, "Armor").items.every(i => /From: Fighter/.test(i.title)), byLabel(groups, "Armor").items[0]?.title);

	// ---------- species: fixed languages, plus an artisan's-tool choice ----------
	await pickViaSearch(page, {btn: "#cs-pick-species", query: "dwarf", rowText: "Dwarf (Kaladesh)", srcText: "PSK"});
	await resolveModals(page);
	groups = await readGroups(page);
	check("species languages are listed with their source", (byLabel(groups, "Languages")?.items || [])
		.some(i => /Dwarvish/i.test(i.name) && /From: Dwarf \(Kaladesh\)/.test(i.title)), JSON.stringify(byLabel(groups, "Languages")?.items?.map(i => i.name)));
	check("an `anyArtisansTool` grant becomes a real pick", !!byLabel(groups, "Tools")?.items?.length, JSON.stringify(byLabel(groups, "Tools")?.items?.map(i => i.name)));

	// ---------- background: tool/language choices become structured entries ----------
	await pickViaSearch(page, {btn: "#cs-pick-background", query: "archaeologist", rowText: "Archaeologist", srcText: "ToA"});
	await resolveModals(page);
	groups = await readGroups(page);
	let state = await getState(page);
	check("background grants are recorded structurally", (state.proficiencies || []).some(it => it.source === "Archaeologist"),
		JSON.stringify((state.proficiencies || []).filter(it => it.source === "Archaeologist")));
	check("resolved choices no longer land in the free-text box", !/of your choice/i.test(state.proficienciesText || ""), state.proficienciesText);
	check("a proficiency granted twice is shown once",
		new Set(groups.flatMap(g => g.items.map(i => `${g.label}|${i.name}`))).size === groups.flatMap(g => g.items).length);
	check("a filter tag shows its text, not its filter expression",
		!(state.proficiencies || []).some(it => /=/.test(it.name)), JSON.stringify((state.proficiencies || []).map(it => it.name)));

	// ---------- by hand ----------
	const nBefore = (await getState(page)).proficiencies.length;
	await page.click("#cs-prof-add");
	await page.waitForTimeout(600);
	{
		const ov = page.locator(".ve-ui-modal__overlay").last();
		await ov.locator("select").selectOption({label: "Tools"});
		await ov.locator("button:has-text('OK')").last().click();
		await page.waitForTimeout(500);
		const ov2 = page.locator(".ve-ui-modal__overlay").last();
		await ov2.locator("input").first().fill("Glassblower's Tools");
		await ov2.locator("button:has-text('OK')").last().click();
	}
	await page.waitForTimeout(600);
	state = await getState(page);
	check("a proficiency can be added by hand", state.proficiencies.length === nBefore + 1 && state.proficiencies.some(it => it.name === "Glassblower's Tools"));

	groups = await readGroups(page);
	const manual = (byLabel(groups, "Tools")?.items || []).find(i => i.name === "Glassblower's Tools");
	check("a hand-added entry says so", /Added by hand/.test(manual?.title || ""), manual?.title);

	await page.evaluate(() => {
		const chip = [...document.querySelectorAll("#cs-prof-list .cs__prof-chip")].find(c => c.textContent.includes("Glassblower"));
		chip.querySelector(".cs__prof-chip-rm").click();
	});
	await page.waitForTimeout(600);
	state = await getState(page);
	check("and can be removed again", !state.proficiencies.some(it => it.name === "Glassblower's Tools"));

	// ---------- the play sheet shows the same list ----------
	const sheet = await openPage(browser, {
		url: `${BASE_URL}/charactersheet.html`,
		state: await page.evaluate(() => localStorage.getItem("charactersheet-characters")),
	});
	const sheetGroups = await readGroups(sheet);
	check("the play sheet renders the same proficiencies", sheetGroups.length >= 3 && sheetGroups.some(g => g.label === "Armor"), sheetGroups.map(g => g.label).join(", "));

	check("no page errors", [...page.errors, ...sheet.errors].length === 0, [...page.errors, ...sheet.errors].slice(0, 2).join(" | "));
	await sheet.close();
	await page.close();
}
