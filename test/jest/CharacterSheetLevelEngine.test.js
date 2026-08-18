import * as fs from "fs";
import "../../js/parser.js";
import {
	checkFeatPrerequisites,
	getAsiCount,
	getPrimaryAbilities,
	getClassResources,
	getExpertiseSkillCount,
	getGrantedSpellUids,
	getDynamicSpellGrants,
	parseSpellFilter,
	isSpellMatchingFilter,
	getSpellGrantGroups,
	getPreparedSpellCount,
	getCantripsKnown,
	getCasterLevelContribution,
	getHitDieAverage,
	getLevelUpHp,
	getMulticlassRequirementsDisplay,
	getFeatProgressionCounts,
	getOptionalFeatureCounts,
	getPactSlots,
	getPreparedSpellsDisplay,
	getSingleClassSlots,
	getSpellcastingMeta,
	getSpellsKnown,
	isMulticlassRequirementMet,
} from "../../js/charactersheet/charactersheet-levelengine.js";

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
	it("Should read dice/number/bonus columns and skip spell columns", () => {
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
			{label: "Rages", value: "3"},
			{label: "Rage Damage", value: "+2"},
			{label: "Weapon Mastery", value: "3"},
			{label: "Sneak Attack", value: "2d6"},
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
	const ctx = ({abilityScores = {}, totalLevel = 1, classes = [], raceNames = [], backgroundName = null, featNames = [], isSpellcaster = false} = {}) =>
		({abilityScores, totalLevel, classes, raceNames, backgroundName, featNames, isSpellcaster});

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
		expect(checkFeatPrerequisites([{ability: [{str: 13}], proficiency: [{weapon: "martial"}]}], ctx({abilityScores: {str: 15}})).status).toBe("unknown");
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
