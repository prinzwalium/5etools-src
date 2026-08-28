import "../../js/parser.js";
import {
	getResistChoices,
	getWeaponChoices,
	CHOICE_TYPE_ABILITY,
	CHOICE_TYPE_EXPERTISE,
	CHOICE_TYPE_LANGUAGE,
	CHOICE_TYPE_SKILL,
	CHOICE_TYPE_TOOL,
	getAbilityChoices,
	getExpertiseChoices,
	getAbilityPackageDisplay,
	getAbilityPackages,
	getFixedAbilityBonuses,
	getGrantedFeats,
	getSkillToolLanguageChoices,
	CHOICE_TYPE_SKILL_TOOL_LANGUAGE,
	getChoiceWithoutHeld,
	getFixedProficiencyNames,
	getHeldProficiencyNames,
	mergeHeldProficiencyNames,
	getPendingChoices,
	getProfListDisplay,
	getToolChoices,
	ARTISANS_TOOLS,
	getChoiceSignature,
} from "../../js/charactersheet/charactersheet-choices.js";
import {
	POINT_BUY_BUDGET,
	STANDARD_ARRAY,
	getPointBuyCost,
	getPointBuyTotalCost,
	isValidStandardArrayAssignment,
} from "../../js/charactersheet/charactersheet-abilityscores.js";

describe("Choice queue extraction", () => {
	it("Should extract a class skill choice (Fighter-style)", () => {
		const cls = {
			name: "Fighter",
			startingProficiencies: {
				skills: [{choose: {from: ["acrobatics", "animal handling", "athletics", "history", "insight", "intimidation", "perception", "survival"], count: 2}}],
			},
		};
		const choices = getPendingChoices({cls});
		expect(choices).toHaveLength(1);
		expect(choices[0].type).toBe(CHOICE_TYPE_SKILL);
		expect(choices[0].count).toBe(2);
		expect(choices[0].from).toContain("Animal Handling");
		expect(choices[0].sourceName).toBe("Class: Fighter");
	});

	it("Should extract race any-skill and standard-language choices (Half-Elf-style)", () => {
		const race = {
			name: "Half-Elf",
			skillProficiencies: [{any: 2}],
			languageProficiencies: [{common: true, elvish: true, anyStandard: 1}],
		};
		const choices = getPendingChoices({race});
		const skillChoice = choices.find(it => it.type === CHOICE_TYPE_SKILL);
		const langChoice = choices.find(it => it.type === CHOICE_TYPE_LANGUAGE);

		expect(skillChoice.count).toBe(2);
		expect(skillChoice.from).toHaveLength(18);
		expect(langChoice.count).toBe(1);
		expect(langChoice.from).toContain("Dwarvish");
		// Fixed languages are not part of the choice
		expect(langChoice.from.length).toBe(Parser.LANGUAGES_STANDARD.length);
	});

	it("Should extract background tool choices (Soldier-style gaming set)", () => {
		const background = {
			name: "Soldier",
			skillProficiencies: [{athletics: true, intimidation: true}],
			toolProficiencies: [{anyGamingSet: 1, "vehicles (land)": true}],
		};
		const choices = getPendingChoices({background});
		expect(choices).toHaveLength(1);
		expect(choices[0].type).toBe(CHOICE_TYPE_TOOL);
		expect(choices[0].from).toContain("Dice set");
	});

	it("Should order choices species → class → background", () => {
		const choices = getPendingChoices({
			race: {name: "Half-Elf", skillProficiencies: [{any: 2}]},
			cls: {name: "Fighter", startingProficiencies: {skills: [{choose: {from: ["athletics"], count: 1}}]}},
			background: {name: "Sage", languageProficiencies: [{anyStandard: 2}]},
		});
		expect(choices.map(it => it.sourceName)).toEqual(["Species: Half-Elf", "Class: Fighter", "Background: Sage"]);
	});

	it("Should render fixed proficiency displays, with and without choice text", () => {
		const groups = [{anyGamingSet: 1, "vehicles (land)": true}];
		expect(getProfListDisplay(groups)).toBe("1 of your choice, Vehicles (Land)");
		expect(getProfListDisplay(groups, {isFixedOnly: true})).toBe("Vehicles (Land)");
	});
});

