import * as fs from "fs";
import {describe, expect, it} from "@jest/globals";
import {
	TRAIT_TAG_POWERFUL_BUILD,
	formatHeight,
	getCarryMultiplier,
	getDiceExpressionRange,
	getHeightAndWeightRange,
	getHeightAndWeightTable,
	getTraitTags,
	parseDiceExpression,
	rollDiceExpression,
	rollHeightAndWeight,
} from "../../js/charactersheet/charactersheet-appearance.js";
import {getEncumbrance} from "../../js/charactersheet/charactersheet-derive.js";

/**
 * The descriptive half of a species: its random height and weight table, and its trait tags.
 *
 * The roll is injected rather than random here, because the point of the rule is *which* numbers
 * multiply which — a test that only checked the range would pass on the obvious wrong answer.
 */

const races = JSON.parse(fs.readFileSync("./data/races.json", "utf8")).race;
const getRace = (name, source) => races.find(it => it.name === name && (!source || it.source === source));

/** A die that always rolls its maximum, and one that always rolls 1. */
const rollMax = faces => faces;
const rollMin = () => 1;

describe("Dice expressions", () => {
	it("Reads the two shapes the data uses", () => {
		expect(parseDiceExpression("2d10")).toEqual({count: 2, faces: 10});
		expect(parseDiceExpression("d6")).toEqual({count: 1, faces: 6});
		expect(parseDiceExpression("4")).toMatchObject({flat: 4});
	});

	it("Refuses anything else rather than guessing", () => {
		expect(parseDiceExpression("")).toBeNull();
		expect(parseDiceExpression(null)).toBeNull();
		expect(parseDiceExpression("2d")).toBeNull();
		expect(parseDiceExpression("a lot")).toBeNull();
	});

	it("Rolls and bounds them", () => {
		expect(rollDiceExpression("2d10", rollMax)).toBe(20);
		expect(rollDiceExpression("2d10", rollMin)).toBe(2);
		expect(rollDiceExpression("4", rollMax)).toBe(4);
		expect(getDiceExpressionRange("2d12")).toEqual({min: 2, max: 24});
		expect(getDiceExpressionRange("nonsense")).toEqual({min: 0, max: 0});
	});
});

describe("The species' random height and weight table", () => {
	it("Reads a real one out of the data", () => {
		// Aasimar: 4'8" base, +2d10 inches, 110 lb. base, × 2d4 lb.
		const hw = getHeightAndWeightTable(getRace("Aasimar", "VGM"));
		expect(hw).toEqual({baseHeight: 56, baseWeight: 110, heightMod: "2d10", weightMod: "2d4"});
	});

	it("Says nothing for a species without one", () => {
		expect(getHeightAndWeightTable(getRace("Human", "XPHB"))).toBeNull();
		expect(getHeightAndWeightTable(null)).toBeNull();
	});

	it("Skips the umbrella entry, whose subraces carry the real table", () => {
		expect(getHeightAndWeightTable({_isBaseRace: true, heightAndWeight: {baseHeight: 56, baseWeight: 110}})).toBeNull();
	});

	it("Treats a missing weight modifier as ×1", () => {
		expect(getHeightAndWeightTable({heightAndWeight: {baseHeight: 50, baseWeight: 90, heightMod: "2d8"}}).weightMod)
			.toBe("1");
	});
});

describe("Rolling height and weight", () => {
	const hw = {baseHeight: 56, baseWeight: 110, heightMod: "2d10", weightMod: "2d4"};

	it("Multiplies the *height* roll into the weight, as the book says", () => {
		// Height roll 20 → 6'4"; weight 110 + (8 × 20) = 270 lb. Rolling the two independently and
		// adding gives 118, which is the obvious wrong answer and visibly too light for the height
		const out = rollHeightAndWeight(hw, {fnRollDie: rollMax});
		expect(out).toMatchObject({heightRoll: 20, weightModRoll: 8, heightIn: 76, weightLb: 270});
	});

	it("Rolls the bottom of the range too", () => {
		expect(rollHeightAndWeight(hw, {fnRollDie: rollMin}))
			.toMatchObject({heightIn: 58, weightLb: 114});
	});

	it("Reports the range those two rolls bound", () => {
		const range = getHeightAndWeightRange(hw);
		expect(range).toEqual({minHeightIn: 58, maxHeightIn: 76, minWeightLb: 114, maxWeightLb: 270});
	});

	it("Stays inside that range over many random rolls", () => {
		const range = getHeightAndWeightRange(hw);
		for (let i = 0; i < 200; ++i) {
			const out = rollHeightAndWeight(hw);
			expect(out.heightIn).toBeGreaterThanOrEqual(range.minHeightIn);
			expect(out.heightIn).toBeLessThanOrEqual(range.maxHeightIn);
			expect(out.weightLb).toBeGreaterThanOrEqual(range.minWeightLb);
			expect(out.weightLb).toBeLessThanOrEqual(range.maxWeightLb);
		}
	});

	it("Copes with no table", () => {
		expect(rollHeightAndWeight(null)).toBeNull();
	});
});

describe("Height, written out", () => {
	it("Reads as feet and inches", () => {
		expect(formatHeight(76)).toBe(`6'4"`);
		expect(formatHeight(72)).toBe(`6'`);
		expect(formatHeight(11)).toBe(`11"`);
	});
});

describe("Trait tags", () => {
	it("Reads them off the data", () => {
		const goliath = getRace("Goliath", "XPHB") || getRace("Goliath");
		expect(getTraitTags(goliath)).toContain(TRAIT_TAG_POWERFUL_BUILD);
	});

	it("Copes with a species that has none", () => {
		expect(getTraitTags({})).toEqual([]);
		expect(getTraitTags(null)).toEqual([]);
	});

	it("Doubles carrying capacity for Powerful Build, and nothing else", () => {
		expect(getCarryMultiplier([TRAIT_TAG_POWERFUL_BUILD])).toBe(2);
		expect(getCarryMultiplier(["Natural Armor", "Amphibious"])).toBe(1);
		expect(getCarryMultiplier([])).toBe(1);
		expect(getCarryMultiplier(null)).toBe(1);
	});
});

describe("Carrying capacity", () => {
	const state = tags => ({abil_str: 16, inventory: [{weightLb: 10, quantity: 20}], speciesTraitTags: tags});

	it("Is Strength × 15 for most characters", () => {
		expect(getEncumbrance(state([]))).toMatchObject({capacityLb: 240, totalWeightLb: 200, isPowerfulBuild: false});
	});

	it("Is doubled by Powerful Build, and says so", () => {
		// 200 lb. carried is over 240 and under 480: the tag is the difference between encumbered
		// and not, which is why reading it matters
		expect(getEncumbrance(state([TRAIT_TAG_POWERFUL_BUILD])))
			.toMatchObject({capacityLb: 480, isPowerfulBuild: true});
	});

	it("Copes with a character saved before the tags were recorded", () => {
		expect(getEncumbrance({abil_str: 10, inventory: []})).toMatchObject({capacityLb: 150});
	});
});
