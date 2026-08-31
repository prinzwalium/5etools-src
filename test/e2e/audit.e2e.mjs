/**
 * The Build Check on the builder: what breaks a rule, and — the rarer half — what the character is
 * owed and has not taken. It reports; it never blocks.
 */

import {closeModal, openPage, pickClass, pickViaSearch, resolveModals, setField} from "./util-e2e.mjs";

const readAudit = page => page.evaluate(() => ({
	empty: document.querySelector("#cs-audit .ve-muted")?.textContent.trim() || null,
	rows: [...document.querySelectorAll("#cs-audit .cs__audit-row")].map(it => ({
		text: it.textContent.replace(/\s+/g, " ").trim(),
		broken: it.classList.contains("cs__audit-row--broken"),
		hint: it.title || null,
	})),
	groups: [...document.querySelectorAll("#cs-audit .cs__lbl")].map(it => it.textContent.trim()),
}));

const findRow = (audit, re) => audit.rows.find(it => re.test(it.text));

async function addItem (page, query) {
	await page.click("#cs-inv-add");
	await page.waitForTimeout(1200);
	const ov = page.locator(".ve-ui-modal__overlay").last();
	const ipt = ov.locator(".ve-ui-search__ipt-search").first();
	await ipt.click();
	await ipt.pressSequentially(query, {delay: 30});
	await page.waitForTimeout(1500);
	await ov.locator(".ve-ui-search__row").first().click();
	await page.waitForTimeout(1000);
	await closeModal(page);
}

export async function run ({browser, check}) {
	const page = await openPage(browser);

	// ---------- an empty character is all unclaimed, nothing broken ----------
	let audit = await readAudit(page);
	check("a blank character is told what it still needs", ["class", "species", "background"]
		.every(what => audit.rows.some(it => new RegExp(what, "i").test(it.text))), JSON.stringify(audit.rows.map(it => it.text)));
	check("and none of it counts as breaking a rule", audit.rows.every(it => !it.broken));
	check("under a heading that says as much", audit.groups.includes("Not yet chosen"), JSON.stringify(audit.groups));

	// ---------- filling those in clears them ----------
	await pickClass(page, "Fighter (PHB'24)");
	await resolveModals(page);
	await pickViaSearch(page, {btn: "#cs-pick-species", query: "human", rowText: "Human", srcText: "PHB'24"});
	await resolveModals(page);
	await pickViaSearch(page, {btn: "#cs-pick-background", query: "soldier", rowText: "Soldier", srcText: "PHB'24"});
	await resolveModals(page);
	await page.waitForTimeout(1200);

	audit = await readAudit(page);
	check("picking a class clears that finding", !findRow(audit, /No class picked/i), JSON.stringify(audit.rows.map(it => it.text)));
	check("and so do a species and background", !findRow(audit, /species|background/i));

	// ---------- an unclaimed weapon mastery, which the class grants ----------
	check("an unspent weapon mastery is flagged", !!findRow(audit, /weapon master/i), JSON.stringify(audit.rows.map(it => it.text)));
	check("and points at where to spend it", /class panel/i.test(findRow(audit, /weapon master/i)?.hint || ""), findRow(audit, /weapon master/i)?.hint);

	// ---------- a rule actually broken: four attuned items ----------
	for (const q of ["ring of protection", "cloak of protection", "amulet of health", "belt of dwarvenkind"]) {
		await addItem(page, q);
	}
	const nAttuned = await page.evaluate(() => {
		let n = 0;
		[...document.querySelectorAll("#cs-inventory tbody tr")].forEach(row => {
			const lbl = [...row.querySelectorAll(".cs__inv-flags label")].find(it => it.textContent.trim() === "Attune");
			if (!lbl) return;
			lbl.querySelector("input[type=checkbox]").click();
			++n;
		});
		return n;
	});
	await page.waitForTimeout(1500);
	check("four items that need attunement were attuned", nAttuned === 4, `${nAttuned} attuned`);

	audit = await readAudit(page);
	const attune = findRow(audit, /Attuned to/);
	check("a fourth attuned item breaks a rule", !!attune && attune.broken === true, JSON.stringify(audit.rows));
	check("and the message counts them", /Attuned to 4 items; the limit is 3/.test(attune?.text || ""), attune?.text);
	check("broken rules are grouped apart from unmade choices", audit.groups[0] === "Breaks a rule", JSON.stringify(audit.groups));

	// Un-attuning one settles it
	await page.evaluate(() => {
		const row = [...document.querySelectorAll("#cs-inventory tbody tr")].find(it => it.textContent.includes("Belt"));
		const lbl = [...row.querySelectorAll(".cs__inv-flags label")].find(it => it.textContent.trim() === "Attune");
		lbl.querySelector("input[type=checkbox]").click();
	});
	await page.waitForTimeout(1200);
	check("un-attuning one clears it", !findRow(await readAudit(page), /Attuned to/));

	// ---------- a skipped ability increase shows here too ----------
	const skipped = await openPage(browser);
	await skipped.click("#cs-pick-background");
	await skipped.waitForTimeout(1500);
	{
		const ov = skipped.locator(".ve-ui-modal__overlay").last();
		const ipt = ov.locator(".ve-ui-search__ipt-search").first();
		await ipt.click();
		await ipt.pressSequentially("soldier", {delay: 30});
		await skipped.waitForTimeout(1500);
		await ov.locator(".ve-ui-search__row").first().click();
		await skipped.waitForTimeout(1200);
	}
	await resolveModals(skipped, {maxSteps: 12});
	await skipped.waitForTimeout(1000);

	const skippedAudit = await readAudit(skipped);
	const offer = findRow(skippedAudit, /not yet assigned/);
	check("an ability increase that was skipped is listed", !!offer, JSON.stringify(skippedAudit.rows.map(it => it.text)));
	check("as something unchosen rather than something broken", offer?.broken === false, JSON.stringify(offer));
	await skipped.close();

	// ---------- a finished character says so ----------
	const clean = await openPage(browser, {
		state: JSON.stringify({
			storeVersion: 1,
			currentId: "clean",
			characters: {
				clean: {
					version: 2,
					state: {
						name: "Finished",
						level: 1,
						hpMax: 12,
						classes: [{id: "a", name: "Fighter", source: "XPHB", level: 1}],
						speciesText: "Human",
						backgroundText: "Soldier",
						weaponMasteries: ["Longsword", "Greataxe", "Shortsword"],
						// The 2024 Fighter's class table grants a Fighting Style at level 1; a character
						// that has not taken one is not finished, whatever else it has
						featureFeats: [{id: "f", entryId: "a", featureKey: "Fighting Style@1", category: "FS", name: "Archery", source: "XPHB", bonuses: {}}],
					},
				},
			},
		}),
	});
	await clean.waitForTimeout(3000);
	const cleanAudit = await readAudit(clean);
	check("a character with nothing outstanding is told so", /Nothing to flag/.test(cleanAudit.empty || ""), JSON.stringify(cleanAudit));
	check("with no rows at all", cleanAudit.rows.length === 0, JSON.stringify(cleanAudit.rows.map(it => it.text)));

	check("no page errors", [...page.errors, ...clean.errors].length === 0, [...page.errors, ...clean.errors].slice(0, 2).join(" | "));
	await clean.close();
	await page.close();
}
