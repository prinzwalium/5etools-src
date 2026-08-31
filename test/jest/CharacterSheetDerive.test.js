import "../../js/parser.js";
import {deriveArmorClass, deriveCharacterSheet, formatBreakdown, getAbilityScore, getAbilityScoreParts, getConcentrationSaveDc, getEquippedMagicBonuses, getItemAbilityEffects, getProfBonus, getTotalLevel, getUnarmedStrike, getWeaponAttack, hasSpellcasting} from "../../js/charactersheet/charactersheet-derive.js";

const getBaseState = (overrides = {}) => ({
	level: 1,
	initMisc: 0,
	classes: [],
	abil_str: 10,
	abil_dex: 10,
	abil_con: 10,
	abil_int: 10,
	abil_wis: 10,
	abil_cha: 10,
	spellAbility: "",
	...overrides,
});

describe("Character sheet derivation", () => {
	it("Should derive a level 5 fighter (PHB values)", () => {
		const state = getBaseState({
			level: 5,
			abil_str: 16,
			abil_dex: 14,
			abil_con: 15,
			save_str: true,
			save_con: true,
			skill_athletics: 1,
			skill_perception: 1,
		});
		const derived = deriveCharacterSheet(state);

		expect(derived.totalLevel).toBe(5);
		expect(derived.pb).toBe(3);
		expect(derived.abilities.str.mod).toBe(3);
		expect(derived.saves.str.mod).toBe(6);
		expect(derived.saves.con.mod).toBe(5);
		expect(derived.saves.dex.mod).toBe(2); // not proficient
		expect(derived.skills.athletics.mod).toBe(6);
		expect(derived.passivePerception).toBe(13); // 10 + wis 0 + pb 3, perception proficient
		expect(derived.initiative).toBe(2);
		expect(derived.spell).toBeNull();
	});

	it("Should derive a level 11 cleric's spellcasting stats", () => {
		const state = getBaseState({
			level: 11,
			abil_wis: 18,
			spellAbility: "wis",
		});
		const derived = deriveCharacterSheet(state);

		expect(derived.pb).toBe(4);
		expect(derived.spell.dc).toBe(16); // 8 + 4 + 4
		expect(derived.spell.atkMod).toBe(8);
	});

	it("Should sum structured class levels over the manual level field", () => {
		const state = getBaseState({
			level: 1,
			classes: [
				{id: "a", name: "Fighter", source: "PHB", level: 3},
				{id: "b", name: "Wizard", source: "PHB", level: 2},
			],
		});
		expect(getTotalLevel(state)).toBe(5);
		expect(getProfBonus(state)).toBe(3);
	});

	it("Should apply expertise as double proficiency", () => {
		const state = getBaseState({
			level: 9,
			abil_dex: 16,
			skill_stealth: 2,
		});
		const derived = deriveCharacterSheet(state);
		expect(derived.pb).toBe(4);
		expect(derived.skills.stealth.mod).toBe(11); // 3 + 2×4
	});

	it("Should treat blank abilities as 10 and clamp level to 1-20", () => {
		const stateBlank = getBaseState({abil_str: null, level: null});
		const derivedBlank = deriveCharacterSheet(stateBlank);
		expect(derivedBlank.abilities.str.mod).toBe(0);
		expect(derivedBlank.totalLevel).toBe(1);

		const stateHigh = getBaseState({level: 25});
		expect(getTotalLevel(stateHigh)).toBe(20);
		expect(getProfBonus(stateHigh)).toBe(6);

		const stateMulti = getBaseState({classes: [{id: "a", name: "Fighter", source: "PHB", level: 22}]});
		expect(getTotalLevel(stateMulti)).toBe(20);
	});

	it("Should include miscellaneous initiative bonuses", () => {
		const state = getBaseState({abil_dex: 14, initMisc: 5});
		expect(deriveCharacterSheet(state).initiative).toBe(7);
	});

	describe("Armor Class", () => {
		it("Should default to 10 + Dex unarmored", () => {
			const state = getBaseState({abil_dex: 16});
			expect(deriveArmorClass(state).ac).toBe(13);
		});

		it("Should use light armor (base + full Dex) only when equipped", () => {
			const armor = {id: "a", type: "LA", isArmor: true, baseAc: 11, equipped: false};
			const state = getBaseState({abil_dex: 18, inventory: [armor]});
			expect(deriveArmorClass(state).ac).toBe(14); // unequipped → unarmored 10+4
			armor.equipped = true;
			expect(deriveArmorClass(state).ac).toBe(15); // 11 + 4
		});

		it("Should cap Dex on medium armor and ignore it on heavy", () => {
			const med = {id: "m", type: "MA", isArmor: true, baseAc: 15, equipped: true};
			expect(deriveArmorClass(getBaseState({abil_dex: 18, inventory: [med]})).ac).toBe(17); // 15 + min(4,2)
			const heavy = {id: "h", type: "HA", isArmor: true, baseAc: 16, equipped: true};
			expect(deriveArmorClass(getBaseState({abil_dex: 18, inventory: [heavy]})).ac).toBe(16); // no Dex
		});

		it("Should add shields, magic armor bonuses, and worn magic AC", () => {
			const inv = [
				{id: "a", type: "HA", isArmor: true, baseAc: 16, bonusAc: 1, equipped: true},
				{id: "s", type: "S", baseAc: 2, bonusAc: 1, equipped: true},
				{id: "r", type: "RG", bonusAc: 1, equipped: true}, // ring of protection
			];
			expect(deriveArmorClass(getBaseState({inventory: inv})).ac).toBe(21); // 16+1 +3 +1
		});

		it("Should apply Barbarian/Monk unarmored formulas, and honour manual mode", () => {
			const s = getBaseState({abil_dex: 14, abil_con: 16, abil_wis: 12});
			expect(deriveArmorClass({...s, acMode: "barbarian"}).ac).toBe(15); // 10 +2 +3
			expect(deriveArmorClass({...s, acMode: "monk"}).ac).toBe(13); // 10 +2 +1
			expect(deriveArmorClass({...s, acMode: "manual", ac: 20}).ac).toBe(20);
		});
	});

	describe("Weapon attacks", () => {
		it("Should use Strength for a melee weapon (with proficiency)", () => {
			const state = getBaseState({abil_str: 16, level: 5}); // Str +3, PB +3
			const atk = getWeaponAttack(state, {name: "Longsword", type: "M", dmg1: "1d8", dmgType: "S"});
			expect(atk.name).toBe("Longsword");
			expect(atk.atkBonus).toBe(6);
			expect(atk.damage).toMatch(/^1d8\+3 slashing$/i);
		});

		it("Should use Dexterity for ranged and the better of Str/Dex for finesse", () => {
			const state = getBaseState({abil_str: 10, abil_dex: 18});
			expect(getWeaponAttack(state, {name: "Longbow", type: "R", dmg1: "1d8", dmgType: "P"}).damage).toMatch(/^1d8\+4 piercing$/i);
			expect(getWeaponAttack(state, {name: "Dagger", type: "M", properties: ["F"], dmg1: "1d4", dmgType: "P"}).damage).toMatch(/^1d4\+4 piercing$/i);
		});

		it("Should fold in magic attack/damage bonuses", () => {
			const state = getBaseState({abil_str: 16, level: 1}); // Str +3, PB +2
			const atk = getWeaponAttack(state, {name: "+1 Longsword", type: "M", dmg1: "1d8", dmgType: "S", bonusAttack: 1, bonusDamage: 1});
			expect(atk.atkBonus).toBe(6); // 3 + 2 + 1
			expect(atk.damage).toMatch(/^1d8\+4 slashing$/i); // 3 + 1
		});

		it("Should build the Unarmed Strike from Strength", () => {
			const state = getBaseState({abil_str: 14, level: 1}); // Str +2, PB +2
			expect(getUnarmedStrike(state)).toMatchObject({name: "Unarmed Strike", atkBonus: 4, damage: "3 bludgeoning"});
			expect(getUnarmedStrike(state).atkParts.map(p => p.label)).toEqual(["Strength", "Proficiency"]);
		});
	});

	describe("Equipped magic bonuses (saves / spell DC / spell attack)", () => {
		it("Should sum only equipped items", () => {
			const inv = [
				{id: "c", name: "Cloak of Protection", bonusSavingThrow: 1, bonusAc: 1, equipped: true},
				{id: "r", name: "Rod of the Pact Keeper", bonusSpellSaveDc: 1, bonusSpellAttack: 1, equipped: false},
			];
			expect(getEquippedMagicBonuses({inventory: inv})).toEqual({savingThrow: 1, spellSaveDc: 0, spellAttack: 0});
			inv[1].equipped = true;
			expect(getEquippedMagicBonuses({inventory: inv})).toEqual({savingThrow: 1, spellSaveDc: 1, spellAttack: 1});
		});

		it("Should flow into saving throws and spell DC/attack in the full derivation", () => {
			const state = getBaseState({
				abil_cha: 16,
				level: 5,
				save_cha: true,
				spellAbility: "cha", // Cha +3, PB +3
				inventory: [{id: "c", name: "Cloak of Protection", bonusSavingThrow: 1, equipped: true},
					{id: "r", name: "Rod", bonusSpellSaveDc: 1, bonusSpellAttack: 1, equipped: true}],
			});
			const d = deriveCharacterSheet(state);
			expect(d.saves.cha.mod).toBe(7); // 3 + 3 (prof) + 1 (cloak)
			expect(d.saves.str.mod).toBe(1); // 0 + 1 (cloak), no proficiency
			expect(d.spell.dc).toBe(15); // 8 + 3 + 3 + 1
			expect(d.spell.atkMod).toBe(7); // 3 + 3 + 1
		});
	});
});

