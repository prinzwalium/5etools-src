/**
 * The account-system seam, with no account system deployed — which is the state this repo ships in,
 * and a supported deployment rather than a degraded one (the Pages build is static, with no proxy).
 *
 * What matters is that looking for one is completely inert: no console errors, no failed load that
 * bothers the player, and storage still entirely local.
 */

import {BASE_URL, getState, openPage, setField} from "./util-e2e.mjs";

const SHEET_URL = `${BASE_URL}/charactersheet.html`;
const SIDEKICK_URL = `${BASE_URL}/sidekick.html`;

export async function run ({browser, check}) {
	const page = await openPage(browser, {url: SHEET_URL});

	// ---------- nothing deployed: the page must not care ----------
	check("with no account system, no adapter is picked up",
		await page.evaluate(() => typeof window.CharacterSyncAdapter === "undefined"));

	check("and the page reports sync as off", await page.evaluate(() => window.__csPage?.isSyncEnabled === false),
		JSON.stringify(await page.evaluate(() => ({hasPage: !!window.__csPage, sync: window.__csPage?.isSyncEnabled}))));

	// A 404 for the client script is the ordinary case, not an error worth showing anyone
	check("a missing account system is not reported as a page error",
		page.errors.length === 0, page.errors.slice(0, 3).join(" | "));

	// ---------- the character still works, and stays in this browser ----------
	await setField(page, "cs-name", "Local Only");
	await setField(page, "cs-hp-max", 21);
	await page.waitForTimeout(700);

	const st = await getState(page);
	check("a character is still edited normally", st.name === "Local Only" && st.hpMax === 21, JSON.stringify({name: st.name, hpMax: st.hpMax}));

	await page.reload({waitUntil: "domcontentloaded"});
	await page.waitForTimeout(3000);
	check("and still persists locally across a reload", (await getState(page)).name === "Local Only");

	// ---------- the path is configuration, not a constant ----------
	const paths = await page.evaluate(async () => {
		const mod = await import("/js/charactersheet/charactersheet-sync.js");
		return {
			fallback: mod.getSyncBasePath({win: {}, doc: {querySelector: () => null}}),
			viaMeta: mod.getSyncBasePath({win: {}, doc: {querySelector: () => ({getAttribute: () => "/accounts"})}}),
			viaWindow: mod.getSyncBasePath({win: {CHARACTER_SYNC_PATH: "/elsewhere"}, doc: {querySelector: () => null}}),
			off: mod.getSyncBasePath({win: {CHARACTER_SYNC_PATH: ""}, doc: {querySelector: () => null}}),
			client: mod.getSyncClientUrl("/online"),
		};
	});
	check("the default path is /online", paths.fallback === "/online", JSON.stringify(paths));
	check("a deployment can move it", paths.viaMeta === "/accounts" && paths.viaWindow === "/elsewhere", JSON.stringify(paths));
	check("or switch it off entirely", paths.off === null, JSON.stringify(paths));
	check("and the client script hangs off whatever path is set", paths.client === "/online/client.js", paths.client);

	check("no page errors", page.errors.length === 0, page.errors.slice(0, 2).join(" | "));
	await page.close();

	// ---------- with an account system answering ----------
	// The badge is the only thing that tells a player any of this is connected, so it is worth
	// driving against a real page rather than trusting the pure status function alone.

	const signedOut = await openWithStubAdapter(browser, {user: null});
	check("a connected account system shows a badge", await signedOut.locator("#cs-sync-badge").count() === 1);
	check("and says nobody is signed in", (await signedOut.locator("#cs-sync-badge").innerText()).includes("Signed out"),
		await signedOut.locator("#cs-sync-badge").innerText().catch(() => "(absent)"));

	await signedOut.click("#cs-sync-badge");
	await signedOut.waitForTimeout(400);
	const outText = await signedOut.locator(".ve-ui-modal__inner").last().innerText();
	check("clicking it says where it looked", outText.includes("/online"), outText.slice(0, 200));
	check("and offers a way to sign in", await signedOut.locator(".ve-ui-modal__inner a:has-text('Sign in')").count() === 1);
	check("no page errors (signed out)", signedOut.errors.length === 0, signedOut.errors.slice(0, 2).join(" | "));
	await signedOut.close();

	const signedIn = await openWithStubAdapter(browser, {user: {id: "u1", name: "Ada", role: "admin"}});
	const inLabel = await signedIn.locator("#cs-sync-badge").innerText();
	check("a signed-in badge names the person", inLabel.includes("Ada"), inLabel);

	await signedIn.click("#cs-sync-badge");
	await signedIn.waitForTimeout(400);
	const inText = await signedIn.locator(".ve-ui-modal__inner").last().innerText();
	check("the detail shows the role", inText.includes("admin"), inText.slice(0, 200));
	// Phase 0 of the account system signs you in but stores nothing; that must not read as "online"
	check("and says characters are not stored online yet", /only copy/.test(inText), inText.slice(0, 300));
	await signedIn.close();

	// A service that is there but broken is exactly what the badge exists to make visible
	const broken = await openWithStubAdapter(browser, {failWith: "502 Bad Gateway"});
	const badLabel = await broken.locator("#cs-sync-badge").innerText();
	check("an unreachable account system reads as offline", badLabel.includes("Offline"), badLabel);

	await broken.click("#cs-sync-badge");
	await broken.waitForTimeout(400);
	check("and clicking it shows the error itself",
		(await broken.locator(".ve-ui-modal__inner").last().innerText()).includes("502 Bad Gateway"));
	check("a failing account system is still not a page error", broken.errors.length === 0, broken.errors.slice(0, 2).join(" | "));
	await broken.close();

	await runStorage({browser, check});
}

