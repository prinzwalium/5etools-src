import {annotateVariantFeatures, filterActiveFeatures, getChosenFeatureEffects, getChosenFeatureNames, getFeatureEffects, getFeatureInitiativeBonus, getFeatureActionBucket, getFeatureCost, getFeatureResources, getFeatureUses, getHpBonusPerLevel, getVariantParentName, getVariantReplacedNames} from "../../js/charactersheet/charactersheet-features.js";

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

/*
 * Tasha's optional class features. The data references them from `classFeatures` *beside* the
 * features they replace, so a level-1 Ranger reads as Favored Enemy + Favored Foe + Natural
 * Explorer + Deft Explorer — both halves of two either/or pairs — until something separates them.
 */
describe("optional class features", () => {
	const FAVORED_ENEMY = {name: "Favored Enemy", source: "PHB", entries: ["You have significant experience studying one type of enemy."]};
	const NATURAL_EXPLORER = {name: "Natural Explorer", source: "PHB", entries: ["You are a master of navigating the natural world."]};
	const FAVORED_FOE = {
		name: "Favored Foe",
		source: "TCE",
		isClassFeatureVariant: true,
		entries: [
			"{@i 1st-level ranger {@variantrule optional class features|tce|optional feature}, which replaces the Favored Enemy feature and works with the Foe Slayer feature}",
			"When you hit a creature with an attack roll, you can mark the target as your favored enemy.",
		],
	};
	const DEFT_EXPLORER = {
		name: "Deft Explorer",
		source: "TCE",
		isClassFeatureVariant: true,
		entries: [
			"{@i 1st-level ranger {@variantrule optional class features|tce|optional feature}, which replaces the Natural Explorer feature}",
			"You are an unsurpassed explorer and survivor.",
		],
	};
	const DEFT_IMPROVEMENT = {
		name: "Deft Explorer Improvement",
		source: "TCE",
		isClassFeatureVariant: true,
		entries: ["You gain an additional benefit when you reach 6th level in this class."],
	};
	const STEADY_AIM = {
		name: "Steady Aim",
		source: "TCE",
		isClassFeatureVariant: true,
		entries: [
			"{@i 3rd-level rogue {@variantrule optional class features|tce|optional feature}}",
			"As a bonus action, you give yourself advantage on your next attack roll.",
		],
	};

	const TIMELINE = [
		{level: 1, feature: FAVORED_ENEMY, isSubclassFeature: false},
		{level: 1, feature: FAVORED_FOE, isSubclassFeature: false},
		{level: 1, feature: NATURAL_EXPLORER, isSubclassFeature: false},
		{level: 1, feature: DEFT_EXPLORER, isSubclassFeature: false},
		{level: 6, feature: DEFT_IMPROVEMENT, isSubclassFeature: false},
	];

	const names = list => list.map(it => it.feature.name);

	describe("reading what one replaces", () => {
		it("Reads the replaced feature out of the italic header", () => {
			expect(getVariantReplacedNames(DEFT_EXPLORER)).toEqual(["Natural Explorer"]);
		});

		it("Stops at the feature name where the header runs on", () => {
			// "...replaces the Favored Enemy feature and works with the Foe Slayer feature"
			expect(getVariantReplacedNames(FAVORED_FOE)).toEqual(["Favored Enemy"]);
		});

		it("Says nothing for a variant that adds rather than swaps", () => {
			expect(getVariantReplacedNames(STEADY_AIM)).toEqual([]);
		});

		it("Says nothing for an ordinary feature", () => {
			expect(getVariantReplacedNames(NATURAL_EXPLORER)).toEqual([]);
		});

		it("Reads a subclass variant's header, which words itself differently", () => {
			const primalCompanion = {
				name: "Primal Companion",
				source: "TCE",
				isClassFeatureVariant: true,
				entries: ["{@i 3rd-level Beast Master variant feature, which replaces the Ranger's Companion feature}", "You magically summon a primal beast."],
			};
			expect(getVariantReplacedNames(primalCompanion)).toEqual(["Ranger's Companion"]);
		});
	});

	describe("what a character actually has", () => {
		it("Grants none of them until the table allows them", () => {
			expect(names(filterActiveFeatures(annotateVariantFeatures(TIMELINE, [])))).toEqual(["Favored Enemy", "Natural Explorer"]);
		});

		it("Swaps out what a taken variant replaces", () => {
			const taken = [{name: "Deft Explorer", source: "TCE"}];
			expect(names(filterActiveFeatures(annotateVariantFeatures(TIMELINE, taken)))).toEqual(["Favored Enemy", "Deft Explorer", "Deft Explorer Improvement"]);
		});

		it("Takes them one at a time, not as a set", () => {
			const taken = [{name: "Favored Foe", source: "TCE"}];
			expect(names(filterActiveFeatures(annotateVariantFeatures(TIMELINE, taken)))).toEqual(["Favored Foe", "Natural Explorer"]);
		});

		it("Names what replaced a superseded feature, for the card that has to say so", () => {
			const annotated = annotateVariantFeatures(TIMELINE, [{name: "Favored Foe", source: "TCE"}]);
			expect(annotated.find(it => it.feature.name === "Favored Enemy").replacedBy).toBe("Favored Foe");
			expect(annotated.find(it => it.feature.name === "Natural Explorer").replacedBy).toBeNull();
		});
	});

	describe("a variant that is the rest of another", () => {
		it("Has no toggle of its own", () => {
			expect(getVariantParentName(DEFT_IMPROVEMENT)).toBe("Deft Explorer");
			expect(getVariantParentName(DEFT_EXPLORER)).toBeNull();
			expect(getVariantParentName(NATURAL_EXPLORER)).toBeNull();
		});

		it("Follows its parent's", () => {
			const withParent = annotateVariantFeatures(TIMELINE, [{name: "Deft Explorer", source: "TCE"}]);
			expect(withParent.find(it => it.feature.name === "Deft Explorer Improvement").isVariantTaken).toBe(true);
			const without = annotateVariantFeatures(TIMELINE, []);
			expect(without.find(it => it.feature.name === "Deft Explorer Improvement").isVariantTaken).toBe(false);
		});
	});

	describe("as resources", () => {
		const QUICKENED_HEALING = {
			name: "Quickened Healing",
			source: "TCE",
			isClassFeatureVariant: true,
			entries: [
				"{@i 4th-level monk {@variantrule optional class features|tce|optional feature}}",
				"You regain hit points. Once you use this feature, you can't do so again until you finish a {@variantrule Long Rest|XPHB}.",
			],
		};
		const BY_LEVEL = [[], [], [], [QUICKENED_HEALING]];

		it("Does not offer one nobody took", () => {
			expect(getFeatureResources(BY_LEVEL, 4)).toEqual([]);
		});

		it("Offers it once it is taken", () => {
			expect(getFeatureResources(BY_LEVEL, 4, {featureVariants: [{name: "Quickened Healing", source: "TCE"}]}))
				.toEqual([{label: "Quickened Healing", value: "1", kind: "uses", rest: "long"}]);
		});
	});
});

