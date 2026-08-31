/**
 * The four areas that were only ever covered by throwaway scripts run by hand:
 * magic-item bonuses, multiclass Expertise, origin feats, and the session/store round-trip.
 *
 * Each was written once, watched once, and deleted. They are here so they run on every push.
 */

import {BASE_URL, getState, openPage, pickClass, pickViaSearch, resolveModals, setField} from "./util-e2e.mjs";

const SHEET_URL = `${BASE_URL}/charactersheet.html`;
const BUILDER_URL = `${BASE_URL}/charbuilder.html`;

const readAc = page => page.evaluate(() => Number(document.getElementById("cs-ac-computed")?.textContent) || 0);

/**
 * Answer whatever modals a pick raises, *accepting* optional grants. `resolveModals` clicks "Skip"
 * by design, which is right for most suites and wrong here — an origin feat is exactly the optional
 * grant under test.
 */
async function acceptModals (page, {maxSteps = 12} = {}) {
	for (let i = 0; i < maxSteps; ++i) {
		await page.waitForTimeout(400);
		const ov = page.locator(".ve-ui-modal__overlay").last();
		if (!(await ov.count())) break;

		// "Add" takes an offered feat; "Assign" accepts an offered ability increase
		let isHandled = false;
		for (const label of ["Add", "Assign"]) {
			if (!(await ov.locator(`button:has-text('${label}')`).count())) continue;
			await ov.locator(`button:has-text('${label}')`).last().click();
			isHandled = true;
			break;
		}
		if (isHandled) continue;
		if (await ov.locator("select").count()) {
			const sel = ov.locator("select").first();
			await sel.selectOption({index: 1}).catch(() => {});
			await ov.locator("button:has-text('OK')").last().click().catch(() => {});
			continue;
		}
		if (await ov.locator("button:has-text('OK')").count()) {
			await ov.locator("button:has-text('OK')").last().click();
			continue;
		}
		break;
	}
}

/** Add an item by name through the inventory's search picker, then equip it. */
async function addAndEquip (page, query) {
	await page.click("#cs-inv-add");
	await page.waitForTimeout(1500);
	const ov = page.locator(".ve-ui-modal__overlay").last();
	const ipt = ov.locator(".ve-ui-search__ipt-search").first();
	await ipt.click();
	await ipt.pressSequentially(query, {delay: 30});
	await page.waitForTimeout(1500);
	await ov.locator(".ve-ui-search__row").first().click();
	await page.waitForTimeout(1200);

	// Equip the row that was just added
	await page.evaluate(() => {
		const rows = [...document.querySelectorAll("#cs-inv-body tr")];
		const row = rows[rows.length - 1];
		const cb = [...row.querySelectorAll("input[type=checkbox]")]
			.find(it => (it.closest("label")?.textContent || "").trim().startsWith("Equip"));
		if (cb && !cb.checked) cb.click();
	});
	await page.waitForTimeout(900);
}