/**
 * With an account system that really stores characters.
 *
 * The pure planning is unit-tested; what needs a browser is that the buttons move a character in the
 * direction they say, and that a conflict asks rather than picks.
 */
async function runStorage ({browser, check}) {
	const page = await openWithStubAdapter(browser, {user: {id: "u1", name: "Ada", role: "user"}, isStorage: true});

	await setField(page, "cs-name", "Pushable");
	await page.waitForTimeout(800);

	const openPanel = async () => {
		await page.click("#cs-sync-badge");
		await page.waitForTimeout(600);
		return page.locator(".ve-ui-modal__inner").last();
	};

	const badge = await page.locator("#cs-sync-badge").innerText();
	check("a working account system reads as fully online", !/only copy/.test(badge) && badge.includes("Ada"), badge);

	let panel = await openPanel();
	check("it lists the character as being in this browser only",
		(await panel.innerText()).includes("this browser only"), (await panel.innerText()).slice(0, 200));

	await panel.locator("button:has-text('Upload')").first().click();
	await page.waitForTimeout(900);
	check("uploading puts it on the server",
		(await page.evaluate(() => Object.keys(window.__stubStore.characters).length)) === 1);
	check("and the row now says it is in both", (await panel.innerText()).includes("in both"), (await panel.innerText()).slice(0, 200));

	const stored = await page.evaluate(() => Object.values(window.__stubStore.characters)[0].envelope.state.name);
	check("with the character's own name", stored === "Pushable", stored);

	await page.keyboard.press("Escape");
	await page.waitForTimeout(300);

	// ---------- pulling what the server holds ----------
	await page.evaluate(() => {
		const entry = Object.values(window.__stubStore.characters)[0];
		entry.envelope = {...entry.envelope, state: {...entry.envelope.state, name: "Changed Elsewhere"}};
		entry.version += 1;
	});

	panel = await openPanel();
	await panel.locator("button:has-text('Pull')").first().click();
	await page.waitForTimeout(1200);
	check("pulling replaces this browser's copy",
		(await getState(page)).name === "Changed Elsewhere", JSON.stringify((await getState(page)).name));

	await page.keyboard.press("Escape");
	await page.waitForTimeout(300);

	// ---------- a conflict asks, and never picks ----------
	await setField(page, "cs-name", "Mine");
	await page.waitForTimeout(800);
	await page.evaluate(() => {
		const entry = Object.values(window.__stubStore.characters)[0];
		entry.envelope = {...entry.envelope, state: {...entry.envelope.state, name: "Theirs"}};
		entry.version += 1; // the server has moved on without us
	});

	panel = await openPanel();
	await panel.locator("button:has-text('Push')").first().click();
	await page.waitForTimeout(1000);

	const prompt = page.locator(".ve-ui-modal__inner").last();
	const promptText = await prompt.innerText();
	check("a conflict is a question, not a decision", /changed in two places/i.test(promptText), promptText.slice(0, 200));

	const options = await prompt.locator("select option").allInnerTexts();
	check("with keep-mine, keep-theirs and keep-both offered",
		options.join("|").includes("Keep both") && options.join("|").includes("Keep the online copy"), options.join(" | "));

	await prompt.locator("select").selectOption({label: "Keep both"});
	await prompt.locator("button:has-text('OK')").first().click();
	await page.waitForTimeout(1800);

	const names = await page.evaluate(() => {
		const store = JSON.parse(localStorage.getItem("charactersheet-characters"));
		return Object.values(store.characters).map(it => it?.state?.name).filter(Boolean);
	});
	check("keeping both loses nothing: the online copy and a marked local copy",
		names.includes("Theirs") && names.some(n => /\(this device\)/.test(n)), JSON.stringify(names));

	check("no page errors (storage)", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
	await page.close();

	await runAutoPush({browser, check});
}

/**
 * Automatic push.
 *
 * The point of it is that nobody has to remember, so the test does not press anything: it edits and
 * waits. It also checks the two limits — a character the server has never seen is not uploaded
 * behind your back, and switching the setting off really stops it.
 */
async function runAutoPush ({browser, check}) {
	const page = await openWithStubAdapter(browser, {user: {id: "u1", name: "Ada"}, isStorage: true});

	await setField(page, "cs-name", "Autosaver");
	await page.waitForTimeout(6000);
	check("a character that has never been online is not uploaded on its own",
		(await page.evaluate(() => Object.keys(window.__stubStore.characters).length)) === 0,
		JSON.stringify(await page.evaluate(() => window.__stubStore.characters)));

	// Upload it once, by hand — after which it is the server's to keep up to date
	await page.click("#cs-sync-badge");
	await page.waitForTimeout(600);
	const panel = page.locator(".ve-ui-modal__inner").last();
	await panel.locator("button:has-text('Upload')").first().click();
	await page.waitForTimeout(900);
	await page.keyboard.press("Escape");
	await page.waitForTimeout(300);

	await setField(page, "cs-hp-max", 33);
	await page.waitForTimeout(1000);
	const badgeMid = await page.locator("#cs-sync-badge").innerText();
	check("an edit shows as unsaved straight away", /Unsaved/.test(badgeMid), badgeMid);

	await page.waitForTimeout(6000);
	const uploaded = await page.evaluate(() => Object.values(window.__stubStore.characters)[0]);
	check("and is uploaded without anybody pressing anything", uploaded.envelope.state.hpMax === 33,
		JSON.stringify({hpMax: uploaded.envelope.state.hpMax, version: uploaded.version}));

	const badgeAfter = await page.locator("#cs-sync-badge").innerText();
	check("after which the badge goes back to naming the person", badgeAfter.includes("Ada"), badgeAfter);

	// ---------- and it can be switched off ----------
	await page.click("#cs-sync-badge");
	await page.waitForTimeout(600);
	await page.locator(".ve-ui-modal__inner").last().locator("input[type=checkbox]").first().uncheck();
	await page.waitForTimeout(300);
	await page.keyboard.press("Escape");
	await page.waitForTimeout(300);

	const versionBefore = await page.evaluate(() => Object.values(window.__stubStore.characters)[0].version);
	await setField(page, "cs-hp-max", 44);
	await page.waitForTimeout(6000);
	const versionAfter = await page.evaluate(() => Object.values(window.__stubStore.characters)[0].version);
	check("switching it off really stops it", versionBefore === versionAfter, `${versionBefore} → ${versionAfter}`);

	check("no page errors (auto push)", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
	await page.close();

	await runTables({browser, check});
	await runSidekickControl({browser, check});
	await runGmWrite({browser, check});
	await runHistory({browser, check});
}

/**
 * History and restore.
 *
 * The point of automatic push is that nobody has to think about saving; the point of this is that
 * nobody has to be afraid of it. So what matters here is that going back really does bring the old
 * character to the screen, and that the version it replaced is still there afterwards.
 */
async function runHistory ({browser, check}) {
	const page = await openWithStubAdapter(browser, {user: {id: "u1", name: "Ada"}, isStorage: true});

	const openPanel = async () => {
		await page.click("#cs-sync-badge");
		await page.waitForTimeout(700);
		return page.locator(".ve-ui-modal__inner").last();
	};

	await setField(page, "cs-name", "Level One");
	await setField(page, "cs-hp-max", 8);
	await page.waitForTimeout(800);

	let panel = await openPanel();
	await panel.locator("button:has-text('Upload')").first().click();
	await page.waitForTimeout(900);
	await page.keyboard.press("Escape");
	await page.waitForTimeout(300);

	// A second save, pushed automatically, is the version we will want to come back from
	await setField(page, "cs-name", "Level Two");
	await setField(page, "cs-hp-max", 15);
	await page.waitForTimeout(6500);
	check("two versions exist after an edit and its automatic save",
		(await page.evaluate(() => Object.values(window.__stubStore.characters)[0].history.length)) === 2,
		JSON.stringify(await page.evaluate(() => Object.values(window.__stubStore.characters)[0].history.map(h => h.version))));

	panel = await openPanel();
	check("a character that is in both places offers its history",
		await panel.locator("button:has-text('History')").count() === 1);

	await panel.locator("button:has-text('History')").first().click();
	await page.waitForTimeout(900);
	const hist = page.locator(".ve-ui-modal__inner").last();
	check("which lists what was saved, marking the current one", /current/.test(await hist.innerText()), (await hist.innerText()).slice(0, 200));

	await hist.locator("button:has-text('Look')").last().click();
	await page.waitForTimeout(900);
	check("looking at one shows what the character was then",
		/Hit Points/.test(await hist.innerText()), (await hist.innerText()).slice(0, 300));

	await hist.locator("button:has-text('Restore')").last().click();
	await page.waitForTimeout(700);
	const confirm = page.locator(".ve-ui-modal__inner").last();
	await confirm.locator("button:has-text('Restore')").first().click();
	await page.waitForTimeout(2500);

	const st = await getState(page);
	check("restoring brings the old character back to the screen", st.name === "Level One" && st.hpMax === 8,
		JSON.stringify({name: st.name, hpMax: st.hpMax}));

	// Restoring writes forward, so what it replaced is still there to return to
	const versions = await page.evaluate(() => Object.values(window.__stubStore.characters)[0].history.map(h => h.envelope.state.name));
	check("and the version it replaced is still in the history", versions.includes("Level Two"), JSON.stringify(versions));

	check("no page errors (history)", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
	await page.close();
}

/**
 * Tables: creating one, putting a character at it, and looking at somebody's sheet without being
 * able to change it. The read-only view is the part worth driving — the whole point of it is that
 * it goes nowhere near the store.
 */
async function runTables ({browser, check}) {
	const page = await openWithStubAdapter(browser, {user: {id: "u1", name: "Ada"}, isStorage: true});

	await setField(page, "cs-name", "Tabled");
	await setField(page, "cs-hp-max", 27);
	await page.waitForTimeout(800);

	const openPanel = async () => {
		await page.click("#cs-sync-badge");
		await page.waitForTimeout(700);
		return page.locator(".ve-ui-modal__inner").last();
	};

	let panel = await openPanel();
	check("the panel offers tables when the service does them", (await panel.innerText()).includes("Tables"),
		(await panel.innerText()).slice(0, 300));
	check("and says you are at none yet", (await panel.innerText()).includes("not at any table"), (await panel.innerText()).slice(0, 300));

	// Until a character is online there is nothing to put at a table
	check("the table picker waits for the character to be uploaded",
		await panel.locator("select").first().isDisabled());

	await panel.locator("button:has-text('Upload')").first().click();
	await page.waitForTimeout(900);

	await panel.locator("button:has-text('New table')").click();
	await page.waitForTimeout(600);
	const prompt = page.locator(".ve-ui-modal__inner").last();
	await prompt.locator("input").first().fill("Curse of Strahd");
	await prompt.locator("button:has-text('OK')").first().click();
	await page.waitForTimeout(900);

	panel = page.locator(".ve-ui-modal__inner").last();
	check("a new table appears, with you as its GM", /Curse of Strahd/.test(await panel.innerText()), (await panel.innerText()).slice(0, 300));

	await panel.locator("select").first().selectOption({label: "Curse of Strahd"});
	await page.waitForTimeout(900);
	check("the character can then be put at it",
		(await page.evaluate(() => Object.values(window.__stubStore.characters)[0].campaignId)) === "camp-1");

	await panel.locator("button:has-text('Characters')").first().click();
	await page.waitForTimeout(900);
	const party = page.locator(".ve-ui-modal__inner").last();
	check("the table lists the party", (await party.innerText()).includes("Tabled"), (await party.innerText()).slice(0, 200));

	await party.locator("button:has-text('View')").first().click();
	await page.waitForTimeout(900);
	const card = page.locator(".ve-ui-modal__inner").last();
	const cardText = await card.innerText();

	check("opening one shows a read-only card", cardText.includes("Read-only"), cardText.slice(0, 200));
	check("with the numbers a GM asks about", /Hit Points/.test(cardText) && /Passive Perception/.test(cardText), cardText.slice(0, 400));
	check("and no way to edit anything", await card.locator("input, textarea").count() === 0);

	check("no page errors (tables)", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
	await page.close();
}

/**
 * Handing a sidekick to its table.
 *
 * The one thing at a table that is not read-only: a GM builds a sidekick, hands it over, and the
 * players run it. What is driven here is the GM's side of that decision — the offer only appearing
 * once the sidekick is actually at a table, and the click reaching the service.
 */
async function runSidekickControl ({browser, check}) {
	const page = await openWithStubAdapter(browser, {user: {id: "u1", name: "Gale"}, isStorage: true, url: SIDEKICK_URL});

	await setField(page, "cs-name", "Sir Braun");
	await page.waitForTimeout(800);

	const openPanel = async () => {
		await page.click("#cs-sync-badge");
		await page.waitForTimeout(700);
		return page.locator(".ve-ui-modal__inner").last();
	};

	let panel = await openPanel();
	await panel.locator("button:has-text('Upload')").first().click();
	await page.waitForTimeout(900);

	panel = page.locator(".ve-ui-modal__inner").last();
	await panel.locator("button:has-text('New table')").click();
	await page.waitForTimeout(600);
	const prompt = page.locator(".ve-ui-modal__inner").last();
	await prompt.locator("input").first().fill("Curse of Strahd");
	await prompt.locator("button:has-text('OK')").first().click();
	await page.waitForTimeout(900);

	panel = page.locator(".ve-ui-modal__inner").last();
	check("a sidekick with no table is told to find one first",
		(await panel.innerText()).includes("Put this sidekick at a table"), (await panel.innerText()).slice(0, 300));

	await panel.locator("select").first().selectOption({label: "Curse of Strahd"});
	await page.waitForTimeout(900);

	panel = page.locator(".ve-ui-modal__inner").last();
	const offer = panel.locator("label:has-text('Let the table play this sidekick')");
	check("once it is at a table, it can be handed to it", await offer.count() === 1, (await panel.innerText()).slice(0, 400));
	check("and it starts as the GM's alone", !(await offer.locator("input[type=checkbox]").isChecked()));

	await offer.locator("input[type=checkbox]").check();
	await page.waitForTimeout(900);
	check("checking it tells the service", (await page.evaluate(() => Object.values(window.__stubStore.characters)[0].control)) === "campaign");

	panel = page.locator(".ve-ui-modal__inner").last();
	check("and the panel comes back showing it shared",
		await panel.locator("label:has-text('Let the table play this sidekick') input:checked").count() === 1);

	// Being handed to one table is not consent to be handed to the next
	await panel.locator("select").first().selectOption({label: "(no table)"});
	await page.waitForTimeout(900);
	check("taking it off a table stops it being shared",
		(await page.evaluate(() => Object.values(window.__stubStore.characters)[0].control)) === "owner");

	check("no page errors (sidekick control)", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
	await page.close();
}

/**
 * Lending a character to the table's DM.
 *
 * The switch is the player's, which is the half that matters here: the GM's side lives in the
 * account system's own screen, but a loan nobody can end is not a loan.
 */
async function runGmWrite ({browser, check}) {
	const page = await openWithStubAdapter(browser, {user: {id: "u1", name: "Pip"}, isStorage: true});

	await setField(page, "cs-name", "Pip's Rogue");
	await page.waitForTimeout(800);

	const openPanel = async () => {
		await page.click("#cs-sync-badge");
		await page.waitForTimeout(700);
		return page.locator(".ve-ui-modal__inner").last();
	};

	let panel = await openPanel();
	await panel.locator("button:has-text('Upload')").first().click();
	await page.waitForTimeout(900);

	panel = page.locator(".ve-ui-modal__inner").last();
	check("a character at no table is not offered to a DM",
		await panel.locator("label:has-text('DM edit this character')").count() === 0);

	await panel.locator("button:has-text('New table')").click();
	await page.waitForTimeout(600);
	const prompt = page.locator(".ve-ui-modal__inner").last();
	await prompt.locator("input").first().fill("Curse of Strahd");
	await prompt.locator("button:has-text('OK')").first().click();
	await page.waitForTimeout(900);

	panel = page.locator(".ve-ui-modal__inner").last();
	await panel.locator("select").first().selectOption({label: "Curse of Strahd"});
	await page.waitForTimeout(900);

	panel = page.locator(".ve-ui-modal__inner").last();
	const offer = panel.locator("label:has-text('DM edit this character')");
	check("once it is at a table, the DM can be let in", await offer.count() === 1, (await panel.innerText()).slice(0, 400));
	check("and starts shut", !(await offer.locator("input[type=checkbox]").isChecked()));

	await offer.locator("input[type=checkbox]").check();
	await page.waitForTimeout(900);
	check("switching it on tells the service",
		(await page.evaluate(() => Object.values(window.__stubStore.characters)[0].isGmWrite)) === true);

	panel = page.locator(".ve-ui-modal__inner").last();
	check("and the panel comes back showing the loan",
		await panel.locator("label:has-text('DM edit this character') input:checked").count() === 1);

	// The trail is what makes the loan bearable, and it belongs where the player already looks
	await panel.locator("button:has-text('History')").first().click();
	await page.waitForTimeout(900);
	const history = page.locator(".ve-ui-modal__inner").last();
	check("somebody else's save is named in the history", (await history.innerText()).includes("saved by Gale"),
		(await history.innerText()).slice(0, 300));

	check("no page errors (gm write)", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
	await page.close();
}

/**
 * A page with a stand-in account system on `/online/client.js`.
 *
 * Serving the script rather than injecting the adapter directly is the point: it exercises the same
 * path a real deployment takes, including the fork refusing to look anywhere else.
 */
async function openWithStubAdapter (browser, {user = null, failWith = null, isStorage = false, url = SHEET_URL} = {}) {
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", e => errors.push(e.message));
	page.errors = errors;

	const whoAmI = failWith ? `Promise.reject(new Error(${JSON.stringify(failWith)}))` : `Promise.resolve(${JSON.stringify(user)})`;

	// An in-memory stand-in for the account system, with the same version rules as the real one, so
	// the page's conflict handling is driven rather than described
	const storage = `
		window.__stubStore = {characters: {}, campaigns: []};
		window.CharacterSyncAdapter = {
			getCapabilities: function () { return {characters: true, campaigns: true, history: true}; },
			pWhoAmI: function () { return ${whoAmI}; },
			pList: function () {
				return Promise.resolve(Object.entries(window.__stubStore.characters).map(function (e) {
					return {
						id: e[0],
						name: e[1].envelope.state.name || "Unnamed Character",
						version: e[1].version,
						isSidekick: !!e[1].envelope.state.isSidekick,
						isMine: true,
						control: e[1].control || "owner",
						isGmWrite: !!e[1].isGmWrite,
						campaignId: e[1].campaignId || null,
					};
				}));
			},
			pLoad: function (id) {
				var e = window.__stubStore.characters[id];
				return e ? Promise.resolve({envelope: e.envelope, version: e.version}) : Promise.reject(new Error("not found"));
			},
			pListVersions: function (id) {
				var e = window.__stubStore.characters[id];
				return Promise.resolve({
					versions: e.history.slice().reverse().map(function (v, ix) {
						// The newest is attributed, so the panel's "saved by" path is exercised
						return Object.assign({}, v, {by: ix === 0 ? "Gale" : null});
					}),
					current: e.version,
				});
			},
			pLoadVersion: function (id, version) {
				var found = window.__stubStore.characters[id].history.filter(function (v) { return v.version === version; })[0];
				return found ? Promise.resolve(found) : Promise.reject(new Error("no such version"));
			},
			pRestoreVersion: function (id, version) {
				var e = window.__stubStore.characters[id];
				var found = e.history.filter(function (v) { return v.version === version; })[0];
				e.version += 1;
				e.envelope = JSON.parse(JSON.stringify(found.envelope));
				e.history.push({version: e.version, createdAt: Date.now(), envelope: e.envelope});
				return Promise.resolve({version: e.version, restored: version});
			},
			pSave: function (id, envelope, opts) {
				var known = (opts || {}).version;
				var cur = window.__stubStore.characters[id];
				if (cur && cur.version !== known) {
					var err = new Error("This character was changed elsewhere.");
					err.name = "SyncConflictError";
					err.serverVersion = cur.version;
					err.serverEnvelope = cur.envelope;
					return Promise.reject(err);
				}
				var next = cur ? cur.version + 1 : 1;
				var history = (cur && cur.history) || [];
				history.push({version: next, createdAt: Date.now(), envelope: envelope});
				window.__stubStore.characters[id] = {envelope: envelope, version: next, history: history, campaignId: cur && cur.campaignId, control: (cur && cur.control) || "owner"};
				return Promise.resolve({version: next});
			},
			pDelete: function (id) { delete window.__stubStore.characters[id]; return Promise.resolve(); },
			pListCampaigns: function () { return Promise.resolve(window.__stubStore.campaigns.slice()); },
			pCreateCampaign: function (name) {
				var c = {id: "camp-" + (window.__stubStore.campaigns.length + 1), name: name, role: "gm", isPartyVisible: false};
				window.__stubStore.campaigns.push(c);
				return Promise.resolve(c);
			},
			pJoinCampaign: function (code) {
				var c = {id: "camp-joined", name: "Joined via " + code, role: "player", isPartyVisible: false};
				window.__stubStore.campaigns.push(c);
				return Promise.resolve(c);
			},
			pCreateInvite: function () { return Promise.resolve({code: "abc123", role: "player", maxUses: 1}); },
			pListCampaignCharacters: function (campaignId) {
				return Promise.resolve(Object.entries(window.__stubStore.characters)
					.filter(function (e) { return e[1].campaignId === campaignId; })
					.map(function (e) {
						return {id: e[0], name: e[1].envelope.state.name, ownerName: "Ada", isMine: true, version: e[1].version};
					}));
			},
			pSetCharacterCampaign: function (id, campaignId) {
				window.__stubStore.characters[id].campaignId = campaignId;
				window.__stubStore.characters[id].control = "owner";
				return Promise.resolve();
			},
			pSetCharacterControl: function (id, control) {
				window.__stubStore.characters[id].control = control;
				return Promise.resolve(control);
			},
			pSetCharacterGmWrite: function (id, isAllowed) {
				window.__stubStore.characters[id].isGmWrite = !!isAllowed;
				return Promise.resolve(!!isAllowed);
			},
			getLoginUrl: function () { return "/online/login"; },
			getLogoutUrl: function () { return "/online/logout"; },
		};`;

	const readOnly = `window.CharacterSyncAdapter = {
			getCapabilities: function () { return {characters: false}; },
			pWhoAmI: function () { return ${whoAmI}; },
			pList: function () { return Promise.reject(new Error("no")); },
			pLoad: function () { return Promise.reject(new Error("no")); },
			pSave: function () { return Promise.reject(new Error("no")); },
			pDelete: function () { return Promise.reject(new Error("no")); },
			getLoginUrl: function () { return "/online/login"; },
			getLogoutUrl: function () { return "/online/logout"; },
		};`;

	await page.route("**/online/client.js", route => route.fulfill({
		contentType: "text/javascript",
		body: isStorage ? storage : readOnly,
	}));

	await page.goto(url, {waitUntil: "load"});
	await page.waitForTimeout(2500);
	return page;
}