describe("Derive: fighting-style effects", () => {
	const withStyle = (name, overrides = {}) => getBaseState({
		classes: [{optionalFeatures: [{name}]}],
		...overrides,
	});

	it("Archery adds +2 to ranged weapon attacks only", () => {
		const bow = {name: "Longbow", type: "R", dmg1: "1d8", dmgType: "P", properties: ["A", "2H"]};
		const sword = {name: "Longsword", type: "M", dmg1: "1d8", dmgType: "S", properties: []};
		const state = withStyle("Archery", {abil_dex: 14, abil_str: 14});
		expect(getWeaponAttack(state, bow).atkBonus).toBe(2 + 2 + 2); // Dex +2, PB +2, Archery +2
		expect(getWeaponAttack(state, sword).atkBonus).toBe(2 + 2); // melee: unaffected
	});

	it("Defense adds +1 AC only while wearing armor", () => {
		const armor = {name: "Chain Shirt", isArmor: true, type: "MA", baseAc: 13, dexterityMax: 2, equipped: true};
		expect(deriveArmorClass(withStyle("Defense", {inventory: [armor]})).ac).toBe(14); // 13 + 1
		expect(deriveArmorClass(withStyle("Defense", {inventory: []})).ac).toBe(10); // unarmored: no bonus
	});

	it("Dueling adds +2 damage to one-handed melee weapons only", () => {
		const sword = {name: "Longsword", type: "M", dmg1: "1d8", dmgType: "S", properties: []};
		const greatsword = {name: "Greatsword", type: "M", dmg1: "2d6", dmgType: "S", properties: ["2H", "H"]};
		const state = withStyle("Dueling", {abil_str: 14});
		expect(getWeaponAttack(state, sword).damage).toBe("1d8+4 slashing"); // Str +2, Dueling +2
		expect(getWeaponAttack(state, greatsword).damage).toBe("2d6+2 slashing"); // two-handed: unaffected
	});

	it("Thrown Weapon Fighting adds +2 damage to thrown weapons", () => {
		const javelin = {name: "Javelin", type: "M", dmg1: "1d6", dmgType: "P", properties: ["T"]};
		const state = withStyle("Thrown Weapon Fighting", {abil_str: 14});
		expect(getWeaponAttack(state, javelin).damage).toBe("1d6+4 piercing"); // Str +2, TWF +2
	});

	it("Styles chosen as 2024 feats apply the same way", () => {
		const bow = {name: "Shortbow", type: "R", dmg1: "1d6", dmgType: "P", properties: ["A", "2H"]};
		const state = getBaseState({abil_dex: 14, featureFeats: [{name: "Archery"}]});
		expect(getWeaponAttack(state, bow).atkBonus).toBe(2 + 2 + 2);
	});

	it("Leaves characters without a style untouched", () => {
		const bow = {name: "Longbow", type: "R", dmg1: "1d8", dmgType: "P", properties: ["A", "2H"]};
		expect(getWeaponAttack(getBaseState({abil_dex: 14}), bow).atkBonus).toBe(2 + 2);
	});
});