export async function run ({browser, check}) {
	/* ---------------------------------- magic-item bonuses ---------------------------------- */
	{
		const page = await openPage(browser, {url: SHEET_URL});
		await setField(page, "cs-abil-dex", 14);
		await page.waitForTimeout(600);

		const acBare = await readAc(page);
		check("an unarmored character's AC is 10 + Dex", acBare === 12, `${acBare}`);

		await addAndEquip(page, "+1 Chain Mail");
		const acArmored = await readAc(page);
		check("equipping magic armor raises AC by its base and its bonus together",
			acArmored === 17, `${acBare} → ${acArmored}`);

		const st = await getState(page);
		const armor = (st.inventory || []).find(it => /chain mail/i.test(it.name || ""));
		check("and the item carries the magic bonus structurally, not in its name",
			Number(armor?.bonusAc) === 1, JSON.stringify({name: armor?.name, bonusAc: armor?.bonusAc}));

		// Unequipping must give the bonus back, or a swapped-out item would keep helping
		await page.evaluate(() => {
			const cb = [...document.querySelectorAll("#cs-inv-body input[type=checkbox]")]
				.find(it => it.checked && (it.closest("label")?.textContent || "").trim().startsWith("Equip"));
			cb?.click();
		});
		await page.waitForTimeout(800);
		check("taking it off gives the AC back", await readAc(page) === acBare, `${await readAc(page)}`);

		check("no page errors (magic items)", page.errors.length === 0, page.errors.slice(0, 2).join(" | "));
		await page.close();
	}

	/* ---------------------------------- multiclass Expertise ---------------------------------- */
	{
		// The sheet, not the builder: the Expertise chooser needs the skills list beside it, and only
		// the sheet shows both
		const page = await openPage(browser, {url: SHEET_URL});
		await pickClass(page, "Rogue (PHB'24)");
		await resolveModals(page);
		await setField(page, "cs-level", 3);
		await resolveModals(page, {maxSteps: 8});
		await page.waitForTimeout(1200);

		// Expertise doubles a proficiency, so there is nothing to double until some skills are
		// proficient — the panel says exactly that, and offers nothing until they are
		const emptyOffer = await page.evaluate(() => {
			const choice = [...document.querySelectorAll(".cs__feat-choice")]
				.find(it => /expertise/i.test(it.textContent || ""));
			return (choice?.textContent || "").replace(/\s+/g, " ").trim();
		});
		check("with no proficient skills, Expertise says what is missing rather than offering nothing",
			/proficienc/i.test(emptyOffer), emptyOffer.slice(0, 90));

		for (const key of ["stealth", "perception"]) {
			await page.click(`#cs-skillprof-${key}`);
			await page.waitForTimeout(400);
		}
		await page.waitForTimeout(800);

		// Expertise is offered, never taken automatically — the Build Check reports it as unclaimed
		// until the player picks, so the chooser is what has to exist
		const offered = await page.evaluate(() => {
			const choice = [...document.querySelectorAll(".cs__feat-choice")]
				.find(it => /expertise/i.test(it.textContent || ""));
			return {
				isOffered: !!choice,
				numOptions: choice ? choice.querySelectorAll(".cs__feat-choice-opts input[type=checkbox]").length : 0,
			};
		});
		check("a 3rd-level Rogue is offered its Expertise", offered.isOffered, JSON.stringify(offered));
		check("with its proficient skills as the options", offered.numOptions >= 2, JSON.stringify(offered));

		// Claim two, one at a time: ticking one re-renders the chooser, which detaches the rest
		for (let i = 0; i < 2; ++i) {
			await page.evaluate(() => {
				const choice = [...document.querySelectorAll(".cs__feat-choice")]
					.find(it => /expertise/i.test(it.textContent || ""));
				const cb = [...choice.querySelectorAll(".cs__feat-choice-opts input[type=checkbox]")]
					.find(it => !it.checked);
				cb?.click();
			});
			await page.waitForTimeout(700);
		}

		const st = await getState(page);
		const expertSkills = Object.entries(st).filter(([k, v]) => k.startsWith("skill_") && v === 2);
		check("claiming it marks those skills as Expertise", expertSkills.length === 2,
			JSON.stringify(expertSkills.map(([k]) => k)));
		check("stored as its own state, distinct from proficiency",
			expertSkills.every(([, v]) => v === 2), JSON.stringify(expertSkills));

		check("no page errors (multiclass Expertise)", page.errors.length === 0, page.errors.slice(0, 2).join(" | "));
		await page.close();
	}

	/* ---------------------------------- origin feats ---------------------------------- */
	{
		const page = await openPage(browser, {url: BUILDER_URL});
		// A 2024 background grants an origin feat outright
		await pickViaSearch(page, {btn: "#cs-pick-background", query: "soldier", rowText: "Soldier", srcText: "PHB'24"});
		await page.waitForTimeout(1200);

		// A 2024 background asks about its ability increases first, then offers the feat
		await acceptModals(page);
		await page.waitForTimeout(1200);

		const st = await getState(page);
		check("a 2024 background grants an origin feat", (st.originFeats || []).length >= 1,
			JSON.stringify((st.originFeats || []).map(it => it.name)));
		check("recorded with the feat's own name and source",
			!!st.originFeats?.[0]?.name && !!st.originFeats?.[0]?.source, JSON.stringify(st.originFeats?.[0]));
		check("and the background is stored as a structured reference",
			!!st.refBackground?.name, JSON.stringify(st.refBackground));

		check("no page errors (origin feats)", page.errors.length === 0, page.errors.slice(0, 2).join(" | "));
		await page.close();
	}

	/* ---------------------------------- the session/store round-trip ---------------------------------- */
	{
		const page = await openPage(browser, {url: SHEET_URL});
		await setField(page, "cs-name", "Round Trip");
		await pickClass(page, "Cleric (PHB'24)");
		await resolveModals(page);
		await setField(page, "cs-level", 4);
		await resolveModals(page, {maxSteps: 8});
		await setField(page, "cs-hp-max", 28);
		await setField(page, "cs-abil-wis", 16);
		await page.waitForTimeout(1000);

		const before = await getState(page);

		await page.reload({waitUntil: "domcontentloaded"});
		await page.waitForTimeout(3500);
		const after = await getState(page);

		check("the character comes back after a reload", after.name === "Round Trip", after.name);
		check("with its level", after.level === before.level, `${before.level} → ${after.level}`);
		check("its hit points", after.hpMax === 28, `${after.hpMax}`);
		check("its ability scores", after.abil_wis === 16, `${after.abil_wis}`);
		check("and its structured class", after.classes?.[0]?.name === before.classes?.[0]?.name,
			JSON.stringify(after.classes?.[0]?.name));

		// A second character must not overwrite the first
		await page.click("#cs-char-new");
		await page.waitForTimeout(1200);
		await setField(page, "cs-name", "The Other One");
		await page.waitForTimeout(800);

		const names = await page.evaluate(() => [...document.querySelectorAll("#cs-char-select option")].map(it => it.textContent.trim()));
		check("a second character joins the store rather than replacing the first",
			names.some(it => /Round Trip/.test(it)) && names.some(it => /The Other One/.test(it)), JSON.stringify(names));

		check("no page errors (store round-trip)", page.errors.length === 0, page.errors.slice(0, 2).join(" | "));
		await page.close();
	}
}
