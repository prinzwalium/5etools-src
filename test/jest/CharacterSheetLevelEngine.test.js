import * as fs from "fs";
import "../../js/parser.js";
import {HP_MODE_AVERAGE, HP_MODE_MAX, HP_MODE_ROLLED, checkFeatPrerequisites, getAsiCount, getCantripsKnown, getCasterLevelContribution, getClassResources, getDynamicSpellGrants, getExpertiseSkillCount, getFeatProgressionCounts, getFixedSpellsKnownGrants, getGrantedSpellUids, getInnateSpellCastingNote, getInnateSpellGrants, getHitDieAverage, getHitPointMaximum, getLevelUpHp, getMulticlassRequirementsDisplay, getOptionalFeatureCounts, getPactSlots, getPreparedSpellCount, getPreparedSpellsDisplay, getPrimaryAbilities, getResourceCostLabel, matchResourceLabel, getSingleClassSlots, getSpellGrantGroups, getSlotLevelUnlockLevel, getSpellbookSize, getSpellcastingMeta, getSpellsKnown, isMulticlassRequirementMet, isSpellMatchingFilter, parseSpellFilter} from "../../js/charactersheet/charactersheet-levelengine.js";

const loadClassFile = name => JSON.parse(fs.readFileSync(`./data/class/class-${name}.json`, "utf8"));

const getClass = (file, source = "PHB") => loadClassFile(file).class.find(it => it.source === source);
const getSubclass = (file, shortName, source = "PHB") => loadClassFile(file).subclass.find(it => it.shortName === shortName && it.source === source);