describe("Derive: breakdowns (where a number comes from)", () => {
	it("Explains a save: ability, proficiency and magic items", () => {
		const cloak = {name: "Cloak of Protection", equipped: true, bonusSavingThrow: 1};
		const state = getBaseState({level: 5, abil_dex: 16, save_dex: true, inventory: [cloak]});
		const {saves} = deriveCharacterSheet(state);
		expect(saves.dex.mod).toBe(3 + 3 + 1); // Dex +3, PB +3, cloak +1
		expect(saves.dex.parts.map(p => p.label)).toEqual(["Dexterity", "Proficiency", "Magic items"]);
		expect(formatBreakdown(saves.dex.parts, saves.dex.mod)).toBe("Dexterity +3, Proficiency +3, Magic items +1 = +7");
	});

	it("Explains a skill, and distinguishes Expertise", () => {
		const state = getBaseState({level: 1, abil_dex: 14, skill_stealth: 2, skill_acrobatics: 1});
		const {skills} = deriveCharacterSheet(state);
		expect(formatBreakdown(skills.stealth.parts, skills.stealth.mod)).toBe("Dexterity +2, Expertise (2× proficiency) +4 = +6");
		expect(formatBreakdown(skills.acrobatics.parts, skills.acrobatics.mod)).toBe("Dexterity +2, Proficiency +2 = +4");
	});

	it("Keeps a zero ability modifier visible but drops absent contributions", () => {
		const {skills} = deriveCharacterSheet(getBaseState({skill_arcana: 0}));
		// Int +0 is shown (it is a real contribution); there is no proficiency part
		expect(skills.arcana.parts.map(p => p.label)).toEqual(["Intelligence"]);
	});

	it("Explains Armor Class from armor, shield, magic and fighting style", () => {
		const state = getBaseState({
			abil_dex: 14,
			classes: [{optionalFeatures: [{name: "Defense"}]}],
			inventory: [
				{name: "Chain Shirt", isArmor: true, type: "MA", baseAc: 13, dexterityMax: 2, equipped: true},
				{name: "Shield", type: "S", baseAc: 2, equipped: true},
			],
			acMisc: 1,
		});
		const ac = deriveArmorClass(state);
		expect(ac.ac).toBe(13 + 2 + 2 + 1 + 1);
		expect(ac.parts.map(p => p.label))
			.toEqual(["Chain Shirt", "Dexterity (max +2)", "Shield", "Defense (fighting style)", "Misc"]);
	});

	it("Explains initiative and passive Perception", () => {
		const state = getBaseState({abil_dex: 16, initMisc: 2, skill_perception: 1});
		const d = deriveCharacterSheet(state);
		expect(formatBreakdown(d.initiativeParts, d.initiative)).toBe("Dexterity +3, Misc +2 = +5");
		expect(d.passivePerception).toBe(10 + d.skills.perception.mod);
		expect(d.passivePerceptionParts[0]).toMatchObject({label: "Base", value: 10});
	});

	it("Explains spell save DC and spell attack", () => {
		const rod = {name: "Rod of the Pact Keeper +1", equipped: true, bonusSpellSaveDc: 1, bonusSpellAttack: 1};
		const state = getBaseState({level: 5, abil_cha: 18, spellAbility: "cha", inventory: [rod]});
		const {spell} = deriveCharacterSheet(state);
		expect(formatBreakdown(spell.dcParts, spell.dc - 0)).toContain("Base 8");
		expect(spell.dc).toBe(8 + 3 + 4 + 1);
		expect(spell.atkParts.map(p => p.label)).toEqual(["Proficiency", "Charisma", "Magic items"]);
	});

	it("Explains a weapon attack including its fighting style", () => {
		const bow = {name: "Longbow +1", type: "R", dmg1: "1d8", dmgType: "P", properties: ["A", "2H"], bonusAttack: 1, bonusDamage: 1};
		const state = getBaseState({abil_dex: 16, classes: [{optionalFeatures: [{name: "Archery"}]}]});
		const atk = getWeaponAttack(state, bow);
		expect(atk.atkBonus).toBe(3 + 2 + 1 + 2);
		expect(atk.atkParts.map(p => p.label)).toEqual(["Dexterity", "Proficiency", "Magic weapon", "Archery (fighting style)"]);
		expect(atk.damageParts[0]).toMatchObject({label: "1d8", isText: true});
	});

	it("Shows value-type totals unsigned (AC, DC, passive) but bonuses signed", () => {
		const parts = [{label: "Base", value: 10, isRaw: true}, {label: "Dexterity", value: 3}];
		expect(formatBreakdown(parts, 13, {isTotalValue: true})).toBe("Base 10, Dexterity +3 = 13");
		expect(formatBreakdown(parts, 13)).toBe("Base 10, Dexterity +3 = +13");
		expect(formatBreakdown([], null)).toBe("");
		expect(formatBreakdown(null, -2)).toBe("−2");
	});

	it("Explains an ability score from its recorded increases", () => {
		const state = getBaseState({
			abil_str: 17,
			abilityBonusLog: [
				{id: "a", source: "Dragonborn", bonuses: {str: 2}},
				{id: "b", source: "Ability Score Improvement", bonuses: {str: 2, con: 1}},
			],
		});
		const parts = getAbilityScoreParts(state, "str");
		expect(parts).toEqual([
			{label: "Base", value: 13, isRaw: true},
			{label: "Dragonborn", value: 2},
			{label: "Ability Score Improvement", value: 2},
		]);
	});

	it("Falls back to a plain base score with no recorded increases", () => {
		expect(getAbilityScoreParts(getBaseState({abil_str: 15}), "str"))
			.toEqual([{label: "Base", value: 15, isRaw: true}]);
	});
});

