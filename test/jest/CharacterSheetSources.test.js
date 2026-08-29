import {
	SOURCE_MODE_ALL,
	SOURCE_MODE_CLASSIC,
	SOURCE_MODE_CUSTOM,
	SOURCE_MODE_MODERN,
	filterReprinted,
	getDefaultSourceFilter,
	getOutOfFilterSources,
	getSourceFilterLabel,
	getSupersededKeys,
	getSourceFilterPredicate,
	getUsedSources,
	isSourceAllowed,
	isPreferringReprints,
	isSourceFilterInactive,
	isSourceFilterNarrowing,
} from "../../js/charactersheet/charactersheet-sources.js";

// Stand-in for SourceUtil.isClassicSource: 2014-era books are "classic"
const CLASSIC = new Set(["PHB", "XGE", "TCE", "SCAG", "EGW"]);
const opts = {isClassic: src => CLASSIC.has(src)};

describe("Source filter: predicate", () => {
	it("Allows everything by default", () => {
		const filter = getDefaultSourceFilter();
		expect(isSourceFilterInactive(filter)).toBe(true);
		expect(isSourceAllowed("PHB", filter, opts)).toBe(true);
		expect(isSourceAllowed("XPHB", filter, opts)).toBe(true);
		expect(getSourceFilterPredicate(filter, opts)).toBeNull();
	});

	it("Restricts to the 2024 ruleset", () => {
		const filter = {mode: SOURCE_MODE_MODERN, sources: {}};
		expect(isSourceAllowed("XPHB", filter, opts)).toBe(true);
		expect(isSourceAllowed("XDMG", filter, opts)).toBe(true);
		expect(isSourceAllowed("PHB", filter, opts)).toBe(false);
		expect(isSourceAllowed("TCE", filter, opts)).toBe(false);
	});

	it("Restricts to the 2014 ruleset", () => {
		const filter = {mode: SOURCE_MODE_CLASSIC, sources: {}};
		expect(isSourceAllowed("PHB", filter, opts)).toBe(true);
		expect(isSourceAllowed("XGE", filter, opts)).toBe(true);
		expect(isSourceAllowed("XPHB", filter, opts)).toBe(false);
	});

	it("Honours an explicit custom book list", () => {
		const filter = {mode: SOURCE_MODE_CUSTOM, sources: {PHB: true, XGE: true, TCE: false}};
		expect(isSourceAllowed("PHB", filter, opts)).toBe(true);
		expect(isSourceAllowed("XGE", filter, opts)).toBe(true);
		expect(isSourceAllowed("TCE", filter, opts)).toBe(false);
		expect(isSourceAllowed("XPHB", filter, opts)).toBe(false); // absent => not allowed
	});

	it("Never hides unsourced content", () => {
		expect(isSourceAllowed(null, {mode: SOURCE_MODE_MODERN}, opts)).toBe(true);
		expect(isSourceAllowed(undefined, {mode: SOURCE_MODE_CUSTOM, sources: {}}, opts)).toBe(true);
	});

	it("Falls back to allowing everything when no classifier is supplied", () => {
		// The era modes need the 2014/2024 classification; without it, don't hide anything
		expect(isSourceAllowed("PHB", {mode: SOURCE_MODE_MODERN})).toBe(true);
		expect(isSourceAllowed("XPHB", {mode: SOURCE_MODE_CLASSIC})).toBe(true);
	});

	it("Builds a reusable predicate", () => {
		const fn = getSourceFilterPredicate({mode: SOURCE_MODE_MODERN, sources: {}}, opts);
		expect(["XPHB", "PHB"].filter(fn)).toEqual(["XPHB"]);
	});
});