describe("Expertise choice extraction (feats)", () => {
	it("Should extract a skill-list Expertise choice (Skill Expert-style)", () => {
		const choices = getExpertiseChoices({groups: [{choose: {from: ["athletics", "stealth", "arcana"]}}], sourceName: "Skill Expert"});
		expect(choices).toHaveLength(1);
		expect(choices[0].type).toBe(CHOICE_TYPE_EXPERTISE);
		expect(choices[0].count).toBe(1);
		expect(choices[0].from).toEqual(["Athletics", "Stealth", "Arcana"]);
	});

	it("Should draw anyProficientSkill Expertise from the character's proficient skills (Prodigy-style)", () => {
		const choices = getExpertiseChoices({groups: [{anyProficientSkill: 1}], sourceName: "Prodigy", proficientSkillNames: ["Stealth", "Perception"]});
		expect(choices).toHaveLength(1);
		expect(choices[0].count).toBe(1);
		expect(choices[0].from).toEqual(["Stealth", "Perception"]);
	});

	it("Should ignore fixed expertise grants (applied elsewhere)", () => {
		expect(getExpertiseChoices({groups: [{perception: true}], sourceName: "Aberrant Anatomy"})).toHaveLength(0);
	});
});

describe("Ability score increase extraction", () => {
	it("Should treat a single fixed package as non-choice (Dwarf: +2 Con)", () => {
		const ability = [{con: 2}];
		expect(getFixedAbilityBonuses(ability)).toEqual({con: 2});
		expect(getAbilityChoices({ability, sourceName: "Species: Dwarf"})).toEqual([]);
	});

	it("Should queue the choose part of a mixed package (Half-Elf: +2 Cha, +1 to two others)", () => {
		const ability = [{cha: 2, choose: {from: ["str", "dex", "con", "int", "wis"], count: 2}}];
		expect(getFixedAbilityBonuses(ability)).toEqual({cha: 2});
		const [choice] = getAbilityChoices({ability, sourceName: "Species: Half-Elf"});
		expect(choice.type).toBe(CHOICE_TYPE_ABILITY);
		expect(choice.packages).toHaveLength(1);
		expect(choice.packages[0].choose).toEqual({from: ["str", "dex", "con", "int", "wis"], count: 2, amount: 1});
	});

	it("Should queue weighted alternative packages (XPHB background: +2/+1 or +1/+1/+1)", () => {
		const ability = [
			{choose: {weighted: {from: ["con", "int", "wis"], weights: [2, 1]}}},
			{choose: {weighted: {from: ["con", "int", "wis"], weights: [1, 1, 1]}}},
		];
		expect(getFixedAbilityBonuses(ability)).toEqual({});
		const [choice] = getAbilityChoices({ability, sourceName: "Background: Sage"});
		expect(choice.packages).toHaveLength(2);
		expect(choice.packages[0].weighted.weights).toEqual([2, 1]);
		expect(getAbilityPackageDisplay(choice.packages[0])).toBe("+2/+1 among Constitution, Intelligence, Wisdom");
	});

	it("Should surface race ability choices ahead of other race choices", () => {
		const choices = getPendingChoices({
			race: {name: "Half-Elf", ability: [{cha: 2, choose: {from: ["str"], count: 2}}], skillProficiencies: [{any: 2}]},
		});
		expect(choices.map(it => it.type)).toEqual([CHOICE_TYPE_ABILITY, CHOICE_TYPE_SKILL]);
	});

	it("Should normalise feat-style choose packages (Resilient: +1 to one of any)", () => {
		const packages = getAbilityPackages([{choose: {from: ["str", "dex", "con", "int", "wis", "cha"], amount: 1}}]);
		expect(packages[0].choose).toEqual({from: ["str", "dex", "con", "int", "wis", "cha"], count: 1, amount: 1});
	});
});