describe("Spellcasting presence", () => {
	it("Is false for a character with nothing spell-related", () => {
		expect(hasSpellcasting({spellsKnown: [], inventory: []})).toBe(false);
		expect(hasSpellcasting(null)).toBe(false);
		expect(hasSpellcasting({})).toBe(false);
	});

	it("Is true for a class caster, even before any spell is picked", () => {
		expect(hasSpellcasting({}, {isClassCaster: true})).toBe(true);
	});

	it("Is true once a spell arrives from a species, feat or by hand", () => {
		expect(hasSpellcasting({spellsKnown: [{name: "Fire Bolt"}]})).toBe(true);
		expect(hasSpellcasting({grantedSpellChoices: [{name: "Bless"}]})).toBe(true);
	});

	it("Is true for a spell-carrying magic item", () => {
		expect(hasSpellcasting({inventory: [{name: "Longsword"}]})).toBe(false);
		expect(hasSpellcasting({inventory: [{name: "Wand of Magic Missiles", grantsSpells: true}]})).toBe(true);
	});

	it("Is true once a spellcasting ability is set, or notes are written", () => {
		expect(hasSpellcasting({spellAbility: "int"})).toBe(true);
		expect(hasSpellcasting({spellsText: "  "})).toBe(false);
		expect(hasSpellcasting({spellsText: "Ritual: Find Familiar"})).toBe(true);
	});
});

