import {getChosenFeatureEffects, getChosenFeatureNames, getFeatureEffects, getFeatureInitiativeBonus, getFeatureResources, getFeatureUses, getHpBonusPerLevel} from "../../js/charactersheet/charactersheet-features.js";

describe("Feature effects: initiative", () => {
	const ctx = {abilities: {cha: 3, dex: 2}, pb: 3};

	it("Should add an ability modifier for Rakish Audacity", () => {
		expect(getFeatureInitiativeBonus(["Rakish Audacity"], ctx)).toBe(3); // Cha +3
	});

	it("Should add half proficiency for Jack of All Trades", () => {
		expect(getFeatureInitiativeBonus(["Jack of All Trades"], ctx)).toBe(1); // floor(3/2)
	});

	it("Should stack multiple effects and ignore unknown/duplicate features", () => {
		expect(getFeatureInitiativeBonus(["Rakish Audacity", "Jack of All Trades", "Sneak Attack", "Rakish Audacity"], ctx)).toBe(4);
	});

	it("Should return 0 with no relevant features", () => {
		expect(getFeatureInitiativeBonus(["Sneak Attack"], ctx)).toBe(0);
		expect(getFeatureInitiativeBonus([], ctx)).toBe(0);
		expect(getFeatureInitiativeBonus(null, ctx)).toBe(0);
	});
});

describe("Feature effects: chosen-feature collection", () => {
	it("Should collect names from optional features, ASI feats, feature feats and origin feats", () => {
		const state = {
			classes: [{
				optionalFeatures: [{name: "Archery"}, {name: "Trip Attack"}],
				asiFeatChoices: [{type: "feat", name: "Resilient"}, {type: "asi", bonuses: {str: 2}}],
			}],
			featureFeats: [{name: "Defense"}],
			originFeats: [{name: "Savage Attacker"}],
		};
		expect(getChosenFeatureNames(state).sort())
			.toEqual(["Archery", "Defense", "Resilient", "Savage Attacker", "Trip Attack"]);
	});

	it("Should not collect ASI (non-feat) entries, and tolerate empty state", () => {
		expect(getChosenFeatureNames({classes: [{asiFeatChoices: [{type: "asi", bonuses: {str: 2}}]}]})).toEqual([]);
		expect(getChosenFeatureNames({})).toEqual([]);
		expect(getChosenFeatureNames(null)).toEqual([]);
	});
});

describe("Feature effects: fighting styles", () => {
	it("Should aggregate numeric fighting-style effects", () => {
		const eff = getFeatureEffects(["Archery", "Defense", "Dueling", "Thrown Weapon Fighting"]);
		expect(eff.rangedAttack).toBe(2);
		expect(eff.acArmored).toBe(1);
		expect(eff.meleeOneHandedDamage).toBe(2);
		expect(eff.thrownDamage).toBe(2);
	});

	it("Should surface conditional styles as notes rather than numbers", () => {
		const eff = getFeatureEffects(["Great Weapon Fighting", "Two-Weapon Fighting"]);
		expect(eff.rangedAttack).toBe(0);
		expect(eff.meleeOneHandedDamage).toBe(0);
		expect(eff.notes.map(n => n.name).sort()).toEqual(["Great Weapon Fighting", "Two-Weapon Fighting"]);
		expect(eff.notes.every(n => n.desc)).toBe(true);
	});

	it("Should ignore unknown features and de-duplicate", () => {
		const eff = getFeatureEffects(["Archery", "Archery", "Some Unmapped Feature"]);
		expect(eff.rangedAttack).toBe(2); // not doubled
		expect(eff.notes).toHaveLength(1);
		expect(getFeatureEffects([]).notes).toEqual([]);
		expect(getFeatureEffects(null).rangedAttack).toBe(0);
	});

	it("Should read effects straight from character state", () => {
		const state = {classes: [{optionalFeatures: [{name: "Archery"}]}], featureFeats: [{name: "Defense"}]};
		const eff = getChosenFeatureEffects(state);
		expect(eff.rangedAttack).toBe(2);
		expect(eff.acArmored).toBe(1);
	});
});