describe("Granted feats (2024-style)", () => {
	it("Should parse uid-keyed feat grants", () => {
		expect(getGrantedFeats([{alert: true}])).toEqual([
			{name: "alert", source: "PHB", subChoice: null, displayName: "Alert"},
		]);
		expect(getGrantedFeats(null)).toEqual([]);
	});

	// The uid narrows the feat as well as naming it, and only the part before the semicolon is the
	// feat's own name — which is what a taken feat is stored under. Keeping the whole string left an
	// Acolyte's granted feat looking untaken however many times it was taken.
	it("Should split a narrowing uid into the feat's name and its sub-choice", () => {
		expect(getGrantedFeats([{"magic initiate; wizard|xphb": true}])).toEqual([
			{name: "magic initiate", source: "xphb", subChoice: "wizard", displayName: "Magic Initiate — Wizard"},
		]);
	});
});

describe("Proficiencies already held", () => {
	const state = {
		skill_athletics: 1,
		skill_stealth: 2,
		skill_arcana: 0,
		proficiencies: [
			{kind: "tool", name: "Thieves' Tools", source: "Rogue", entries: ["Thieves' Tools"]},
			{kind: "language", name: "Elvish", source: "Elf", entries: ["Elvish"]},
			{kind: "armor", name: "Light", source: "Rogue", entries: ["Light"]},
		],
	};

	it("Should collect what the character already has, by choice type", () => {
		const held = getHeldProficiencyNames(state);
		expect([...held.skill].sort()).toEqual(["Athletics", "Stealth"]);
		expect([...held.tool]).toEqual(["Thieves' Tools"]);
		expect([...held.language]).toEqual(["Elvish"]);
	});

	it("Should subtract the held options from a choice, clipping its count", () => {
		const choice = {type: "skill", count: 2, from: ["Athletics", "Stealth", "Arcana"], label: "Choose 2 skills"};
		expect(getChoiceWithoutHeld(choice, getHeldProficiencyNames(state))).toMatchObject({from: ["Arcana"], count: 1});
	});

	it("Should report a choice with nothing left to offer as spent", () => {
		const choice = {type: "skill", count: 1, from: ["Athletics"], label: "Choose 1 skill"};
		expect(getChoiceWithoutHeld(choice, getHeldProficiencyNames(state))).toBeNull();
	});

	it("Should leave a choice untouched when the character holds none of it", () => {
		const choice = {type: "skill", count: 1, from: ["Arcana"], label: "Choose 1 skill"};
		expect(getChoiceWithoutHeld(choice, getHeldProficiencyNames({}))).toBe(choice);
	});

	// The guided setup answers every choice before anything reaches the sheet, so the character
	// cannot yet tell the class chooser that the background hands it Stealth outright
	it("Should read the fixed grants of entities that are picked but not yet applied", () => {
		const fixed = getFixedProficiencyNames({
			background: {name: "Criminal", skillProficiencies: [{sleight_of_hand: true, stealth: true}]},
		});
		expect([...fixed.skill].sort()).toEqual(["Sleight of Hand", "Stealth"]);
	});

	it("Should merge what is held with what is about to be granted", () => {
		const merged = mergeHeldProficiencyNames(
			getHeldProficiencyNames(state),
			getFixedProficiencyNames({background: {name: "Criminal", skillProficiencies: [{stealth: true}]}}),
		);
		expect([...merged.skill].sort()).toEqual(["Athletics", "Stealth"]);
	});
});

describe("Ability score methods", () => {
	it("Should cost point-buy scores per the PHB table", () => {
		expect(getPointBuyCost(8)).toBe(0);
		expect(getPointBuyCost(13)).toBe(5);
		expect(getPointBuyCost(14)).toBe(7);
		expect(getPointBuyCost(15)).toBe(9);
		expect(getPointBuyCost(16)).toBeNull();
		expect(getPointBuyCost(7)).toBeNull();
	});

	it("Should total a classic 27-point spread", () => {
		// 15/15/15/8/8/8 = 9+9+9 = 27; the classic 15/14/13/12/10/8 spread also totals exactly 27
		expect(getPointBuyTotalCost({str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8})).toBe(POINT_BUY_BUDGET);
		expect(getPointBuyTotalCost({str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8})).toBe(POINT_BUY_BUDGET);
		expect(getPointBuyTotalCost({str: 16, dex: 8, con: 8, int: 8, wis: 8, cha: 8})).toBeNull();
	});

	it("Should validate standard array assignments", () => {
		expect(isValidStandardArrayAssignment({str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8})).toBe(true);
		expect(isValidStandardArrayAssignment({str: 8, dex: 10, con: 12, int: 13, wis: 14, cha: 15})).toBe(true);
		expect(isValidStandardArrayAssignment({str: 15, dex: 15, con: 13, int: 12, wis: 10, cha: 8})).toBe(false);
		expect(isValidStandardArrayAssignment({str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: null})).toBe(false);
		expect(STANDARD_ARRAY).toHaveLength(6);
	});
});