describe("Derive: exhaustion", () => {
	// 2024 rules: each level of exhaustion takes 2 off every d20 test and 5 feet off speed
	const getExhausted = level => deriveCharacterSheet(getBaseState({
		level: 5,
		exhaustion: level,
		abil_str: 16,
		abil_dex: 14,
		abil_con: 14,
		save_con: true,
		skill_athletics: 1,
		skill_perception: 1,
		spellAbility: "int",
	}));

	it("Costs nothing at all while the character is rested", () => {
		const rested = getExhausted(0);
		expect(rested.exhaustion).toEqual({level: 0, penalty: 0, speedPenaltyFt: 0});
		expect(rested.saves.con.mod).toBe(5);
		expect(rested.skills.athletics.mod).toBe(6);
		expect(rested.initiative).toBe(2);
	});

	it("Takes 2 per level off saving throws, skills and ability checks", () => {
		const tired = getExhausted(2);
		expect(tired.exhaustion).toEqual({level: 2, penalty: -4, speedPenaltyFt: 10});
		expect(tired.saves.con.mod).toBe(1); // 5 − 4
		expect(tired.skills.athletics.mod).toBe(2); // 6 − 4
		expect(tired.abilities.str.checkMod).toBe(-1); // +3 − 4
	});

	it("Leaves the ability modifier itself alone, so nothing derived from it double-counts", () => {
		const tired = getExhausted(2);
		expect(tired.abilities.str.mod).toBe(3);
		expect(tired.abilities.str.score).toBe(16);
	});

	it("Takes it off attack rolls, both weapon and unarmed", () => {
		const state = getBaseState({level: 5, abil_str: 16, exhaustion: 1});
		expect(getUnarmedStrike(state).atkBonus).toBe(3 + 3 - 2);
		expect(getWeaponAttack(state, {name: "Longsword", dmg1: "1d8", dmgType: "S"}).atkBonus).toBe(3 + 3 - 2);
		// ... but not off the damage it deals
		expect(getWeaponAttack(state, {name: "Longsword", dmg1: "1d8", dmgType: "S"}).damage).toBe("1d8+3 slashing");
	});

	it("Takes it off spell attacks, but not off the spell save DC", () => {
		const tired = getExhausted(3);
		const rested = getExhausted(0);
		expect(tired.spell.dc).toBe(rested.spell.dc);
		expect(tired.spell.atkMod).toBe(rested.spell.atkMod - 6);
	});

	it("Drags down initiative and passive Perception, which are checks too", () => {
		const tired = getExhausted(1);
		expect(tired.initiative).toBe(0); // dex +2 − 2
		expect(tired.passivePerception).toBe(getExhausted(0).passivePerception - 2);
	});

	it("Says so in the breakdown", () => {
		expect(getExhausted(2).saves.con.parts.some(it => /Exhaustion 2/.test(it.label))).toBe(true);
		expect(getExhausted(0).saves.con.parts.some(it => /Exhaustion/.test(it.label))).toBe(false);
	});

	it("Stops at six, and ignores nonsense", () => {
		expect(getExhausted(9).exhaustion.penalty).toBe(-12);
		expect(deriveCharacterSheet(getBaseState({exhaustion: -3})).exhaustion.level).toBe(0);
		expect(deriveCharacterSheet(getBaseState({exhaustion: null})).exhaustion.level).toBe(0);
	});
});