describe("Feature effects: hit points per level", () => {
	// Rolling for hit points is where somebody notices Tough was never counted
	it("Adds up what the character's features give per level", () => {
		expect(getHpBonusPerLevel({originFeats: [{name: "Tough"}]})).toBe(2);
		expect(getHpBonusPerLevel({classes: [{optionalFeatures: [{name: "Dwarven Toughness"}]}]})).toBe(1);
		expect(getHpBonusPerLevel({
			originFeats: [{name: "Tough"}],
			featureFeats: [{name: "Dwarven Toughness"}],
		})).toBe(3);
	});

	it("Counts nothing for a character with no such feature", () => {
		expect(getHpBonusPerLevel({originFeats: [{name: "Alert"}]})).toBe(0);
		expect(getHpBonusPerLevel({})).toBe(0);
		expect(getHpBonusPerLevel(null)).toBe(0);
	});

	// The same feat twice is still one feat
	it("Does not count a feature twice", () => {
		expect(getHpBonusPerLevel({originFeats: [{name: "Tough"}], manualFeats: [{name: "Tough"}]})).toBe(2);
	});
});

/*
 * Not everything a character spends is a column in the class table.
 *
 * Magical Cunning, Arcane Recovery, Action Surge and seventeen others are ordinary features whose
 * limit lives in one sentence of prose, and because nothing read that sentence none of them showed
 * up as something to spend — a Warlock's sheet said nothing about Magical Cunning at all.
 */
describe("Features: uses read from what the book says", () => {
	const MAGICAL_CUNNING = {
		name: "Magical Cunning",
		entries: ["You can perform an esoteric rite for 1 minute. At the end of it, you regain expended Pact Magic spell slots but no more than a number equal to half your maximum (round up). Once you use this feature, you can't do so again until you finish a {@variantrule Long Rest|XPHB}."],
	};

	const ACTION_SURGE = {
		name: "Action Surge",
		entries: [
			"On your turn, you can take one additional action.",
			"Once you use this feature, you can't do so again until you finish a {@variantrule Short Rest|XPHB|Short} or {@variantrule Long Rest|XPHB}. Starting at level 17, you can use it twice before a rest but only once on a turn.",
		],
	};

	it("Reads one use and the rest that returns it", () => {
		expect(getFeatureUses(MAGICAL_CUNNING, 2)).toEqual({label: "Magical Cunning", value: "1", kind: "uses", rest: "long"});
	});

	// "a Short Rest or Long Rest" — the shorter one is the one that decides when you get it back
	it("Takes the shorter rest when a feature names both", () => {
		expect(getFeatureUses(ACTION_SURGE, 2).rest).toBe("short");
	});

	it("Reads the level at which it becomes two", () => {
		expect(getFeatureUses(ACTION_SURGE, 16).value).toBe("1");
		expect(getFeatureUses(ACTION_SURGE, 17).value).toBe("2");
	});

	it("Says nothing about a feature with no limit in it", () => {
		expect(getFeatureUses({name: "Evasion", entries: ["You can nimbly dodge out of the way."]}, 7)).toBeNull();
	});

	it("Says nothing about a feature that is not there", () => {
		expect(getFeatureUses(null, 1)).toBeNull();
	});

	/*
	 * A feature that improves at a later level appears twice in the class data — Action Surge is
	 * granted at 2 and again at 17 — and both grants are the same feature, not two.
	 */
	describe("across a whole class", () => {
		const BY_LEVEL = [[], [ACTION_SURGE], [], [], [], [], [], [], [], [], [], [], [], [], [], [], [ACTION_SURGE]];

		it("Lists it once, at the count the character has reached", () => {
			expect(getFeatureResources(BY_LEVEL, 17)).toEqual([{label: "Action Surge", value: "2", kind: "uses", rest: "short"}]);
		});

		it("Counts only the levels the character has", () => {
			expect(getFeatureResources(BY_LEVEL, 1)).toEqual([]);
			expect(getFeatureResources(BY_LEVEL, 2)).toEqual([{label: "Action Surge", value: "1", kind: "uses", rest: "short"}]);
		});
	});
});