describe("Choices: damage-resistance picks", () => {
	it("Extracts a Dragonborn-style draconic ancestry choice", () => {
		const groups = [{choose: {from: ["acid", "lightning", "fire", "poison", "cold"]}}];
		const [choice] = getResistChoices({groups, sourceName: "Dragonborn"});
		expect(choice).toMatchObject({type: "resist", sourceName: "Dragonborn", count: 1});
		expect(choice.from).toEqual(["Acid", "Lightning", "Fire", "Poison", "Cold"]);
		expect(choice.label).toBe("Choose 1 damage resistance");
	});

	it("Honours a count above one", () => {
		const [choice] = getResistChoices({groups: [{choose: {from: ["fire", "cold"], count: 2}}], sourceName: "X"});
		expect(choice.count).toBe(2);
		expect(choice.label).toBe("Choose 2 damage resistances");
	});

	it("Ignores fixed resistances and empty input", () => {
		expect(getResistChoices({groups: ["fire"], sourceName: "X"})).toEqual([]);
		expect(getResistChoices({groups: [], sourceName: "X"})).toEqual([]);
		expect(getResistChoices({groups: null, sourceName: "X"})).toEqual([]);
	});
});

describe("Choices: tool picks", () => {
	it("Offers the artisan's tools for an `anyArtisansTool` grant", () => {
		const [choice] = getToolChoices({groups: [{anyArtisansTool: 2}], sourceName: "Dwarf"});
		expect(choice).toMatchObject({type: CHOICE_TYPE_TOOL, sourceName: "Dwarf", count: 2});
		expect(choice.label).toBe("Choose 2 artisan's tools");
		expect(choice.from).toEqual(ARTISANS_TOOLS);
	});

	it("Offers every tool for a bare `any` grant", () => {
		const [choice] = getToolChoices({groups: [{any: 1}], sourceName: "Warforged"});
		expect(choice.label).toBe("Choose 1 tool");
		expect(choice.from).toEqual(expect.arrayContaining(["Smith's tools", "Thieves' tools", "Lute", "Dice set"]));
	});

	it("Reads an explicit list, and ignores fixed grants", () => {
		const [choice] = getToolChoices({groups: [{choose: {from: ["smith's tools", "mason's tools"]}}], sourceName: "Dwarf"});
		expect(choice.from).toEqual(["Smith's Tools", "Mason's Tools"]);
		expect(getToolChoices({groups: [{"thieves' tools": true}], sourceName: "Rogue"})).toEqual([]);
	});
});

/**
 * `skillToolLanguageProficiencies` — the field that says "any combination of three skills or tools".
 *
 * Skilled looked prose-only for as long as only `skillProficiencies` was read; the choice is
 * structured, in its own field, with `anySkill`/`anyTool` as the pool tokens. Reading it is what
 * turned a curated special case back into ordinary data.
 */