/*
 * What using a feature spends. `consumes` is structured, on 137 features, and was read by nothing —
 * so the sheet knew Flurry of Blows cost Ki because a nine-line map said so, and knew nothing at
 * all about a Way of Mercy monk, a Twilight cleric or a Psi Warrior.
 */
describe("what a feature costs", () => {
	it("Reads a bare name as one of it", () => {
		expect(getFeatureCost({name: "Turn Undead", consumes: {name: "Channel Divinity"}}))
			.toEqual({resource: "Channel Divinity", amount: 1, amountMin: null, amountMax: null});
	});

	it("Reads a stated amount", () => {
		expect(getFeatureCost({name: "Hand of Ultimate Mercy", consumes: {name: "Ki", amount: 5}}))
			.toMatchObject({resource: "Ki", amount: 5});
	});

	it("Reads a range as its low end, because that is what it takes to use at all", () => {
		expect(getFeatureCost({name: "Bastion of Law", consumes: {name: "Sorcery Point", amountMin: 1, amountMax: 5}}))
			.toEqual({resource: "Sorcery Point", amount: 1, amountMin: 1, amountMax: 5});
	});

	it("Says nothing for a feature that spends nothing", () => {
		expect(getFeatureCost({name: "Evasion"})).toBeNull();
		expect(getFeatureCost(null)).toBeNull();
	});
});

/*
 * When a feature is taken, from the one phrase that states it. Fifty-six of the features that spend
 * something say so; the rest are riders on another action, and guessing them into the Action column
 * would put Psionic Strike there, which is not a thing you take a turn to do.
 */
describe("when a feature is taken", () => {
	const of = entries => getFeatureActionBucket({name: "x", entries});

	it("Reads a bonus action", () => {
		expect(of(["As a Bonus Action, you can spend 1 Focus Point to take the Dash action."])).toBe("bonus");
	});

	it("Reads a reaction", () => {
		expect(of(["As a Reaction, you can reduce the damage taken."])).toBe("reaction");
	});

	it("Reads an action, and the 2024 Magic action as one", () => {
		expect(of(["As an Action, you present your holy symbol."])).toBe("action");
		expect(of(["As a Magic action, you expend a use of Channel Divinity."])).toBe("action");
	});

	it("Says nothing where the book does not, rather than guessing", () => {
		expect(of(["When you hit a creature with an attack roll, you can expend one Psionic Energy Die."])).toBeNull();
		expect(of([])).toBeNull();
		expect(getFeatureActionBucket(null)).toBeNull();
	});
});
