import {describe, expect, it} from "@jest/globals";

import {getBrewDocumentForSource, getBrewSummary, isBrewDocumentEmpty} from "../../js/makebrew/makebrew-account.js";

/**
 * The hand-off from `makebrew.html` to the account system.
 *
 * The two things worth testing are the two things that are not DOM: which entities go, and what the
 * browser tells the service is inside them. The service stores the document opaquely and could not
 * work either out for itself — that is the whole point of the split — so getting these wrong is how
 * a table's homebrew ends up in the wrong place or indexed as the wrong kind of thing.
 */

// `MiscUtil.copyFast` and `Array.prototype.mergeMap` are 5etools globals, present in a browser and
// not in a bare test process
globalThis.MiscUtil = {copyFast: it => JSON.parse(JSON.stringify(it))};
Array.prototype.mergeMap = function (fn) { return this.map(fn).reduce((acc, it) => Object.assign(acc, it), {}); };

const brewDocFor = body => ({head: {isEditable: true}, body});

describe("which entities go to the account system", () => {
	// One editable brew can hold several sources at once — a feat for one table, a species for
	// another — and only the one being looked at should be handed over
	it("takes one source's worth, and leaves the rest behind", () => {
		const doc = getBrewDocumentForSource({
			brewDoc: brewDocFor({
				_meta: {sources: [{json: "Mine"}, {json: "Theirs"}]},
				feat: [{name: "Ours", source: "Mine"}, {name: "Not ours", source: "Theirs"}],
				race: [{name: "Theirs only", source: "Theirs"}],
			}),
			source: "Mine",
			sourceMeta: {json: "Mine", full: "My Table"},
		});

		expect(doc.feat.map(it => it.name)).toEqual(["Ours"]);
		expect(doc.race).toBeUndefined();
	});

	it("matches a source however it is cased, because the data is inconsistent about it", () => {
		const doc = getBrewDocumentForSource({
			brewDoc: brewDocFor({feat: [{name: "Ours", source: "mine"}]}),
			source: "Mine",
		});
		expect(doc.feat).toHaveLength(1);
	});

	it("carries the source's own metadata, which is what every entity inside points at", () => {
		const doc = getBrewDocumentForSource({
			brewDoc: brewDocFor({feat: [{name: "Ours", source: "Mine"}]}),
			source: "Mine",
			sourceMeta: {json: "Mine", full: "My Table", abbreviation: "MT"},
		});
		expect(doc._meta.sources).toEqual([{json: "Mine", full: "My Table", abbreviation: "MT"}]);
	});

	it("keeps the edition, and invents one rather than leaving it unsaid", () => {
		const classic = getBrewDocumentForSource({
			brewDoc: brewDocFor({_meta: {edition: "classic"}, feat: [{name: "A", source: "Mine"}]}),
			source: "Mine",
		});
		expect(classic._meta.edition).toBe("classic");
		expect(getBrewSummary(classic).edition).toBe("classic");

		const unsaid = getBrewDocumentForSource({brewDoc: brewDocFor({feat: [{name: "A", source: "Mine"}]}), source: "Mine"});
		expect(getBrewSummary(unsaid).edition).toBe("one");
	});

	it("leaves bookkeeping out of the content", () => {
		const doc = getBrewDocumentForSource({
			brewDoc: brewDocFor({_meta: {sources: []}, siteVersion: "1.2.3", feat: [{name: "A", source: "Mine"}]}),
			source: "Mine",
		});
		expect(Object.keys(doc).sort()).toEqual(["_meta", "feat"]);
	});

	it("survives an empty or missing brew rather than throwing", () => {
		expect(isBrewDocumentEmpty(getBrewDocumentForSource({brewDoc: null, source: "Mine"}))).toBe(true);
		expect(isBrewDocumentEmpty(getBrewDocumentForSource({brewDoc: brewDocFor({}), source: "Mine"}))).toBe(true);
	});
});

describe("what the browser tells the service is inside", () => {
	it("names the props and counts them, which is all an index needs", () => {
		const summary = getBrewSummary({
			_meta: {edition: "one"},
			feat: [{name: "A"}, {name: "B"}],
			race: [{name: "C"}],
		});

		expect(summary.props.sort()).toEqual(["feat", "race"]);
		expect(summary.counts).toEqual({feat: 2, race: 1});
	});

	// A brew with nothing in it is a button that would do nothing, so the caller checks first
	it("says plainly when there is nothing in it", () => {
		expect(isBrewDocumentEmpty({_meta: {}})).toBe(true);
		expect(isBrewDocumentEmpty({_meta: {}, feat: [{name: "A"}]})).toBe(false);
	});
});