describe("Choices: one pick across skills, tools and languages", () => {
	const TOOLS = ["Smith's Tools", "Lute", "Dice Set"];

	it("Reads the mixed-pool shape Skilled uses", () => {
		const [choice] = getSkillToolLanguageChoices({
			groups: [{choose: [{from: ["anySkill", "anyTool"], count: 3}]}],
			sourceName: "Skilled",
			toolNames: TOOLS,
		});
		expect(choice).toMatchObject({type: CHOICE_TYPE_SKILL_TOOL_LANGUAGE, sourceName: "Skilled", count: 3});
		expect(choice.label).toBe("Choose 3 skills or tools");
		// One pool, so a pick can be spent either way
		expect(choice.from).toEqual(expect.arrayContaining(["Acrobatics", "Smith's Tools"]));
		expect(choice.pools.skill).toContain("Stealth");
		expect(choice.pools.tool).toEqual(TOOLS);
		expect(choice.pools.language).toEqual([]);
	});

	it("Reads the bare-token shape, one choice per token", () => {
		const choices = getSkillToolLanguageChoices({
			groups: [{anyLanguage: 1, anyTool: 1}],
			sourceName: "Custom Background",
			toolNames: TOOLS,
		});
		expect(choices).toHaveLength(2);
		expect(choices.map(c => c.count)).toEqual([1, 1]);
	});

	it("Takes the tool list it is given, so the pool can come from the item data", () => {
		const [choice] = getSkillToolLanguageChoices({
			groups: [{anyTool: 2}],
			sourceName: "Feat",
			toolNames: ["Painter's Supplies"],
		});
		expect(choice.from).toEqual(["Painter's Supplies"]);
	});

	it("Skips a token it does not know rather than guessing a pool", () => {
		expect(getSkillToolLanguageChoices({groups: [{choose: [{from: ["anyNonsense"], count: 1}]}], sourceName: "X"})).toEqual([]);
		expect(getSkillToolLanguageChoices({})).toEqual([]);
	});
});

describe("Choice signatures", () => {
	// The key everything writes and reads: the guide, the pickers, the panels and the Build Check.
	// Without one, each kept its own idea of what had been answered — and they disagreed
	it("Names a choice by where it came from and what it asks", () => {
		const choice = {sourceName: "Background: Sailor", type: "skill", label: "Choose 2 skills", id: "csc-17"};
		expect(getChoiceSignature(choice)).toBe("Background: Sailor|skill|Choose 2 skills");
	});

	it("Ignores the per-render id, which cannot be stored", () => {
		const a = {sourceName: "Species: Human", type: "skill", label: "Choose 1 skill (any)", id: "csc-1"};
		const b = {...a, id: "csc-99"};
		expect(getChoiceSignature(a)).toBe(getChoiceSignature(b));
	});

	// Two sources can ask the same question, and answering one must not answer the other
	it("Tells apart the same question from different sources", () => {
		const human = {sourceName: "Species: Human", type: "skill", label: "Choose 1 skill (any)"};
		const rogue = {sourceName: "Class: Rogue", type: "skill", label: "Choose 1 skill (any)"};
		expect(getChoiceSignature(human)).not.toBe(getChoiceSignature(rogue));
	});

	it("Copes with nothing at all", () => {
		expect(getChoiceSignature(null)).toBe("||");
	});
});

/*
 * Weapon Master, and only Weapon Master, writes its four picks as a `fromFilter` string. Nothing
 * read it, so the feat granted nothing at all.
 */
describe("weapon proficiency choices", () => {
	const WEAPON_MASTER = [{choose: {fromFilter: "type=martial weapon;mundane weapon|miscellaneous=mundane", count: 4}}];

	it("Reads how many, and which categories to offer", () => {
		const [choice] = getWeaponChoices({groups: WEAPON_MASTER, sourceName: "Weapon Master"});
		expect(choice.count).toBe(4);
		expect(choice.categories).toEqual(["martial"]);
		expect(choice.sourceName).toBe("Weapon Master");
	});

	it("Keeps only what names a weapon category", () => {
		// "mundane weapon" is the exclusion of magic items, not a category — asking for base weapons
		// already achieves it
		const [choice] = getWeaponChoices({groups: WEAPON_MASTER, sourceName: "x"});
		expect(choice.categories).not.toContain("mundane");
	});

	it("Offers everything when the filter names no category", () => {
		const [choice] = getWeaponChoices({groups: [{choose: {fromFilter: "miscellaneous=mundane", count: 2}}], sourceName: "x"});
		expect(choice.categories).toBeNull();
		expect(choice.count).toBe(2);
	});

	it("Defaults to one where the filter does not say", () => {
		const [choice] = getWeaponChoices({groups: [{choose: {fromFilter: "type=simple weapon"}}], sourceName: "x"});
		expect(choice.count).toBe(1);
		expect(choice.categories).toEqual(["simple"]);
	});

	it("Says nothing for a fixed grant, which is applied rather than asked", () => {
		expect(getWeaponChoices({groups: [{martial: true}], sourceName: "x"})).toEqual([]);
		expect(getWeaponChoices({groups: null, sourceName: "x"})).toEqual([]);
	});
});
