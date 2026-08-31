/**
 * The session journal: the sheet writes down what happened at the table on its own, and only when
 * it is really play — loading a character back must not read as a fight.
 */

import {BASE_URL, getState, openPage, pickClass, resolveModals, setField} from "./util-e2e.mjs";

const SHEET_URL = `${BASE_URL}/charactersheet.html`;

const readJournal = page => page.evaluate(() => ({
	sessions: [...document.querySelectorAll("#cs-journal .cs__journal-session")].map(s => ({
		num: s.querySelector(".cs__journal-num")?.textContent.trim(),
		text: s.querySelector(".cs__journal-text")?.textContent.trim(),
	})),
	empty: !!document.querySelector("#cs-journal .cs__journal-empty"),
}));

const kinds = async page => (await getState(page)).journal?.map(it => it.k) || [];

/** Damage/heal by the buttons, the way a player does it. */
async function adjustHp (page, amount, isDamage) {
	await page.fill("#cs-hp-delta", `${amount}`);
	await page.click(isDamage ? "#cs-hp-damage" : "#cs-hp-heal");
	await page.waitForTimeout(350);
}

export async function run ({browser, check}) {
	const page = await openPage(browser, {url: SHEET_URL});

	await setField(page, "cs-name", "Journal Test");
	await pickClass(page, "Fighter (PHB'24)");
	await resolveModals(page);
	await page.waitForTimeout(600);

	check("a character who has not played has an empty journal", (await readJournal(page)).empty);

	// ---------- it records play ----------
	await setField(page, "cs-hp-max", 30);
	await setField(page, "cs-hp-cur", 30);
	await page.waitForTimeout(400);
	const beforeCount = (await kinds(page)).length;

	await adjustHp(page, 12, true);
	await adjustHp(page, 5, true);
	await adjustHp(page, 4, false);

	const logged = await kinds(page);
	check("damage is written down", logged.filter(k => k === "dmg").length >= 2, JSON.stringify(logged));
	check("and so is healing", logged.includes("heal"), JSON.stringify(logged));

	await page.click("#cs-long-rest");
	await page.waitForTimeout(500);
	check("a rest is written down", (await kinds(page)).includes("rest"), JSON.stringify(await kinds(page)));

	// ---------- it writes the session up ----------
	const journal = await readJournal(page);
	check("the session appears once there is something to say", journal.sessions.length === 1, JSON.stringify(journal));
	check("summarised in a sentence, not a list of events",
		/took 17 damage/i.test(journal.sessions[0].text || ""), journal.sessions[0]?.text);
	check("mentioning the rest as well",
		/long rest/i.test(journal.sessions[0].text || ""), journal.sessions[0]?.text);

	// ---------- a condition is play; clearing it is not a second one ----------
	await page.click("[data-cs-cond=\"Poisoned\"]");
	await page.waitForTimeout(400);
	await page.click("[data-cs-cond=\"Poisoned\"]");
	await page.waitForTimeout(400);
	const withCond = await readJournal(page);
	check("a condition suffered is mentioned once, not twice",
		(withCond.sessions[0].text.match(/poisoned/gi) || []).length === 1, withCond.sessions[0]?.text);

	// ---------- the player can draw the line themselves ----------
	await page.click("[data-cs-journal-act=\"new\"]");
	await page.waitForTimeout(300);
	await adjustHp(page, 3, true);
	const split = await readJournal(page);
	check("pressing New session starts one, without waiting for a gap", split.sessions.length === 2, JSON.stringify(split.sessions));
	check("the newest session is listed first", split.sessions[0].num === "Session 2", JSON.stringify(split.sessions));
	check("and it holds only what came after the line",
		/took 3 damage/i.test(split.sessions[0].text), split.sessions[0].text);

	// ---------- reloading is not play ----------
	const beforeReload = (await kinds(page)).length;
	await page.reload({waitUntil: "domcontentloaded"});
	await page.waitForTimeout(3000);
	const afterReload = (await kinds(page)).length;
	check("re-opening the sheet records nothing — restoring hit points is not damage",
		afterReload === beforeReload, `${beforeReload} → ${afterReload}`);
	check("and the sessions survive the reload", (await readJournal(page)).sessions.length === 2);

	check("more was recorded than the character started with", beforeReload > beforeCount);
	check("no page errors", page.errors.length === 0, page.errors.slice(0, 2).join(" | "));
	await page.close();
}
