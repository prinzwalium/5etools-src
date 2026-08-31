import * as fs from "fs";
import "../../js/parser.js";
import {describe, expect, it} from "@jest/globals";
import {getLevelUpPreview} from "../../js/charactersheet/charactersheet-levelpreview.js";

/**
 * What a level gains you, before you commit to it.
 *
 * The level engine already reads everything by level, so this is derive-at-N, derive-at-N+1 and
 * subtract. These check the subtraction against the real class tables — the point of the feature is
 * that a player trusts the numbers, so the numbers are asserted, not the shape.
 */

const loadClassFile = name => JSON.parse(fs.readFileSync(`./data/class/class-${name}.json`, "utf8"));

/**
 * The class, with its feature refs resolved — which is what the pages get.
 *
 * `DataLoader`'s class loader turns `classFeatures`' string refs ("Second Wind|Fighter||1") into
 * resolved objects before any page sees them, and the level engine is written against that. A test
 * reading the JSON gets the refs, so it has to do the same job, or it is testing a shape the app
 * never has.
 */
const getClass = (file, source = "PHB") => {
	const cls = loadClassFile(file).class.find(it => it.source === source);
	if (!cls?.classFeatures) return cls;

	// The file holds a *flat* list of refs — "Second Wind|Fighter||1" — with the level as the ref's
	// last segment. The by-level array the engine reads is what the loader builds out of it.
	const byLevel = [];
	cls.classFeatures.forEach(ref => {
		const uid = typeof ref === "string" ? ref : ref.classFeature;
		if (typeof uid !== "string") return;
		const parts = uid.split("|");
		const level = Number(parts[3]) || 1;
		(byLevel[level - 1] = byLevel[level - 1] || []).push({
			name: parts[0].trim(),
			gainSubclassFeature: !!(ref && ref.gainSubclassFeature),
		});
	});

	return {...cls, classFeatures: byLevel.map(it => it || [])};
};

const labelsOf = preview => preview.lines.map(it => it.label);
const decisionsOf = preview => preview.decisions.map(it => it.label);
const lineFor = (preview, re) => preview.lines.find(it => re.test(it.label));

describe("Level-up preview: the numbers", () => {
	it("Adds the average hit points for the levels gained", () => {
		const preview = getLevelUpPreview({cls: getClass("fighter"), levelFrom: 4, levelTo: 5, conMod: 2});
		// A d10 hit die averages 6 (5e's fixed average), +2 Constitution
		expect(lineFor(preview, /hit points/).label).toBe("+8 hit points");
	});

	it("Counts several levels at once", () => {
		const preview = getLevelUpPreview({cls: getClass("fighter"), levelFrom: 1, levelTo: 3, conMod: 0});
		expect(lineFor(preview, /hit points/).label).toBe("+12 hit points");
	});

	it("Says when the proficiency bonus moves, and stays quiet when it does not", () => {
		expect(labelsOf(getLevelUpPreview({cls: getClass("fighter"), levelFrom: 4, levelTo: 5})))
			.toContain("Proficiency bonus");
		expect(labelsOf(getLevelUpPreview({cls: getClass("fighter"), levelFrom: 5, levelTo: 6})))
			.not.toContain("Proficiency bonus");
	});

	it("Reads new spell slots off the class table", () => {
		const preview = getLevelUpPreview({cls: getClass("wizard"), levelFrom: 4, levelTo: 5});
		// A wizard reaching 5th gains its first two 3rd-level slots; the lower ones do not move,
		// and a line that says so anyway would be noise
		expect(lineFor(preview, /3rd-level spell slots/).detail).toBe("0 → 2");
		expect(lineFor(preview, /2nd-level spell slots/)).toBeUndefined();
	});

	it("Names the features gained, and not the ones already held", () => {
		const labels = labelsOf(getLevelUpPreview({cls: getClass("fighter"), levelFrom: 4, levelTo: 5}));
		expect(labels).toContain("Extra Attack");
		expect(labels).not.toContain("Second Wind");
	});
});

describe("Level-up preview: what it will then ask", () => {
	it("Flags the Ability Score Improvement a level brings", () => {
		expect(decisionsOf(getLevelUpPreview({cls: getClass("fighter"), levelFrom: 3, levelTo: 4})))
			.toContain("Ability Score Improvement or feat");
	});

	it("Flags the subclass arriving, once", () => {
		const cls = getClass("cleric", "XPHB");
		expect(decisionsOf(getLevelUpPreview({cls, levelFrom: 2, levelTo: 3}))).toContain("Cleric Subclass");
		// Already chosen — a subclass entity means the question is answered
		expect(decisionsOf(getLevelUpPreview({cls, sc: {name: "Life Domain"}, levelFrom: 2, levelTo: 3})))
			.not.toContain("Cleric Subclass");
	});

	it("Counts new cantrips as both a change and a decision", () => {
		const preview = getLevelUpPreview({cls: getClass("wizard"), levelFrom: 3, levelTo: 4});
		expect(lineFor(preview, /cantrips known/).detail).toBe("3 → 4");
		expect(decisionsOf(preview)).toContain("1 cantrips known to choose");
	});

	it("Flags a 2024 Fighter's extra weapon masteries", () => {
		const decisions = decisionsOf(getLevelUpPreview({cls: getClass("fighter", "XPHB"), levelFrom: 3, levelTo: 4}));
		expect(decisions.some(it => /Weapon mastery/.test(it))).toBe(true);
	});
});

describe("Level-up preview: the two shapes class data takes", () => {
	// The pages hand in dereferenced features; the files hold string refs. Both have to read.
	it("Reads a raw string ref as well as a resolved feature", () => {
		const raw = {hd: {faces: 8}, classFeatures: [[], ["Cunning Action|Rogue||2"]]};
		expect(getLevelUpPreview({cls: raw, levelFrom: 1, levelTo: 2}).lines.map(it => it.label))
			.toContain("Cunning Action");
	});

	it("And skips the marker that only says a subclass feature arrives", () => {
		const raw = {hd: {faces: 8}, classFeatures: [[], [{classFeature: "Roguish Archetype|Rogue||2", gainSubclassFeature: true}]]};
		expect(getLevelUpPreview({cls: raw, levelFrom: 1, levelTo: 2}).lines.map(it => it.label))
			.not.toContain("Roguish Archetype");
	});
});

describe("Level-up preview: saying nothing", () => {
	it("Reports nothing when the level does not move", () => {
		const preview = getLevelUpPreview({cls: getClass("fighter"), levelFrom: 5, levelTo: 5});
		expect(preview.lines).toEqual([]);
		expect(preview.decisions).toEqual([]);
	});

	it("Reports nothing going backwards", () => {
		expect(getLevelUpPreview({cls: getClass("fighter"), levelFrom: 5, levelTo: 3}).lines).toEqual([]);
	});

	it("Copes with no class at all", () => {
		expect(getLevelUpPreview({levelFrom: 1, levelTo: 2}).lines).toEqual([]);
		expect(getLevelUpPreview().lines).toEqual([]);
	});
});
