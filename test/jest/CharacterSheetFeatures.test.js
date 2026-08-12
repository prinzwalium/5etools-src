import {getChosenFeatureEffects, getChosenFeatureNames, getFeatureEffects, getFeatureInitiativeBonus, getHpBonusPerLevel} from "../../js/charactersheet/charactersheet-features.js";

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
