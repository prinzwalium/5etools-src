import {describe, expect, it} from "@jest/globals";
import {
	findBrewsInIndex,
	getBrewToInstall,
	isSourceDefaultSelected,
	parseDeployConfig,
} from "../../js/deploy-defaults.js";

/**
 * Which books a new visitor starts with, as the container's environment says.
 *
 * The decisions are all here, in four pure functions, precisely so they can be checked without a
 * browser or a container: the wiring in the same module is six lines that call these.
 */

const cfg = (allow, deny, brew) => parseDeployConfig({allow, deny, brew});
const yes = () => true;
const no = () => false;

describe("Deploy defaults: reading the environment", () => {
	it("Splits the comma-separated string an env var carries, spaces and all", () => {
		expect(parseDeployConfig({deny: "PHB, MM ,DMG"}).deny).toEqual(["PHB", "MM", "DMG"]);
	});

	it("Takes a semicolon list too, because a book title can hold a comma", () => {
		expect(parseDeployConfig({brew: "Grim Hollow; Humblewood"}).brew).toEqual(["Grim Hollow", "Humblewood"]);
	});

	it("Keeps a comma inside a title once the list is punctuated with semicolons", () => {
		// "The Griffon's Saddlebag, Book 1" is one book. Splitting on both separators halves a
		// list that was written correctly, and the halves match the wrong things or nothing at all
		expect(parseDeployConfig({brew: "The Griffon's Saddlebag, Book 1 (2024); Humblewood"}).brew)
			.toEqual(["The Griffon's Saddlebag, Book 1 (2024)", "Humblewood"]);
	});

	it("Takes a JSON array as readily as a string", () => {
		expect(parseDeployConfig({allow: ["xphb", "xdmg"]}).allow).toEqual(["XPHB", "XDMG"]);
	});

	it("Upper-cases sources and leaves homebrew titles alone", () => {
		const config = cfg("xphb", "phb", "Grim Hollow");
		expect(config.allow).toEqual(["XPHB"]);
		expect(config.deny).toEqual(["PHB"]);
		// A title is a name, not a code — upper-casing it would stop it matching the index
		expect(config.brew).toEqual(["Grim Hollow"]);
	});

	it("Reads the long-hand key names as well", () => {
		const config = parseDeployConfig({defaultLoad: "XPHB", defaultDeny: "PHB", defaultBrew: "Drakkenheim"});
		expect(config).toMatchObject({allow: ["XPHB"], deny: ["PHB"], brew: ["Drakkenheim"]});
	});

	it("Calls an empty environment unconfigured, so an ordinary deployment is untouched", () => {
		expect(parseDeployConfig({}).isConfigured).toBe(false);
		expect(parseDeployConfig({allow: "", deny: " , ", brew: null}).isConfigured).toBe(false);
		expect(parseDeployConfig(null).isConfigured).toBe(false);
		expect(cfg("", "PHB", "").isConfigured).toBe(true);
	});
});

describe("Deploy defaults: which sources start ticked", () => {
	it("Unticks a denied book the site would have ticked", () => {
		expect(isSourceDefaultSelected("PHB", cfg("", "PHB,MM,DMG"), yes)).toBe(false);
		expect(isSourceDefaultSelected("XPHB", cfg("", "PHB,MM,DMG"), yes)).toBe(true);
	});

	it("Keeps the site's own answer for anything the config does not name", () => {
		expect(isSourceDefaultSelected("SCAG", cfg("", "PHB"), yes)).toBe(true);
		expect(isSourceDefaultSelected("SCAG", cfg("", "PHB"), no)).toBe(false);
	});

	it("Treats a non-empty allow list as exhaustive", () => {
		// Naming the books you play with is the statement that the others are off
		const config = cfg("XPHB,XDMG,XMM");
		expect(isSourceDefaultSelected("XPHB", config, yes)).toBe(true);
		expect(isSourceDefaultSelected("SCAG", config, yes)).toBe(false);
	});

	it("Lets deny beat allow, since deny is the stricter statement", () => {
		expect(isSourceDefaultSelected("PHB", cfg("PHB,XPHB", "PHB"), yes)).toBe(false);
	});

	it("Is case-insensitive about how somebody typed the env var", () => {
		expect(isSourceDefaultSelected("PHB", cfg("", "phb"), yes)).toBe(false);
		expect(isSourceDefaultSelected("phb", cfg("", "PHB"), yes)).toBe(false);
	});

	it("Reads the filter's own `{item}` shape as well as a bare string", () => {
		expect(isSourceDefaultSelected({item: "PHB"}, cfg("", "PHB"), yes)).toBe(false);
	});

	it("Defers entirely when there is no source to judge", () => {
		expect(isSourceDefaultSelected(null, cfg("XPHB"), yes)).toBe(true);
		expect(isSourceDefaultSelected("", cfg("XPHB"), no)).toBe(false);
	});
});