describe("Leveling engine: spell slots (PHB values)", () => {
	it("Should read a level 5 wizard's slots from the class table", () => {
		const wizard = getClass("wizard");
		expect(getSingleClassSlots(wizard, 5)).toEqual([4, 3, 2, 0, 0, 0, 0, 0, 0]);
		expect(getCantripsKnown(wizard, 5)).toBe(4);
	});

	it("Should read a level 11 cleric's slots and prepared formula", () => {
		const cleric = getClass("cleric");
		expect(getSingleClassSlots(cleric, 11)).toEqual([4, 3, 3, 3, 2, 1, 0, 0, 0]);
		expect(getPreparedSpellsDisplay(cleric)).toBe("class level + WIS modifier");
	});

	it("Should handle half casters natively via their own table (paladin level 1 has no slots)", () => {
		const paladin = getClass("paladin");
		expect(getSingleClassSlots(paladin, 1)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
		expect(getSingleClassSlots(paladin, 5)).toEqual([4, 2, 0, 0, 0, 0, 0, 0, 0]);
	});

	it("Should parse warlock pact slots from table columns", () => {
		const warlock = getClass("warlock");
		expect(getPactSlots(warlock, 5)).toEqual({count: 2, level: 3});
		expect(getPactSlots(warlock, 17)).toEqual({count: 4, level: 5});
		expect(getSpellsKnown(warlock, 5)).toBe(6);
	});

	it("Should read third-caster subclass tables (Eldritch Knight)", () => {
		const ek = getSubclass("fighter", "Eldritch Knight");
		expect(ek.casterProgression).toBe("1/3");
		expect(getSingleClassSlots(ek, 7)).toEqual([4, 2, 0, 0, 0, 0, 0, 0, 0]);
	});
});

describe("Leveling engine: multiclass slot stacking (PHB multiclass table)", () => {
	it("Should contribute caster levels per progression type", () => {
		expect(getCasterLevelContribution("full", 5)).toBe(5);
		expect(getCasterLevelContribution("1/2", 5)).toBe(2);
		expect(getCasterLevelContribution("1/3", 5)).toBe(1);
		expect(getCasterLevelContribution("artificer", 5)).toBe(3);
		expect(getCasterLevelContribution("pact", 5)).toBe(0);
		expect(getCasterLevelContribution(null, 5)).toBe(0);
	});

	it("Should give a Fighter 5 / Wizard 5 the wizard's own multiclass row (caster level 5)", () => {
		const fighter = getClass("fighter");
		const wizard = getClass("wizard");
		const meta = getSpellcastingMeta([
			{cls: fighter, sc: null, level: 5},
			{cls: wizard, sc: null, level: 5},
		]);
		expect(meta.casterLevel).toBe(5);
		expect(meta.slots).toEqual([4, 3, 2, 0, 0, 0, 0, 0, 0]);
		expect(meta.pact).toBeNull();
	});

	it("Should stack Cleric 5 / Wizard 5 to caster level 10", () => {
		const meta = getSpellcastingMeta([
			{cls: getClass("cleric"), sc: null, level: 5},
			{cls: getClass("wizard"), sc: null, level: 5},
		]);
		expect(meta.casterLevel).toBe(10);
		expect(meta.slots).toEqual([4, 3, 3, 3, 2, 0, 0, 0, 0]);
	});

	it("Should stack Paladin 5 / Wizard 5 to caster level 7 (half rounds down)", () => {
		const meta = getSpellcastingMeta([
			{cls: getClass("paladin"), sc: null, level: 5},
			{cls: getClass("wizard"), sc: null, level: 5},
		]);
		expect(meta.casterLevel).toBe(7);
		expect(meta.slots).toEqual([4, 3, 3, 1, 0, 0, 0, 0, 0]);
	});

	it("Should count an Eldritch Knight fighter as a third caster in a multiclass", () => {
		const meta = getSpellcastingMeta([
			{cls: getClass("fighter"), sc: getSubclass("fighter", "Eldritch Knight"), level: 6},
			{cls: getClass("wizard"), sc: null, level: 4},
		]);
		expect(meta.casterLevel).toBe(6); // floor(6/3) + 4
		expect(meta.slots).toEqual([4, 3, 3, 0, 0, 0, 0, 0, 0]);
	});

	it("Should keep pact slots separate from shared slots (Warlock 5 / Wizard 5)", () => {
		const meta = getSpellcastingMeta([
			{cls: getClass("warlock"), sc: null, level: 5},
			{cls: getClass("wizard"), sc: null, level: 5},
		]);
		expect(meta.casterLevel).toBe(5);
		expect(meta.slots).toEqual([4, 3, 2, 0, 0, 0, 0, 0, 0]); // wizard's own table
		expect(meta.pact).toEqual({count: 2, level: 3});
	});

	it("Should report no slots for non-casters", () => {
		const meta = getSpellcastingMeta([{cls: getClass("fighter"), sc: null, level: 5}]);
		expect(meta.slots).toBeNull();
		expect(meta.casterLevel).toBe(0);
	});
});

/**
 * `featProgression` — the field the 2024 classes moved two things into.
 *
 * A Fighting Style is a *feat* of category `FS` now, not an optional feature, and every class gains
 * an Epic Boon at 19. Reading only `optionalfeatureProgression` meant a 2024 Fighter was never once
 * asked for its Fighting Style.
 */
describe("Leveling engine: feats the class table grants", () => {
	it("Gives the 2024 Fighter its Fighting Style at level 1", () => {
		const progs = getFeatProgressionCounts(getClass("fighter", "XPHB"), 1);
		expect(progs.find(it => it.name === "Fighting Style")).toEqual({name: "Fighting Style", categories: ["FS"], count: 1});
	});

	it("And its Epic Boon only once level 19 arrives", () => {
		const fighter = getClass("fighter", "XPHB");
		expect(getFeatProgressionCounts(fighter, 18).find(it => it.name === "Epic Boon")).toBeUndefined();
		expect(getFeatProgressionCounts(fighter, 19).find(it => it.name === "Epic Boon").count).toBe(1);
	});

	it("Reads a Paladin's style at 2, not at 1", () => {
		const paladin = getClass("paladin", "XPHB");
		expect(getFeatProgressionCounts(paladin, 1).find(it => it.name === "Fighting Style")).toBeUndefined();
		const at2 = getFeatProgressionCounts(paladin, 2).find(it => it.name === "Fighting Style");
		// The category list narrows the pool: a Paladin's style, not any style
		expect(at2.categories).toEqual(["FS", "FS:P"]);
	});

	it("Reads a subclass's own grant (Champion's extra style at 7)", () => {
		const champion = getSubclass("fighter", "Champion", "XPHB");
		expect(getFeatProgressionCounts(champion, 6)).toEqual([]);
		expect(getFeatProgressionCounts(champion, 7)[0].name).toBe("Fighting Style");
	});

	it("Says nothing for a class with no such grants", () => {
		expect(getFeatProgressionCounts(getClass("fighter"), 20)).toEqual([]);
		expect(getFeatProgressionCounts(null, 5)).toEqual([]);
	});
});

/**
 * The 2024 prepared casters replaced the formula with an exact by-level table. Reading only the
 * formula left every one of them with no prepared limit at all.
 */
describe("Leveling engine: prepared spells, both editions", () => {
	it("Still reads the 2014 formula", () => {
		expect(getPreparedSpellCount(getClass("cleric"), 5, 3)).toBe(8);
	});

	it("Reads the 2024 table, which does not depend on the ability modifier", () => {
		const cleric = getClass("cleric", "XPHB");
		expect(getPreparedSpellCount(cleric, 1, 0)).toBe(4);
		expect(getPreparedSpellCount(cleric, 5, 99)).toBe(9);
		expect(getPreparedSpellCount(cleric, 20, 0)).toBe(22);
	});

	it("Describes the 2024 allowance as the number it is", () => {
		expect(getPreparedSpellsDisplay(getClass("wizard", "XPHB"), 3)).toBe("6 (class table)");
	});

	it("Says nothing for a class that does not prepare", () => {
		expect(getPreparedSpellCount(getClass("fighter"), 5)).toBeNull();
	});
});

describe("Leveling engine: optional feature progression", () => {
	it("Should surface the fighter's Fighting Style at level 1", () => {
		const counts = getOptionalFeatureCounts(getClass("fighter"), 1);
		expect(counts).toEqual([{name: "Fighting Style", featureTypes: ["FS:F"], count: 1}]);
	});

	it("Should read warlock invocations from an array progression", () => {
		const warlock = getClass("warlock");
		const at5 = getOptionalFeatureCounts(warlock, 5);
		expect(at5.find(it => it.name === "Eldritch Invocations").count).toBe(3);
		expect(at5.find(it => it.name === "Pact Boon").count).toBe(1);
		const at1 = getOptionalFeatureCounts(warlock, 1);
		expect(at1.find(it => it.name === "Eldritch Invocations")).toBeUndefined();
	});

	it("Should read Battle Master maneuvers from an object progression", () => {
		const bm = getSubclass("fighter", "Battle Master");
		expect(getOptionalFeatureCounts(bm, 3)[0].count).toBe(3);
		expect(getOptionalFeatureCounts(bm, 10)[0].count).toBe(7);
		expect(getOptionalFeatureCounts(bm, 2)).toEqual([]);
	});
});

describe("Leveling engine: ASI slots", () => {
	it("Should count Ability Score Improvement features by level (dereferenced shape)", () => {
		// Fighter-style: ASIs at 4 and 6
		const cls = {
			classFeatures: [
				[{name: "Second Wind"}],
				[{name: "Action Surge"}],
				[{name: "Martial Archetype"}],
				[{name: "Ability Score Improvement"}],
				[{name: "Extra Attack"}],
				[{name: "Ability Score Improvement"}],
			],
		};
		expect(getAsiCount(cls, 3)).toBe(0);
		expect(getAsiCount(cls, 4)).toBe(1);
		expect(getAsiCount(cls, 6)).toBe(2);
	});
});

describe("Leveling engine: expertise grants", () => {
	it("Should count Expertise features (two picks each) by level", () => {
		// Rogue-style: Expertise at 1 and 6
		const cls = {
			classFeatures: [
				[{name: "Expertise"}, {name: "Sneak Attack"}],
				[{name: "Cunning Action"}],
				[{name: "Roguish Archetype"}],
				[{name: "Ability Score Improvement"}],
				[{name: "Uncanny Dodge"}],
				[{name: "Expertise"}],
			],
		};
		expect(getExpertiseSkillCount(cls, 1)).toBe(2);
		expect(getExpertiseSkillCount(cls, 5)).toBe(2);
		expect(getExpertiseSkillCount(cls, 6)).toBe(4);
	});

	it("Should return 0 for classes without Expertise", () => {
		const cls = {classFeatures: [[{name: "Second Wind"}], [{name: "Action Surge"}]]};
		expect(getExpertiseSkillCount(cls, 20)).toBe(0);
		expect(getExpertiseSkillCount(null, 5)).toBe(0);
	});
});

describe("Leveling engine: granted spells (additionalSpells)", () => {
	it("Should collect prepared/known/expanded uids up to the class level, skipping later levels and non-uids", () => {
		const sc = {additionalSpells: [{
			prepared: {"1": ["bless", "cure wounds"], "3": ["spiritual weapon"], "5": ["revivify"]},
			expanded: {"1": [{choose: "level=0;1"}]}, // dynamic → skipped
		}]};
		expect(getGrantedSpellUids(sc, 3).sort()).toEqual(["bless", "cure wounds", "spiritual weapon"].sort());
		expect(getGrantedSpellUids(sc, 5)).toContain("revivify");
	});

	it("Should skip spell-slot-keyed (s6) entries and return [] with no additionalSpells", () => {
		const sc = {additionalSpells: [{known: {"s6": ["wish|xphb"]}}]};
		expect(getGrantedSpellUids(sc, 20)).toEqual([]);
		expect(getGrantedSpellUids({}, 5)).toEqual([]);
	});
});

describe("Leveling engine: dynamic spell grants", () => {
	it("Should parse filter strings into levels and classes", () => {
		expect(parseSpellFilter("level=0;1;2")).toEqual({levels: [0, 1, 2], classes: [], schools: []});
		expect(parseSpellFilter("level=6|class=Cleric;Druid")).toEqual({levels: [6], classes: ["cleric", "druid"], schools: []});
		expect(parseSpellFilter("")).toEqual({levels: [], classes: [], schools: []});
		expect(parseSpellFilter(null)).toEqual({levels: [], classes: [], schools: []});
	});

	it("Should match spells against a parsed filter", () => {
		const filter = parseSpellFilter("level=1;2|class=Wizard");
		expect(isSpellMatchingFilter({level: 1, _csClassNames: ["Wizard"]}, filter)).toBe(true);
		expect(isSpellMatchingFilter({level: 3, _csClassNames: ["Wizard"]}, filter)).toBe(false); // wrong level
		expect(isSpellMatchingFilter({level: 1, _csClassNames: ["Cleric"]}, filter)).toBe(false); // wrong class
		// Empty criteria match everything
		expect(isSpellMatchingFilter({level: 9, _csClassNames: []}, parseSpellFilter(""))).toBe(true);
		expect(isSpellMatchingFilter(null, filter)).toBe(false);
	});

	it("Should extract {choose} grants as picks, up to the class level", () => {
		const sc = {additionalSpells: [{
			prepared: {"3": [{choose: "level=0;1|class=Wizard"}], "9": [{choose: "level=5"}]},
		}]};
		const at3 = getDynamicSpellGrants(sc, 3);
		expect(at3).toHaveLength(1);
		expect(at3[0]).toMatchObject({type: "choose", bucket: "prepared", atLevel: 3, count: 1});
		expect(at3[0].filter).toEqual({levels: [0, 1], classes: ["wizard"], schools: []});
		// The level-9 grant only appears once the character is high enough
		expect(getDynamicSpellGrants(sc, 9)).toHaveLength(2);
	});

	it("Should honour an explicit `from` list and a count", () => {
		const sc = {additionalSpells: [{innate: {"3": [{choose: {from: ["minor illusion|xphb#c", "blade ward|xphb#c"], count: 2}}]}}]};
		const [grant] = getDynamicSpellGrants(sc, 3);
		expect(grant).toMatchObject({type: "choose", count: 2, filter: null});
		expect(grant.from).toEqual(["minor illusion|xphb", "blade ward|xphb"]); // `#c` suffix stripped
	});

	it("Should report {all} grants as pool-widening, never as picks", () => {
		// A Bard's Magical Secrets: hundreds of spells become learnable — they must not be auto-granted
		const cls = {additionalSpells: [{expanded: {"10": [{all: "level=1;2|class=Cleric;Druid;Wizard"}]}}]};
		const [grant] = getDynamicSpellGrants(cls, 10);
		expect(grant).toMatchObject({type: "expanded", bucket: "expanded", count: 0});
		expect(grant.filter).toEqual({levels: [1, 2], classes: ["cleric", "druid", "wizard"], schools: []});
		// ...and they stay out of the auto-granted uid list
		expect(getGrantedSpellUids(cls, 10)).toEqual([]);
	});

	it("Should unwrap `_` and innate frequency wrappers, and ignore plain uids", () => {
		const sc = {additionalSpells: [{
			known: {"1": {_: [{choose: "level=0|class=Druid"}]}},
			innate: {"3": {daily: {"1e": [{choose: "level=2"}]}}},
			prepared: {"1": ["bless"]}, // plain uid → not a dynamic grant
		}]};
		const grants = getDynamicSpellGrants(sc, 3);
		expect(grants).toHaveLength(2);
		expect(grants.every(g => g.type === "choose")).toBe(true);
	});

	it("Should return [] with no additionalSpells", () => {
		expect(getDynamicSpellGrants({}, 5)).toEqual([]);
		expect(getDynamicSpellGrants(null, 5)).toEqual([]);
	});

	it("Should treat the `_` level key as always-granted (feats have no class level)", () => {
		const feat = {additionalSpells: [{known: {_: [{choose: "level=0|class=Bard", count: 2}]}}]};
		const grants = getDynamicSpellGrants(feat, 1);
		expect(grants).toHaveLength(1);
		expect(grants[0]).toMatchObject({type: "choose", atLevel: 0, count: 2});
	});

	it("Should parse school criteria", () => {
		const filter = parseSpellFilter("level=2|school=E;N");
		expect(filter.schools).toEqual(["E", "N"]);
		expect(isSpellMatchingFilter({level: 2, school: "E"}, filter)).toBe(true);
		expect(isSpellMatchingFilter({level: 2, school: "A"}, filter)).toBe(false);
	});

	it("Should expose named alternative groups (Magic Initiate's spell lists)", () => {
		const feat = JSON.parse(fs.readFileSync("./data/feats.json", "utf8")).feat
			.find(f => f.name === "Magic Initiate" && f.source === "XPHB");
		const groups = getSpellGrantGroups(feat);
		expect(groups.map(g => g.name)).toEqual(["Cleric Spells", "Druid Spells", "Wizard Spells"]);

		// Each group offers its own picks: 2 cantrips (known) + 1 first-level spell (innate)
		const wizardGrants = getDynamicSpellGrants(feat, 20).filter(g => g.groupIndex === 2 && g.type === "choose");
		expect(wizardGrants.find(g => g.bucket === "known")).toMatchObject({count: 2});
		expect(wizardGrants.find(g => g.bucket === "known").filter).toEqual({levels: [0], classes: ["wizard"], schools: []});
		expect(wizardGrants.find(g => g.bucket === "innate").filter).toEqual({levels: [1], classes: ["wizard"], schools: []});
	});

	it("Should report no alternative groups when there is nothing to choose between", () => {
		expect(getSpellGrantGroups({additionalSpells: [{known: {_: ["bless"]}}]})).toEqual([]);
		expect(getSpellGrantGroups(null)).toEqual([]);
	});
});

describe("Leveling engine: class resources (table columns)", () => {
	/*
	 * A class table's columns are three different things wearing one shape, and each is read
	 * differently: something spent (Rages), something the character simply has (Sneak Attack 2d6),
	 * and a count of choices made elsewhere (Weapon Mastery, Invocations). Reading them as one put
	 * Eldritch Invocations in the sheet's resource tracker as though a Warlock could spend them.
	 */
	it("Should tell a use from a value, and leave counts of choices out", () => {
		const cls = {
			classTableGroups: [
				{colLabels: ["Rages", "Rage Damage", "Weapon Mastery"],
					rows: [
						["2", {type: "bonus", value: 2}, "2"],
						["3", {type: "bonus", value: 2}, "3"],
					]},
				{colLabels: ["Sneak Attack"],
					rows: [
						[{type: "dice", toRoll: [{number: 1, faces: 6}]}],
						[{type: "dice", toRoll: [{number: 2, faces: 6}]}],
					]},
				{colLabels: ["Cantrips Known", "1st"], rowsSpellProgression: [[3, 2], [3, 3]]}, // spell cols: ignored
			],
		};
		expect(getClassResources(cls, 2)).toEqual([
			{label: "Rages", value: "3", kind: "uses", rest: "long"},
			{label: "Rage Damage", value: "+2", kind: "value", rest: null},
			{label: "Sneak Attack", value: "2d6", kind: "value", rest: null},
		]);
	});

	it("Should not offer Eldritch Invocations as something to spend", () => {
		const cls = {
			classTableGroups: [
				{colLabels: ["{@filter Invocations|optionalfeatures|feature type=ei}", "Spell Slots"], rows: [["2", "2"]]},
			],
		};
		expect(getClassResources(cls, 1)).toEqual([]);
	});

	// Which rest gives it back is curated, because the class tables do not carry it
	it("Should say which rest returns a use", () => {
		const cls = {classTableGroups: [{colLabels: ["Second Wind", "Sorcery Points"], rows: [["2", "4"]]}]};
		expect(getClassResources(cls, 1)).toEqual([
			{label: "Second Wind", value: "2", kind: "uses", rest: "short"},
			{label: "Sorcery Points", value: "4", kind: "uses", rest: "long"},
		]);
	});

	it("Should drop empty cells (0 / blank / 0-speed)", () => {
		const cls = {classTableGroups: [{colLabels: ["Focus Points", "Unarmored Movement"], rows: [[0, {type: "bonusSpeed", value: 0}]]}]};
		expect(getClassResources(cls, 1)).toEqual([]);
	});

	it("Should return [] for a class without table groups", () => {
		expect(getClassResources({}, 5)).toEqual([]);
	});
});

describe("Leveling engine: prepared spell count", () => {
	it("Should evaluate a full caster's prepared formula (level + mod)", () => {
		const cls = {preparedSpells: "<$level$> + <$wis_mod$>"};
		expect(getPreparedSpellCount(cls, 5, 3)).toBe(8);
		expect(getPreparedSpellCount(cls, 1, 0)).toBe(1); // floor of 1
	});

	it("Should evaluate a half caster's prepared formula (half level round up + mod)", () => {
		const cls = {preparedSpells: "<$level_half_round_up$> + <$cha_mod$>"};
		expect(getPreparedSpellCount(cls, 5, 2)).toBe(5); // ceil(5/2)=3 +2
	});

	it("Should return null for non-preparing classes", () => {
		expect(getPreparedSpellCount({spellsKnownProgression: []}, 5, 3)).toBeNull();
		expect(getPreparedSpellCount(null, 5, 3)).toBeNull();
	});
});

describe("Leveling engine: multiclass requirements", () => {
	it("Should treat or-group keys as alternatives (Fighter: Str 13 or Dex 13)", () => {
		const req = getClass("fighter").multiclassing.requirements;
		expect(isMulticlassRequirementMet(req, {str: 13, dex: 8})).toBe(true);
		expect(isMulticlassRequirementMet(req, {str: 8, dex: 13})).toBe(true);
		expect(isMulticlassRequirementMet(req, {str: 8, dex: 8})).toBe(false);
		expect(getMulticlassRequirementsDisplay(req)).toBe("Strength 13 or Dexterity 13");
	});

	it("Should require all top-level keys (Paladin: Str 13 and Cha 13)", () => {
		const req = getClass("paladin").multiclassing.requirements;
		expect(isMulticlassRequirementMet(req, {str: 13, cha: 13})).toBe(true);
		expect(isMulticlassRequirementMet(req, {str: 13, cha: 8})).toBe(false);
	});
});

describe("Leveling engine: feat prerequisites", () => {
	const ctx = ({
		abilityScores = {}, totalLevel = 1, classes = [], raceNames = [], backgroundName = null,
		featNames = [], featCategories = [], featureNames = [],
		proficiencies = {armor: [], weapon: []}, isSpellcaster = false,
	} = {}) => ({
		abilityScores,
		totalLevel,
		classes,
		raceNames,
		backgroundName,
		featNames,
		featCategories,
		featureNames,
		proficiencies,
		isSpellcaster,
	});

	it("Should pass when there are no prerequisites", () => {
		expect(checkFeatPrerequisites(undefined, ctx()).status).toBe("met");
		expect(checkFeatPrerequisites([], ctx()).status).toBe("met");
	});

	it("Should check ability prerequisites as alternatives across sets (Ritual Caster: Int 13 or Wis 13)", () => {
		const pre = [{ability: [{int: 13}, {wis: 13}]}];
		expect(checkFeatPrerequisites(pre, ctx({abilityScores: {int: 14, wis: 8}})).status).toBe("met");
		expect(checkFeatPrerequisites(pre, ctx({abilityScores: {int: 8, wis: 15}})).status).toBe("met");
		expect(checkFeatPrerequisites(pre, ctx({abilityScores: {int: 10, wis: 10}})).status).toBe("unmet");
	});

	it("Should check a fixed ability requirement (Actor: Cha 13)", () => {
		const pre = [{ability: [{cha: 13}]}];
		expect(checkFeatPrerequisites(pre, ctx({abilityScores: {cha: 13}})).status).toBe("met");
		expect(checkFeatPrerequisites(pre, ctx({abilityScores: {cha: 12}})).status).toBe("unmet");
	});

	it("Should treat top-level prerequisite entries as alternatives", () => {
		const pre = [{ability: [{str: 13}]}, {ability: [{dex: 13}]}];
		expect(checkFeatPrerequisites(pre, ctx({abilityScores: {str: 8, dex: 15}})).status).toBe("met");
		expect(checkFeatPrerequisites(pre, ctx({abilityScores: {str: 8, dex: 8}})).status).toBe("unmet");
	});

	it("Should require all keys within one entry (level and ability)", () => {
		const pre = [{level: 4, ability: [{con: 13}]}];
		expect(checkFeatPrerequisites(pre, ctx({totalLevel: 4, abilityScores: {con: 13}})).status).toBe("met");
		expect(checkFeatPrerequisites(pre, ctx({totalLevel: 3, abilityScores: {con: 13}})).status).toBe("unmet");
		expect(checkFeatPrerequisites(pre, ctx({totalLevel: 4, abilityScores: {con: 10}})).status).toBe("unmet");
	});

	it("Should check class-level requirements against the matching class", () => {
		const pre = [{level: {level: 1, class: {name: "Wizard"}}}];
		expect(checkFeatPrerequisites(pre, ctx({classes: [{name: "Wizard", level: 1}]})).status).toBe("met");
		expect(checkFeatPrerequisites(pre, ctx({classes: [{name: "Fighter", level: 5}]})).status).toBe("unmet");
	});

	it("Should check race prerequisites (Bountiful Luck: halfling)", () => {
		const pre = [{race: [{name: "halfling"}]}];
		expect(checkFeatPrerequisites(pre, ctx({raceNames: ["Lightfoot Halfling", "lightfoot", "halfling"]})).status).toBe("met");
		expect(checkFeatPrerequisites(pre, ctx({raceNames: ["elf"]})).status).toBe("unmet");
	});

	it("Should check spellcasting prerequisites", () => {
		const pre = [{spellcasting: true}];
		expect(checkFeatPrerequisites(pre, ctx({isSpellcaster: true})).status).toBe("met");
		expect(checkFeatPrerequisites(pre, ctx({isSpellcaster: false})).status).toBe("unmet");
	});

	it("Should check taken-feat prerequisites by name segment", () => {
		const pre = [{feat: ["initiate of high sorcery|dsotdq|initiate of high sorcery (nuitari)"]}];
		expect(checkFeatPrerequisites(pre, ctx({featNames: ["Initiate of High Sorcery"]})).status).toBe("met");
		expect(checkFeatPrerequisites(pre, ctx({featNames: ["Alert"]})).status).toBe("unmet");
	});

	it("Should return unknown when only unverifiable clauses remain", () => {
		expect(checkFeatPrerequisites([{campaign: ["Ravenloft"]}], ctx()).status).toBe("unknown");
		expect(checkFeatPrerequisites([{other: "No other dragonmark"}], ctx()).status).toBe("unknown");
		// A satisfiable checkable clause plus an unknown one → unknown (don't falsely block)
		expect(checkFeatPrerequisites([{ability: [{str: 13}], campaign: ["Eberron"]}], ctx({abilityScores: {str: 15}})).status).toBe("unknown");
	});

	/*
	 * Three prerequisites that used to report "unknown" for want of anything to check them against.
	 * Twelve feats ask for a proficiency, eleven for a class feature, and fourteen for a feat
	 * category — the dragonmark rules, which are the only place either category key is used.
	 */
	describe("the ones that were unverifiable", () => {
		it("Checks a proficiency the character now structurally has", () => {
			const pre = [{proficiency: [{armor: "medium"}]}];
			expect(checkFeatPrerequisites(pre, ctx({proficiencies: {armor: ["Medium"], weapon: []}})).status).toBe("met");
			expect(checkFeatPrerequisites(pre, ctx({proficiencies: {armor: ["Light"], weapon: []}})).status).toBe("unmet");
		});

		it("Reads the two spellings of a weapon proficiency alike", () => {
			const held = ctx({proficiencies: {armor: [], weapon: ["Martial"]}});
			expect(checkFeatPrerequisites([{proficiency: [{weapon: "martial"}]}], held).status).toBe("met");
			expect(checkFeatPrerequisites([{proficiency: [{weaponGroup: "martial"}]}], held).status).toBe("met");
		});

		it("Copes with the plural and the spelled-out forms", () => {
			// A class writes "shield", a species "shields", and the store title-cases both
			expect(checkFeatPrerequisites([{proficiency: [{armor: "shield"}]}], ctx({proficiencies: {armor: ["Shields"], weapon: []}})).status).toBe("met");
			expect(checkFeatPrerequisites([{proficiency: [{armor: "heavy"}]}], ctx({proficiencies: {armor: ["Heavy Armor"], weapon: []}})).status).toBe("met");
		});

		it("Checks a class feature by name, taking any of the alternatives", () => {
			const pre = [{feature: ["Spellcasting", "Pact Magic"]}];
			expect(checkFeatPrerequisites(pre, ctx({featureNames: ["Pact Magic", "Eldritch Invocations"]})).status).toBe("met");
			expect(checkFeatPrerequisites(pre, ctx({featureNames: ["Second Wind"]})).status).toBe("unmet");
			expect(checkFeatPrerequisites([{feature: ["Fighting Style"]}], ctx({featureNames: ["Fighting Style"]})).status).toBe("met");
		});

		it("Requires a feat of the named category", () => {
			const pre = [{featCategory: ["D"]}];
			expect(checkFeatPrerequisites(pre, ctx({featCategories: ["D"]})).status).toBe("met");
			expect(checkFeatPrerequisites(pre, ctx({featCategories: ["O"]})).status).toBe("unmet");
			expect(checkFeatPrerequisites(pre, ctx()).status).toBe("unmet");
		});

		it("Counts them when the requirement says how many", () => {
			const pre = [{featCategory: [{category: "EB", count: 2}]}];
			expect(checkFeatPrerequisites(pre, ctx({featCategories: ["EB", "EB"]})).status).toBe("met");
			expect(checkFeatPrerequisites(pre, ctx({featCategories: ["EB"]})).status).toBe("unmet");
		});

		it("Forbids a second feat of an exclusive category", () => {
			// One dragonmark, and only one
			const pre = [{exclusiveFeatCategory: ["D"]}];
			expect(checkFeatPrerequisites(pre, ctx()).status).toBe("met");
			expect(checkFeatPrerequisites(pre, ctx({featCategories: ["O"]})).status).toBe("met");
			expect(checkFeatPrerequisites(pre, ctx({featCategories: ["D"]})).status).toBe("unmet");
		});
	});
});

describe("Leveling engine: hit points", () => {
	it("Should give the 5e fixed average per hit die", () => {
		expect(getHitDieAverage(6)).toBe(4);
		expect(getHitDieAverage(8)).toBe(5);
		expect(getHitDieAverage(10)).toBe(6);
		expect(getHitDieAverage(12)).toBe(7);
	});

	it("Should sum average HP across levels with Constitution", () => {
		expect(getLevelUpHp({faces: 10, conMod: 2, numLevels: 1}).total).toBe(8); // 6 + 2
		expect(getLevelUpHp({faces: 10, conMod: 2, numLevels: 3}).total).toBe(24); // 3 × 8
		expect(getLevelUpHp({faces: 8, conMod: 0, numLevels: 2}).total).toBe(10); // 2 × 5
	});

	it("Should floor each level at 1 HP even with a big negative Con", () => {
		const {total, perLevel} = getLevelUpHp({faces: 6, conMod: -5, numLevels: 2});
		expect(perLevel).toEqual([1, 1]);
		expect(total).toBe(2);
	});

	it("Should roll per level when given a roll function", () => {
		const {total, perLevel} = getLevelUpHp({faces: 10, conMod: 1, numLevels: 2, fnRoll: () => 7});
		expect(perLevel).toEqual([8, 8]);
		expect(total).toBe(16);
	});
});

describe("Leveling engine: the ability a class leans on", () => {
	const loadClass = (file, source) => JSON.parse(fs.readFileSync(`./data/class/class-${file}.json`, "utf8"))
		.class.find(it => it.source === source);

	it("Reads it off the class, as an abbreviation", () => {
		expect(getPrimaryAbilities(loadClass("barbarian", "XPHB"))).toEqual(["str"]);
		expect(getPrimaryAbilities(loadClass("cleric", "XPHB"))).toEqual(["wis"]);
	});

	it("Returns both when a class names two", () => {
		// A few name two; the guide says both rather than picking one for the player
		const both = getPrimaryAbilities({primaryAbility: [{dex: true}, {wis: true}]});
		expect(both).toEqual(["dex", "wis"]);
	});

	it("Ignores a false entry rather than counting the key", () => {
		expect(getPrimaryAbilities({primaryAbility: [{str: true, cha: false}]})).toEqual(["str"]);
	});

	it("Says nothing when the class does not", () => {
		expect(getPrimaryAbilities({})).toEqual([]);
		expect(getPrimaryAbilities(null)).toEqual([]);
	});
});

/*
 * How a table decides hit points is a table's decision — maximum dice, the fixed average, or roll
 * and live with it — and the *bonuses* are the same either way. Keeping them in one function is the
 * point: Constitution is per level, so is Tough, and a total typed into a box is a fossil the
 * moment either changes.
 */
describe("Leveling engine: the hit point maximum, three ways", () => {
	const FIGHTER_5 = [{name: "Fighter", level: 5, hdFaces: 10}];

	it("Should take the average: maximum at 1st level, the die's average after", () => {
		// 10 + 4×6 = 34, and +2 Constitution across five levels
		expect(getHitPointMaximum({classes: FIGHTER_5, conMod: 2, mode: HP_MODE_AVERAGE}).total).toBe(44);
	});

	it("Should take every die at its maximum", () => {
		// 5×10 = 50, and +2 Constitution across five levels
		expect(getHitPointMaximum({classes: FIGHTER_5, conMod: 2, mode: HP_MODE_MAX}).total).toBe(60);
	});

	it("Should take the dice as they came up", () => {
		const hp = getHitPointMaximum({classes: FIGHTER_5, conMod: 2, mode: HP_MODE_ROLLED, rolled: 31});
		expect(hp.total).toBe(41);
		expect(hp.explanation).toMatch(/31 rolled/);
	});

	// The bug this exists to stop: a per-level feature counted in one mode and forgotten in the others
	it("Should add a per-level feature bonus in every mode", () => {
		const opts = {classes: FIGHTER_5, conMod: 2, perLevelBonus: 2};
		expect(getHitPointMaximum({...opts, mode: HP_MODE_AVERAGE}).total).toBe(54);
		expect(getHitPointMaximum({...opts, mode: HP_MODE_MAX}).total).toBe(70);
		expect(getHitPointMaximum({...opts, mode: HP_MODE_ROLLED, rolled: 31}).total).toBe(51);
	});

	it("Should count each class's own dice when multiclassed", () => {
		const classes = [{name: "Rogue", level: 4, hdFaces: 8}, {name: "Warlock", level: 3, hdFaces: 8}];
		expect(getHitPointMaximum({classes, conMod: 0, mode: HP_MODE_MAX}).total).toBe(56);
	});

	it("Should never go below one hit point", () => {
		expect(getHitPointMaximum({classes: [{name: "Wizard", level: 1, hdFaces: 6}], conMod: -5, mode: HP_MODE_AVERAGE}).total).toBe(1);
	});
});

/*
 * The Warlock's Mystic Arcanum. It sits in `spellsKnownProgressionFixedByLevel` rather than in the
 * ordinary known-spell progression, because a pact caster's slots stop at 5th level and these four
 * spells are cast at their own level, once per long rest. Nothing read the field, so a Warlock 11+
 * had none of them.
 */
describe("fixed-level spells known", () => {
	const WARLOCK = {
		name: "Warlock",
		spellsKnownProgressionFixedByLevel: {"11": {"6": 1}, "13": {"7": 1}, "15": {"8": 1}, "17": {"9": 1}},
		classFeatures: [],
	};
	WARLOCK.classFeatures[10] = [{name: "Mystic Arcanum (6th Level)"}];
	WARLOCK.classFeatures[12] = [{name: "Mystic Arcanum (7th Level)"}];

	it("Grants nothing before 11th level", () => {
		expect(getFixedSpellsKnownGrants(WARLOCK, 10)).toEqual([]);
	});

	it("Grants one 6th-level spell at 11", () => {
		const grants = getFixedSpellsKnownGrants(WARLOCK, 11);
		expect(grants).toHaveLength(1);
		expect(grants[0]).toMatchObject({type: "choose", count: 1, spellLevel: 6, atLevel: 11});
	});

	it("Restricts the pick to that spell level and that class", () => {
		const [grant] = getFixedSpellsKnownGrants(WARLOCK, 11);
		expect(grant.filter).toEqual({levels: [6], classes: ["warlock"], schools: []});
	});

	it("Names the grant after the feature that gives it", () => {
		expect(getFixedSpellsKnownGrants(WARLOCK, 11)[0].groupName).toBe("Mystic Arcanum (6th Level)");
	});

	it("Accumulates one per level up the ladder", () => {
		expect(getFixedSpellsKnownGrants(WARLOCK, 20).map(it => it.spellLevel)).toEqual([6, 7, 8, 9]);
	});

	it("Ignores an ASI when naming, and copes with an unnamed level", () => {
		const cls = {...WARLOCK, classFeatures: [...WARLOCK.classFeatures]};
		cls.classFeatures[14] = [{name: "Ability Score Improvement"}];
		expect(getFixedSpellsKnownGrants(cls, 15).find(it => it.spellLevel === 8).groupName).toBeNull();
	});

	it("Says nothing for a class without the field", () => {
		expect(getFixedSpellsKnownGrants({name: "Fighter"}, 20)).toEqual([]);
		expect(getFixedSpellsKnownGrants(null, 20)).toEqual([]);
	});
});

/*
 * `additionalSpells.innate` wraps its lists in a frequency — `ritual`, `daily`, `rest`, `resource` —
 * and the plain-uid reader could only see strings, so everything inside a wrapper was dropped. That
 * cost thirteen subclasses their innate spells; the `resource` ones were the worst, because those
 * are cast with a class resource rather than a slot and the cost is the point.
 */
describe("innate spell grants", () => {
	const WAY_OF_SHADOW = {
		name: "Shadow",
		additionalSpells: [{
			known: {"3": ["minor illusion#c"]},
			innate: {"3": {"resource": {"2": ["darkness", "darkvision", "pass without trace", "silence"]}}},
			resourceName: "Ki",
			ability: "wis",
		}],
	};

	it("Finds the spells a plain-uid read cannot see", () => {
		expect(getGrantedSpellUids(WAY_OF_SHADOW, 3)).toEqual(["minor illusion"]);
		expect(getInnateSpellGrants(WAY_OF_SHADOW, 3).map(it => it.uid))
			.toEqual(["darkness", "darkvision", "pass without trace", "silence"]);
	});

	it("Reads what casting one costs, and out of which pool", () => {
		const [grant] = getInnateSpellGrants(WAY_OF_SHADOW, 3);
		expect(grant).toMatchObject({frequency: "resource", amount: 2, resourceName: "Ki"});
		expect(getInnateSpellCastingNote(grant)).toBe("costs 2 Ki Points");
	});

	it("Holds them back until the level that grants them", () => {
		expect(getInnateSpellGrants(WAY_OF_SHADOW, 2)).toEqual([]);
	});

	it("Reads a ritual-only grant", () => {
		const totem = {additionalSpells: [{innate: {"3": {"ritual": ["beast sense", "speak with animals"]}}}]};
		const grants = getInnateSpellGrants(totem, 3);
		expect(grants.map(it => it.uid)).toEqual(["beast sense", "speak with animals"]);
		expect(getInnateSpellCastingNote(grants[0])).toBe("as a ritual only");
	});

	it("Reads a once-a-day grant", () => {
		const psiWarrior = {additionalSpells: [{innate: {"18": {"daily": {"1": ["telekinesis"]}}}}]};
		expect(getInnateSpellCastingNote(getInnateSpellGrants(psiWarrior, 18)[0])).toBe("one time per long rest");
	});

	it("Reads a grant counted by an ability modifier", () => {
		const archfey = {additionalSpells: [{innate: {"_": {"daily": {"cha": ["misty step|xphb"]}}}}]};
		const [grant] = getInnateSpellGrants(archfey, 1);
		expect(grant).toMatchObject({uid: "misty step|xphb", atLevel: 0, amountAbility: "cha"});
		expect(getInnateSpellCastingNote(grant)).toBe("a number of times equal to your Charisma modifier per long rest");
	});

	it("Reads a per-rest grant", () => {
		const phantom = {additionalSpells: [{innate: {"9": {"rest": {"1": ["speak with dead|xphb"]}}}}]};
		expect(getInnateSpellCastingNote(getInnateSpellGrants(phantom, 9)[0])).toBe("one time per short or long rest");
	});

	it("Leaves a plain list unqualified, as the grant it already was", () => {
		const diviner = {additionalSpells: [{innate: {"10": ["see invisibility|xphb"]}}]};
		const [grant] = getInnateSpellGrants(diviner, 10);
		expect(grant.frequency).toBeNull();
		expect(getInnateSpellCastingNote(grant)).toBeNull();
	});

	it("Leaves a {choose} entry to the dynamic reader", () => {
		const moon = {additionalSpells: [{innate: {"3": [{choose: "level=0|class=druid", count: 1}]}}]};
		expect(getInnateSpellGrants(moon, 3)).toEqual([]);
		expect(getDynamicSpellGrants(moon, 3)).toHaveLength(1);
	});

	it("Says nothing for an entity with no innate grants", () => {
		expect(getInnateSpellGrants({}, 5)).toEqual([]);
		expect(getInnateSpellGrants(null, 5)).toEqual([]);
	});
});

/*
 * A patron's expanded spells, and everything else keyed by *slot* level rather than class level.
 * All twelve Warlock patrons state their list as `s1`-`s5`, and the 2024 Bard's Magical Secrets as
 * `s6`-`s9`, because that is the rule: the list grows as the slot does. A reader that understood
 * only class levels skipped every one, so a patron contributed nothing at all.
 */
describe("spells keyed by slot level", () => {
	// Pact slots: 1st at level 1, 2nd at 3, 3rd at 5 — the shape that decides when a patron's
	// spells arrive
	const WARLOCK = {
		name: "Warlock",
		casterProgression: "pact",
		classTableGroups: [{
			colLabels: ["Spell Slots", "Slot Level"],
			rows: [[1, "{@filter 1st|spells|level=1}"], [2, "{@filter 1st|spells|level=1}"], [2, "{@filter 2nd|spells|level=2}"], [2, "{@filter 2nd|spells|level=2}"], [2, "{@filter 3rd|spells|level=3}"]],
		}],
	};
	const ARCHFEY = {
		name: "Archfey",
		additionalSpells: [{expanded: {s1: ["faerie fire", "sleep"], s2: ["calm emotions"], s3: ["blink"]}}],
	};

	const uidsAt = level => getDynamicSpellGrants(ARCHFEY, level, {slotSource: WARLOCK})
		.filter(it => it.type === "expanded")
		.flatMap(it => it.from || []);

	it("Reads the class level at which a slot arrives", () => {
		expect(getSlotLevelUnlockLevel(WARLOCK, 1)).toBe(1);
		expect(getSlotLevelUnlockLevel(WARLOCK, 2)).toBe(3);
		expect(getSlotLevelUnlockLevel(WARLOCK, 3)).toBe(5);
	});

	it("Says nothing for a slot the class never reaches", () => {
		expect(getSlotLevelUnlockLevel(WARLOCK, 9)).toBeNull();
	});

	it("Adds a patron's spells as the slot grows", () => {
		expect(uidsAt(1).sort()).toEqual(["faerie fire", "sleep"]);
		expect(uidsAt(3).sort()).toEqual(["calm emotions", "faerie fire", "sleep"]);
		expect(uidsAt(5)).toContain("blink");
	});

	it("Holds back a list whose slot has not arrived", () => {
		expect(uidsAt(2)).not.toContain("calm emotions");
	});

	it("Widens the learnable list rather than granting the spells", () => {
		// An expanded spell is one the character may learn. A Genie warlock is not walking around
		// always prepared to cast Wish
		expect(getGrantedSpellUids(ARCHFEY, 20)).toEqual([]);
		expect(getGrantedSpellUids({additionalSpells: [{expanded: {9: ["wish"]}}]}, 9)).toEqual([]);
		expect(getDynamicSpellGrants(ARCHFEY, 5, {slotSource: WARLOCK}).every(it => it.type === "expanded")).toBe(true);
	});

	it("Reads a full caster's slot table the same way", () => {
		const bard = {name: "Bard",
			casterProgression: "full",
			classTableGroups: [{rowsSpellProgression: [
				[2], [3], [4, 2], [4, 3], [4, 3, 2],
			]}]};
		expect(getSlotLevelUnlockLevel(bard, 1)).toBe(1);
		expect(getSlotLevelUnlockLevel(bard, 2)).toBe(3);
		expect(getSlotLevelUnlockLevel(bard, 3)).toBe(5);
	});
});

/*
 * The Wizard's spellbook. `spellsKnownProgressionFixed` is what each level *adds* — six at 1st and
 * two per level after — and it is not the prepared count, which is a different number doing a
 * different job. Only the prepared one was read, so the book had no size.
 */
describe("the spellbook", () => {
	const WIZARD = {
		name: "Wizard",
		spellsKnownProgressionFixed: [6, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
		spellsKnownProgressionFixedAllowLowerLevel: true,
		preparedSpellsProgression: [4, 5, 6, 7, 9, 10, 11, 12, 14, 15],
	};

	it("Is the running total, not the level's own gain", () => {
		expect(getSpellbookSize(WIZARD, 1)).toBe(6);
		expect(getSpellbookSize(WIZARD, 2)).toBe(8);
		expect(getSpellbookSize(WIZARD, 9)).toBe(22);
		expect(getSpellbookSize(WIZARD, 20)).toBe(44);
	});

	it("Is a different limit from what may be prepared", () => {
		expect(getSpellbookSize(WIZARD, 5)).toBe(14);
		expect(getPreparedSpellCount(WIZARD, 5)).toBe(9);
	});

	it("Says nothing for a class with no book", () => {
		expect(getSpellbookSize({name: "Cleric", preparedSpellsProgression: [4]}, 5)).toBeNull();
		expect(getSpellbookSize(null, 5)).toBeNull();
	});
});

/*
 * What a feature costs. `consumes` is on 137 features and was read by nothing; what stood in its
 * place was a nine-name map that knew Flurry of Blows and no subclass at all.
 */
describe("resource costs", () => {
	it("Matches a feature's shorthand to the table's own column", () => {
		const labels = ["Ki Points", "Rages", "Sorcery Points", "Psionic Energy Dice", "Channel Divinity"];
		expect(matchResourceLabel("Ki", labels)).toBe("Ki Points");
		expect(matchResourceLabel("Sorcery Point", labels)).toBe("Sorcery Points");
		expect(matchResourceLabel("Psionic Energy Die", labels)).toBe("Psionic Energy Dice");
		expect(matchResourceLabel("Channel Divinity", labels)).toBe("Channel Divinity");
	});

	it("Finds nothing when the character holds no such pool", () => {
		expect(matchResourceLabel("Ki", ["Rages"])).toBeNull();
		expect(matchResourceLabel(null, ["Rages"])).toBeNull();
	});

	it("Says a pool cost in units of the pool", () => {
		expect(getResourceCostLabel({resource: "Ki", amount: 1})).toBe("1 Ki Point");
		expect(getResourceCostLabel({resource: "Ki", amount: 2})).toBe("2 Ki Points");
		expect(getResourceCostLabel({resource: "Psionic Energy Die", amount: 2})).toBe("2 Psionic Energy Dice");
	});

	it("Says a self-limiting feature's cost in uses of itself", () => {
		expect(getResourceCostLabel({resource: "Channel Divinity", amount: 1})).toBe("1 use of Channel Divinity");
		expect(getResourceCostLabel({resource: "Wild Shape", amount: 2})).toBe("2 uses of Wild Shape");
	});

	it("Says a range as a range", () => {
		expect(getResourceCostLabel({resource: "Sorcery Point", amount: 1, amountMin: 1, amountMax: 5}))
			.toBe("1–5 Sorcery Points");
	});
});

/*
 * The Psi Warrior and the Soulknife have a subclass table headed "Die Size" and "Number", neither
 * of which names the pool — so both columns were skipped and fifteen features spent a resource the
 * character did not have. The name is in the features that spend it.
 */
describe("a pool the table does not name", () => {
	const PSI_WARRIOR = {
		name: "Psi Warrior",
		subclassTableGroups: [{
			colLabels: ["Die Size", "Number"],
			rows: [["{@dice D6}", 4], ["{@dice D6}", 4], ["{@dice D8}", 6]],
		}],
		subclassFeatures: [[{name: "Psionic Strike", consumes: {name: "Psionic Energy Die"}}]],
	};

	it("Names it from the features that spend it", () => {
		const res = getClassResources(PSI_WARRIOR, 3);
		expect(res).toContainEqual({label: "Psionic Energy Dice", value: "6", kind: "uses", rest: "long"});
	});

	it("Still leaves the unnamed columns out of the list", () => {
		expect(getClassResources(PSI_WARRIOR, 3).map(it => it.label)).toEqual(["Psionic Energy Dice"]);
	});

	it("Leaves an ordinary table alone", () => {
		const monk = {classTableGroups: [{colLabels: ["Ki Points"], rows: [[2], [3]]}]};
		expect(getClassResources(monk, 2)).toEqual([{label: "Ki Points", value: "3", kind: "uses", rest: "short"}]);
	});
});
