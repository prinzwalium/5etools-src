/**
 * The portrait and appearance fields, and the homebrew wiring.
 *
 * The homebrew checks are deliberately about *plumbing*, not about brew content: this environment
 * has no brew to install, so what is worth protecting is that the brew utilities are initialised at
 * all — which is the thing that was missing, and which nothing else would notice.
 */

import {BASE_URL, getState, openPage, pickViaSearch, resolveModals, setField} from "./util-e2e.mjs";

const SHEET_URL = `${BASE_URL}/charactersheet.html`;
const BUILDER_URL = `${BASE_URL}/charbuilder.html`;

/** A real 2×2 PNG, so the browser's decoder has something genuine to work on. */
const PNG_2X2 = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP8z4AJmDDEhqIoAFZaAQXfaehLAAAAAElFTkSuQmCC";

/** Drive the file input the way a file picker would. */
async function choosePortrait (page, b64) {
	await page.setInputFiles("#cs-portrait-file", {
		name: "portrait.png",
		mimeType: "image/png",
		buffer: Buffer.from(b64, "base64"),
	});
	await page.waitForTimeout(1200);
}

export async function run ({browser, check}) {
	const page = await openPage(browser, {url: SHEET_URL});

	// ---------- the fields ----------
	check("the sheet has an appearance panel", await page.locator("#cs-appearance").count() === 1);

	await setField(page, "cs-appearance-eyes", "grey");
	await setField(page, "cs-appearance-height", "5'11\"");
	await page.waitForTimeout(400);
	const state = await getState(page);
	check("an appearance field is stored on the character", state.appearanceEyes === "grey", state.appearanceEyes);
	check("and so is another", state.appearanceHeight === "5'11\"", state.appearanceHeight);

	// ---------- the portrait ----------
	check("with no portrait, the box says so",
		await page.locator("#cs-portrait-empty:not(.ve-hidden)").count() === 1);

	await choosePortrait(page, PNG_2X2);
	const withPortrait = await getState(page);
	check("choosing an image stores a portrait", (withPortrait.portrait || "").startsWith("data:image/"), (withPortrait.portrait || "").slice(0, 24));
	check("re-encoded rather than stored as given", withPortrait.portrait.startsWith("data:image/jpeg"), withPortrait.portrait.slice(0, 24));
	check("and it is shown", await page.locator("#cs-portrait-img:not(.ve-hidden)").count() === 1);

	await page.click("#cs-portrait-clear");
	await page.waitForTimeout(400);
	check("Clear removes it", !(await getState(page)).portrait);
	check("and the placeholder comes back",
		await page.locator("#cs-portrait-empty:not(.ve-hidden)").count() === 1);

	// ---------- it survives a reload ----------
	await choosePortrait(page, PNG_2X2);
	await page.reload({waitUntil: "domcontentloaded"});
	await page.waitForTimeout(3000);
	const reloaded = await getState(page);
	check("a portrait survives a reload", (reloaded.portrait || "").startsWith("data:image/"));
	check("and so do the appearance fields", reloaded.appearanceEyes === "grey", reloaded.appearanceEyes);

	// ---------- homebrew plumbing ----------
	check("the sheet offers a Homebrew button", await page.locator("#cs-btn-homebrew").count() === 1);
	const brewReady = await page.evaluate(() => ({
		hasBrewUtil: typeof BrewUtil2 !== "undefined",
		// Awaited last in the page's `pInit`, so this being true means the brew inits before it
		// finished too — which is what lets `pCacheAndGetAllBrew` return anything at all
		isExcludeInit: typeof ExcludeUtil !== "undefined" && ExcludeUtil.isInitialised === true,
	}));
	check("the brew utility is present", brewReady.hasBrewUtil, JSON.stringify(brewReady));
	check("and the page's init chain ran it, so brew can reach the pickers",
		brewReady.isExcludeInit, JSON.stringify(brewReady));
	check("asking the loader for brew now works rather than throwing", await page.evaluate(async () => {
		const out = await DataLoader.pCacheAndGetAllBrew(UrlUtil.PG_SPELLS);
		return Array.isArray(out);
	}));

	check("no page errors on the sheet", page.errors.length === 0, page.errors.slice(0, 2).join(" | "));
	await page.close();

	// ---------- the builder gets both too ----------
	const builder = await openPage(browser, {url: BUILDER_URL});
	check("the builder has the appearance panel as well", await builder.locator("#cs-appearance").count() === 1);
	check("and the Homebrew button", await builder.locator("#cs-btn-homebrew").count() === 1);

	// ---------- the species' own height and weight table ----------

	// Hidden until a species that has one is picked, so its presence is the answer to "can I roll?"
	check("no species, no roll button",
		await builder.locator("#cs-appearance-roll:not(.ve-hidden)").count() === 0);

	// A Loxodon carries both things being checked here — a Random Height and Weight table and
	// Powerful Build — and is not reprinted anywhere, so the picker offers exactly one of it
	await pickViaSearch(builder, {btn: "#cs-pick-species", query: "loxodon", rowText: "Loxodon"});
	await resolveModals(builder);
	await builder.waitForTimeout(1200);

	check("a species with the table offers the roll",
		await builder.locator("#cs-appearance-roll:not(.ve-hidden)").count() === 1);

	const rollTitle = await builder.locator("#cs-appearance-roll").getAttribute("title");
	check("and says what the range is", /\d+'.*\d+ lb\./.test(rollTitle || ""), rollTitle);

	await builder.click("#cs-appearance-roll");
	await builder.waitForTimeout(600);
	const rolled = await getState(builder);
	// Loxodon: 6'7" + 2d10 inches, 295 lb. + (2d4 × the height roll)
	const inches = /^(\d+)'(?:(\d+)")?$/.exec(rolled.appearanceHeight || "");
	const heightIn = inches ? (Number(inches[1]) * 12) + Number(inches[2] || 0) : null;
	check("rolling writes a height inside the species' range",
		heightIn >= 81 && heightIn <= 99, `${rolled.appearanceHeight} → ${heightIn}in`);

	const weightLb = Number(String(rolled.appearanceWeight || "").replace(/[^\d.]/g, ""));
	check("and a weight the height accounts for",
		weightLb >= 299 && weightLb <= 455, rolled.appearanceWeight);

	check("the species' trait tags are shown", await builder.locator(".cs__tag").count() > 0,
		(await builder.locator("#cs-species-panel").textContent() || "").replace(/\s+/g, " ").slice(0, 120));

	// The tags are recorded on the character, which is what lets the carrying capacity double
	// without the species entity being around when the inventory is totalled
	check("the tags are stored on the character, not just rendered",
		(rolled.speciesTraitTags || []).includes("Powerful Build"), JSON.stringify(rolled.speciesTraitTags));

	check("no page errors on the builder", builder.errors.length === 0, builder.errors.slice(0, 2).join(" | "));
	await builder.close();
}
