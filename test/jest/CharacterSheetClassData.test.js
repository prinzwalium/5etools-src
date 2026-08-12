import {CharacterSheetClassData} from "../../js/charactersheet/charactersheet-classdata.js";

describe("CharacterSheetClassData.getFeatureFeatGrants", () => {
	it("Detects a Fighting Style feat grant from feature prose", () => {
		const feature = {entries: [
			"You gain a {@filter Fighting Style feat|feats|category=FS} of your choice.",
			"Whenever you gain a Fighter level, you can replace it with a different {@filter Fighting Style feat|feats|category=FS}.",
		]};
		// Two references, one category → one distinct grant
		expect(CharacterSheetClassData.getFeatureFeatGrants(feature)).toEqual([{category: "FS"}]);
	});

	it("Detects an Epic Boon grant", () => {
		const feature = {entries: ["You gain an {@filter Epic Boon feat|feats|category=EB} of your choice."]};
		expect(CharacterSheetClassData.getFeatureFeatGrants(feature)).toEqual([{category: "EB"}]);
	});

	it("Walks nested entries", () => {
		const feature = {entries: [{type: "entries", entries: ["Pick a {@filter x|feats|category=FS}."]}]};
		expect(CharacterSheetClassData.getFeatureFeatGrants(feature)).toEqual([{category: "FS"}]);
	});

	// The bug this was written for: "Eldritch Invocation Options" is a *menu* of every invocation,
	// one of which (Lessons of the First Ones) grants an Origin feat. Reading the menu as a grant put
	// a "Choose Feat…" on a card that grants nothing — and, since the category was written `o` there,
	// a button that opened nothing at all.
	it("Does not read a menu of options as a grant", () => {
		const listing = {entries: [
			"Eldritch Invocation options appear in alphabetical order.",
			{
				type: "options",
				count: 1,
				entries: [
					{name: "Lessons of the First Ones", entries: ["You gain an {@filter Origin feat|feats|category=o} of your choice."]},
					{name: "Agonizing Blast", entries: ["Choose one of your known cantrips."]},
				],
			},
		]};
		expect(CharacterSheetClassData.getFeatureFeatGrants(listing)).toEqual([]);
	});

	// ...and the option itself, once taken, does grant it
	it("Reads the grant off the option that carries it", () => {
		const option = {name: "Lessons of the First Ones", entries: ["You gain an {@filter Origin feat|feats|category=o} of your choice."]};
		expect(CharacterSheetClassData.getFeatureFeatGrants(option)).toEqual([{category: "O"}]);
	});

	// The data writes `category=o`; a feat carries `category: "O"`. One spelling reaches the UI
	it("Normalises the category, whichever way the data spells it", () => {
		expect(CharacterSheetClassData.getFeatureFeatGrants({entries: ["{@filter x|feats|category=eb}"]})).toEqual([{category: "EB"}]);
	});

	it("Returns nothing for features that grant no feat", () => {
		expect(CharacterSheetClassData.getFeatureFeatGrants({entries: ["You gain Second Wind."]})).toEqual([]);
		expect(CharacterSheetClassData.getFeatureFeatGrants({})).toEqual([]);
		expect(CharacterSheetClassData.getFeatureFeatGrants(null)).toEqual([]);
	});
});