describe("Source filter: labels", () => {
	it("Names the presets", () => {
		expect(getSourceFilterLabel(getDefaultSourceFilter())).toBe("All sources");
		expect(getSourceFilterLabel({mode: SOURCE_MODE_MODERN})).toBe("2024 rules only");
		expect(getSourceFilterLabel({mode: SOURCE_MODE_CLASSIC})).toBe("2014 rules only");
		expect(getSourceFilterLabel(null)).toBe("All sources");
	});

	it("Counts the books in a custom filter", () => {
		expect(getSourceFilterLabel({mode: SOURCE_MODE_CUSTOM, sources: {PHB: true}})).toBe("1 book");
		expect(getSourceFilterLabel({mode: SOURCE_MODE_CUSTOM, sources: {PHB: true, XGE: true, TCE: false}})).toBe("2 books");
		expect(getSourceFilterLabel({mode: SOURCE_MODE_CUSTOM, sources: {}})).toBe("0 books");
	});
});

describe("Source filter: flagging existing picks", () => {
	const state = {
		classes: [{
			name: "Rogue",
			source: "PHB",
			subclass: {name: "Swashbuckler", source: "XGE"},
			optionalFeatures: [{name: "Archery", source: "PHB"}],
			asiFeatChoices: [{type: "feat", name: "Prodigy", source: "XGE"}, {type: "asi", bonuses: {str: 2}}],
		}],
		featureFeats: [{name: "Defense", source: "XPHB"}],
		originFeats: [{name: "Savage Attacker", source: "XPHB"}],
		spellsKnown: [{name: "Fire Bolt", source: "XPHB"}],
		grantedSpellChoices: [{name: "Bless", source: "PHB"}],
		refSpecies: {name: "Elf", source: "XPHB"},
		refBackground: {name: "Sage", source: "PHB"},
	};

	it("Collects every source the character actually uses", () => {
		const used = getUsedSources(state).map(it => it.source).sort();
		expect(used).toEqual(["PHB", "XGE", "XPHB"]);
	});

	it("Labels each source with what uses it", () => {
		const xge = getUsedSources(state).find(it => it.source === "XGE");
		expect(xge.labels.sort()).toEqual(["Prodigy", "Swashbuckler"]);
	});

	it("Reports the picks that fall outside a 2024-only filter", () => {
		const out = getOutOfFilterSources(state, {mode: SOURCE_MODE_MODERN, sources: {}}, opts);
		expect(out.map(it => it.source).sort()).toEqual(["PHB", "XGE"]);
	});

	it("Reports nothing when the filter permits everything", () => {
		expect(getOutOfFilterSources(state, {mode: SOURCE_MODE_ALL}, opts)).toEqual([]);
		expect(getOutOfFilterSources(state, null, opts)).toEqual([]);
	});

	it("Ignores ASI (non-feat) entries and tolerates empty state", () => {
		expect(getUsedSources({})).toEqual([]);
		expect(getUsedSources(null)).toEqual([]);
	});
});

/*
 * Reprints. A hundred and sixty entries a picker shows are earlier printings of another entry in
 * the same list, and the data says which — so the pickers offered Alert twice, with nothing on the
 * row to tell them apart.
 */
describe("hiding what a later printing supersedes", () => {
	const names = list => list.map(it => `${it.name}|${it.source}`);

	it("Drops the original when its reprint is on offer", () => {
		const list = [
			{name: "Alert", source: "PHB", reprintedAs: ["Alert|XPHB"]},
			{name: "Alert", source: "XPHB"},
		];
		expect(names(filterReprinted(list))).toEqual(["Alert|XPHB"]);
	});

	it("Keeps the original when the reprint is not there", () => {
		// Filtered to the 2014 books, the reprint is already gone and the original is the answer
		const list = [{name: "Alert", source: "PHB", reprintedAs: ["Alert|XPHB"]}];
		expect(names(filterReprinted(list))).toEqual(["Alert|PHB"]);
	});

	it("Leaves an entry with no reprint alone", () => {
		const list = [{name: "Lucky", source: "PHB"}, {name: "Tough", source: "XPHB"}];
		expect(filterReprinted(list)).toHaveLength(2);
	});

	it("Ignores a reprint into a different kind of thing", () => {
		// A dragonmark subrace was reprinted as a feat; the feat is not in the species list, so the
		// species stays pickable rather than vanishing
		const list = [{name: "Mark of Warding", source: "ERLW", reprintedAs: [{uid: "Mark of Warding|EFA", tag: "feat"}]}];
		expect(names(filterReprinted(list))).toEqual(["Mark of Warding|ERLW"]);
	});

	it("Reads the object form when the reprint is present", () => {
		const list = [
			{name: "Mark of Warding", source: "ERLW", reprintedAs: [{uid: "Mark of Warding|EFA", tag: "race"}]},
			{name: "Mark of Warding", source: "EFA"},
		];
		expect(names(filterReprinted(list))).toEqual(["Mark of Warding|EFA"]);
	});

	it("Copes with nothing at all", () => {
		expect(filterReprinted([])).toEqual([]);
		expect(filterReprinted(null)).toEqual([]);
	});
});