describe("Derive: the concentration save after damage", () => {
	it("Is DC 10 for anything up to 20 damage", () => {
		expect(getConcentrationSaveDc(1)).toBe(10);
		expect(getConcentrationSaveDc(11)).toBe(10);
		expect(getConcentrationSaveDc(20)).toBe(10);
	});

	it("Is half the damage once that is higher", () => {
		expect(getConcentrationSaveDc(21)).toBe(10);
		expect(getConcentrationSaveDc(22)).toBe(11);
		expect(getConcentrationSaveDc(45)).toBe(22); // rounded down
	});

	it("Tolerates nonsense", () => {
		expect(getConcentrationSaveDc(0)).toBe(10);
		expect(getConcentrationSaveDc(null)).toBe(10);
	});
});

describe("Derive: every part names the rule behind it", () => {
	const citeOf = (parts, label) => parts.find(p => p.label === label)?.cite;

	it("Cites the ability rule, the proficiency rule, and the item itself on a save", () => {
		const cloak = {name: "Cloak of Protection", source: "DMG", equipped: true, bonusSavingThrow: 1};
		const state = getBaseState({level: 5, abil_dex: 16, save_dex: true, inventory: [cloak]});
		const {parts} = deriveCharacterSheet(state).saves.dex;
		expect(citeOf(parts, "Dexterity")).toBe("abilityModifier");
		expect(citeOf(parts, "Proficiency")).toBe("proficiency");
		// The magic bonus points at the thing granting it, not at a generic rule
		expect(citeOf(parts, "Magic items")).toEqual({name: "Cloak of Protection", source: "DMG", page: "items.html"});
	});

	it("Leaves a magic bonus uncited when two items share the credit", () => {
		const inv = [
			{name: "Cloak of Protection", source: "DMG", equipped: true, bonusSavingThrow: 1},
			{name: "Ring of Protection", source: "DMG", equipped: true, bonusSavingThrow: 1},
		];
		const {parts} = deriveCharacterSheet(getBaseState({inventory: inv})).saves.dex;
		expect(citeOf(parts, "Magic items")).toBeNull();
	});

	it("Cites the worn armour for its own AC, and the AC rule when unarmored", () => {
		const armor = {name: "Chain Mail", source: "PHB", equipped: true, isArmor: true, type: "HA", baseAc: 16};
		const worn = deriveArmorClass(getBaseState({inventory: [armor]}));
		expect(citeOf(worn.parts, "Chain Mail")).toEqual({name: "Chain Mail", source: "PHB", page: "items.html"});

		const bare = deriveArmorClass(getBaseState({abil_dex: 14}));
		expect(citeOf(bare.parts, "Unarmored")).toBe("armorClass");
		expect(citeOf(bare.parts, "Dexterity")).toBe("abilityModifier");
	});

	it("Cites the exhaustion condition wherever exhaustion is subtracted", () => {
		const derived = deriveCharacterSheet(getBaseState({exhaustion: 2, save_dex: true}));
		expect(citeOf(derived.saves.dex.parts, "Exhaustion 2")).toBe("exhaustion");
		expect(citeOf(derived.skills.stealth.parts, "Exhaustion 2")).toBe("exhaustion");
		expect(citeOf(derived.initiativeParts, "Exhaustion 2")).toBe("exhaustion");
	});

	it("Cites the fighting style, not the weapon, for the Archery bonus", () => {
		const item = {name: "Longbow", source: "PHB", type: "R", dmg1: "1d8"};
		const state = getBaseState({classes: [{optionalFeatures: [{name: "Archery"}]}]});
		const {atkParts} = getWeaponAttack(state, item);
		expect(citeOf(atkParts, "Archery (fighting style)"))
			.toEqual({name: "Archery", source: "PHB", page: "optionalfeatures.html"});
	});

	it("Leaves a part with no rule behind it uncited rather than inventing one", () => {
		const {initiativeParts} = deriveCharacterSheet(getBaseState({initMisc: 2}));
		expect(citeOf(initiativeParts, "Misc")).toBeUndefined();
	});
});