describe("Deploy defaults: installing the listed homebrew once", () => {
	it("Skips what this browser already took", () => {
		expect(getBrewToInstall({brew: ["Grim Hollow", "Humblewood"], installed: ["Grim Hollow"]}))
			.toEqual(["Humblewood"]);
	});

	it("Matches what was installed case-insensitively, and copes with no record at all", () => {
		expect(getBrewToInstall({brew: ["Humblewood"], installed: ["humblewood"]})).toEqual([]);
		expect(getBrewToInstall({brew: ["Humblewood"], installed: null})).toEqual(["Humblewood"]);
	});
});

describe("Deploy defaults: finding a named book in the brew index", () => {
	const index = [
		{_brewName: "Grim Hollow: Lairs of Etharis", name: "Ghostfire Gaming; Grim Hollow: Lairs of Etharis.json", sources: ["GHLoE"], urlDownload: "u1"},
		{_brewName: "Grim Hollow: The Monster Grimoire", name: "Ghostfire Gaming; Grim Hollow: The Monster Grimoire.json", sources: ["GHMG"], urlDownload: "u2"},
		{_brewName: "Humblewood Campaign Setting", name: "Hit Point Press; Humblewood Campaign Setting.json", sources: ["HWCS"], urlDownload: "u3"},
		{_brewName: "Dungeons of Drakkenheim", name: "Ghostfire Gaming; Dungeons of Drakkenheim.json", sources: ["DoD"], urlDownload: "u4"},
	];
	const names = res => res.map(it => it._brewName);

	it("Takes the whole shelf when the name is the shelf", () => {
		// "Grim Hollow" in a Compose file names a series, not a file — and both its books are wanted
		expect(names(findBrewsInIndex("Grim Hollow", index)))
			.toEqual(["Grim Hollow: Lairs of Etharis", "Grim Hollow: The Monster Grimoire"]);
	});

	it("Takes one book when the name is one book", () => {
		expect(names(findBrewsInIndex("Grim Hollow: The Monster Grimoire", index)))
			.toEqual(["Grim Hollow: The Monster Grimoire"]);
	});

	it("Finds a book by a word from the middle of its title", () => {
		expect(names(findBrewsInIndex("Drakkenheim", index))).toEqual(["Dungeons of Drakkenheim"]);
	});

	it("Finds a book by its source code, for anyone who would rather be exact", () => {
		expect(names(findBrewsInIndex("HWCS", index))).toEqual(["Humblewood Campaign Setting"]);
	});

	it("Prefers an exact title over anything it is a prefix of", () => {
		const withShelf = [{_brewName: "Grim Hollow", name: "x; Grim Hollow.json", urlDownload: "u0"}, ...index];
		expect(names(findBrewsInIndex("Grim Hollow", withShelf))).toEqual(["Grim Hollow"]);
	});

	it("Finds nothing rather than guessing", () => {
		expect(findBrewsInIndex("Not A Book", index)).toEqual([]);
		expect(findBrewsInIndex("", index)).toEqual([]);
		expect(findBrewsInIndex("Grim Hollow", [])).toEqual([]);
		expect(findBrewsInIndex("Grim Hollow", null)).toEqual([]);
	});
});