/*
 * The 2024 books as the default.
 *
 * Not the same as the "2024 rules only" mode, which drops the 2014 books entirely and with them
 * every subclass, spell and item the new books never carried over. This offers the newest printing
 * of anything printed twice, and leaves everything else exactly where it was.
 */
describe("preferring the newest printing", () => {
	const names = list => list.map(it => `${it.name}|${it.source}`);

	it("Is on by default, and stays on for a filter saved before it existed", () => {
		expect(isPreferringReprints(getDefaultSourceFilter())).toBe(true);
		expect(isPreferringReprints({mode: SOURCE_MODE_ALL, sources: {}})).toBe(true);
		expect(isPreferringReprints(null)).toBe(true);
	});

	it("Is off only when the character says so", () => {
		expect(isPreferringReprints({mode: SOURCE_MODE_ALL, isPreferReprints: false})).toBe(false);
	});

	it("Keeps what the new books never reprinted", () => {
		const list = [
			{name: "Fighter", source: "PHB", reprintedAs: ["Fighter|XPHB"]},
			{name: "Fighter", source: "XPHB"},
			{name: "Artificer", source: "TCE"},
		];
		expect(names(filterReprinted(list))).toEqual(["Fighter|XPHB", "Artificer|TCE"]);
	});

	it("Matches a subclass, whose reprint uid names its class in the middle", () => {
		// "Berserker|Barbarian|XPHB|XPHB" — the name is first and the source last, with the parent
		// class between them; reading the second segment as the source matched nothing at all
		const list = [
			{name: "Path of the Berserker", shortName: "Berserker", source: "PHB", reprintedAs: ["Berserker|Barbarian|XPHB|XPHB"]},
			{name: "Berserker", shortName: "Berserker", source: "XPHB"},
		];
		expect(names(filterReprinted(list))).toEqual(["Berserker|XPHB"]);
	});

	it("Says which entries a picker should reject, for a list it cannot filter itself", () => {
		const list = [
			{name: "Alert", source: "PHB", reprintedAs: ["Alert|XPHB"]},
			{name: "Alert", source: "XPHB"},
			{name: "Lucky", source: "PHB"},
		];
		const superseded = getSupersededKeys(list);
		expect(superseded.has("alert|phb")).toBe(true);
		expect(superseded.has("alert|xphb")).toBe(false);
		expect(superseded.has("lucky|phb")).toBe(false);
	});

	it("Narrows the list even with every book allowed, which the mode alone does not", () => {
		expect(isSourceFilterNarrowing(getDefaultSourceFilter())).toBe(true);
		expect(isSourceFilterNarrowing({mode: SOURCE_MODE_ALL, isPreferReprints: false})).toBe(false);
	});

	it("Says so on the chip only when it is off", () => {
		expect(getSourceFilterLabel(getDefaultSourceFilter())).toBe("All sources");
		expect(getSourceFilterLabel({mode: SOURCE_MODE_ALL, isPreferReprints: false})).toBe("All sources, all printings");
	});
});