/*
 * A Belt of Giant Strength does not "give +5 Strength" — it says your Strength *is* 21, and does
 * nothing at all to somebody already stronger. The distinction is the whole of this family of
 * items, and a sheet that showed the raised number beside an unraised Athletics check would be
 * worse than one that ignored the belt entirely.
 */
describe("Character sheet derivation: what worn gear does to an ability score", () => {
	const withItem = (item, overrides = {}) => getBaseState({
		inventory: [{id: "i1", name: "Test Item", quantity: 1, equipped: true, ...item}],
		...overrides,
	});

	it("Should set a score to the item's number", () => {
		const state = withItem({requiresAttunement: true, attuned: true, ability: {static: {str: 21}}}, {abil_str: 8});
		expect(getAbilityScore(state, "str")).toBe(21);
		expect(deriveCharacterSheet(state).abilities.str.mod).toBe(5);
	});

	// "The item has no effect on you if your Strength is already equal to or greater than this"
	it("Should do nothing to a character already past it", () => {
		const state = withItem({requiresAttunement: true, attuned: true, ability: {static: {str: 19}}}, {abil_str: 20});
		expect(getAbilityScore(state, "str")).toBe(20);
		expect(getAbilityScoreParts(state, "str").some(it => /Test Item/.test(it.label))).toBe(false);
	});

	it("Should cap a flat increase at 20, as every one of them prints", () => {
		expect(getAbilityScore(withItem({ability: {con: 2}}, {abil_con: 14}), "con")).toBe(16);
		expect(getAbilityScore(withItem({ability: {con: 2}}, {abil_con: 19}), "con")).toBe(20);
	});

	// Both halves matter: a belt in the pack, and a belt worn but not attuned to
	it("Should count only what is worn, and attuned to when it asks", () => {
		expect(getAbilityScore(withItem({equipped: false, ability: {static: {str: 21}}}), "str")).toBe(10);
		expect(getAbilityScore(withItem({requiresAttunement: true, attuned: false, ability: {static: {str: 21}}}), "str")).toBe(10);
	});

	it("Should say where the number came from, and still add up", () => {
		const state = withItem({requiresAttunement: true, attuned: true, ability: {static: {int: 19}}}, {abil_int: 12});
		const parts = getAbilityScoreParts(state, "int");
		expect(formatBreakdown(parts, getAbilityScore(state, "int"), {isTotalValue: true}))
			.toBe("Base 12, Test Item (sets to 19) +7 = 19");
	});

	it("Should carry the effect through to everything read off the score", () => {
		const state = withItem(
			{requiresAttunement: true, attuned: true, ability: {static: {str: 21}}},
			{abil_str: 8, skill_athletics: 1, save_str: true, level: 1},
		);
		const d = deriveCharacterSheet(state);
		expect(d.skills.athletics.mod).toBe(7); // +5 Strength, +2 proficiency
		expect(d.saves.str.mod).toBe(7);
		expect(d.encumbrance.capacityLb).toBe(315); // 21 × 15, which is mostly what the belt is for
	});

	it("Should apply an increase before a floor, whichever order they are worn in", () => {
		const state = getBaseState({
			abil_str: 17,
			inventory: [
				{id: "i1", name: "Belt", quantity: 1, equipped: true, requiresAttunement: true, attuned: true, ability: {static: {str: 19}}},
				{id: "i2", name: "Stone", quantity: 1, equipped: true, ability: {str: 2}},
			],
		});
		// 17 + 2 = 19, and the belt's floor of 19 then adds nothing
		expect(getAbilityScore(state, "str")).toBe(19);
		expect(getItemAbilityEffects(state, "str").map(it => it.kind)).toEqual(["add", "set"]);
	});
});

/*
 * A Swashbuckler adds Charisma to Initiative, and a Bard half its proficiency. Both were in the
 * curated map and neither reached the number: the function that reads them was exported and called
 * by nothing, so `getFeatureInitiativeBonus` was dead code for as long as it existed.
 */
describe("Character sheet derivation: Initiative from features", () => {
	it("Should add a gained subclass feature's ability to Initiative, and name it", () => {
		const state = getBaseState({abil_dex: 14, abil_cha: 18, level: 3});
		const d = deriveCharacterSheet(state, {featureNames: ["Rakish Audacity"]});

		expect(d.initiative).toBe(6); // +2 Dexterity, +4 Charisma
		expect(formatBreakdown(d.initiativeParts, d.initiative)).toBe("Dexterity +2, Rakish Audacity +4 = +6");
	});

	it("Should add half proficiency for Jack of All Trades", () => {
		const state = getBaseState({abil_dex: 10, level: 5});
		expect(deriveCharacterSheet(state, {featureNames: ["Jack of All Trades"]}).initiative).toBe(1);
	});

	it("Should leave Initiative alone for a character with neither", () => {
		const state = getBaseState({abil_dex: 14});
		expect(deriveCharacterSheet(state, {featureNames: ["Extra Attack"]}).initiative).toBe(2);
	});
});
