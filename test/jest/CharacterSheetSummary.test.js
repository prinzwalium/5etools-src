import {describe, expect, it} from "@jest/globals";
import "../../js/parser.js";
import {getCharacterSummary, getClassLine, getSummaryLines} from "../../js/charactersheet/charactersheet-summary.js";

/**
 * The read-only view a GM gets of a player's character — and, later, one column of the party sheet.
 * Both come from here, so they cannot disagree with each other or with the sheet.
 */
describe("Character Sheet — read-only summary", () => {
	const baseState = {
		name: "Ada",
		abil_str: 10,
		abil_dex: 16,
		abil_con: 14,
		abil_int: 12,
		abil_wis: 13,
		abil_cha: 8,
		// The shape the model actually stores. Writing this as a string is what let
		// "Rogue ([object Object]) 5" reach the character list unnoticed
		classes: [{name: "Rogue", subclass: {name: "Thief", shortName: "Thief", source: "PHB"}, level: 5}],
		hpMax: 33,
		hpCur: 20,
		speed: "30 ft.",
		save_dex: true,
		skill_stealth: 2,
		skill_perception: 1,
	};

	describe("getClassLine", () => {
		it("Should read the structured classes when there are any", () => {
			expect(getClassLine(baseState)).toBe("Rogue (Thief) 5");
		});

		it("Should join a multiclass with a slash", () => {
			expect(getClassLine({classes: [{name: "Fighter", level: 5}, {name: "Rogue", level: 2}]})).toBe("Fighter 5 / Rogue 2");
		});

		// A subclass has a short name for exactly this: "Rogue (Thief)", not "Rogue (Path of the Thief)"
		it("Should prefer the subclass's short name, and never print the object", () => {
			const line = getClassLine({classes: [{name: "Cleric", level: 3, subclass: {name: "Life Domain", shortName: "Life", source: "XPHB"}}]});
			expect(line).toBe("Cleric (Life) 3");
			expect(line).not.toContain("[object");
		});

		// Characters saved before the subclass became structured still hold a bare string
		it("Should still read a subclass saved as a string", () => {
			expect(getClassLine({classes: [{name: "Rogue", subclass: "Thief", level: 5}]})).toBe("Rogue (Thief) 5");
		});

		// A character typed in by hand still has to show something
		it("Should fall back to the typed line, then to a dash", () => {
			expect(getClassLine({classLevel: "Bard 3"})).toBe("Bard 3");
			expect(getClassLine({})).toBe("—");
		});
	});

	describe("getCharacterSummary", () => {
		it("Should carry the numbers a GM actually asks about", () => {
			const summary = getCharacterSummary(baseState);
			expect(summary.name).toBe("Ada");
			expect(summary.level).toBe(5);
			expect(summary.hpMax).toBe(33);
			expect(summary.hpCur).toBe(20);
			expect(summary.profBonus).toBe(3);
			// 10 + Wisdom (+1) + proficiency (+3), since Perception is proficient
			expect(summary.passivePerception).toBe(14);
		});

		it("Should list only the proficient saves and skills", () => {
			const summary = getCharacterSummary(baseState);
			expect(summary.saves.map(it => it.abv)).toEqual(["dex"]);
			expect(summary.skills.map(it => it.key).sort()).toEqual(["perception", "stealth"]);
		});

		it("Should mark expertise, since it doubles the bonus", () => {
			const stealth = getCharacterSummary(baseState).skills.find(it => it.key === "stealth");
			expect(stealth.isExpertise).toBe(true);
			// Dex +3, proficiency +3 doubled
			expect(stealth.modText).toBe("+9");
		});

		it("Should format modifiers with a sign, including negative ones", () => {
			const cha = getCharacterSummary(baseState).abilities.find(it => it.abv === "cha");
			expect(cha.modText).toBe("−1");
		});

		// Exactly the question the party sheet exists to answer
		it("Should surface senses and resistances", () => {
			const summary = getCharacterSummary({
				...baseState,
				defenses: [
					{kind: "sense", name: "Darkvision 60 ft.", sources: ["Elf"]},
					{kind: "resist", name: "fire", sources: ["Ring"]},
					{kind: "conditionImmune", name: "charmed", sources: ["Fey Ancestry"]},
				],
			});
			expect(summary.senses).toEqual(["Darkvision 60 ft."]);
			expect(summary.resistances).toEqual(["fire"]);
			expect(summary.conditionImmunities).toEqual(["charmed"]);
		});

		it("Should not fall over on an empty character", () => {
			const summary = getCharacterSummary({});
			expect(summary.name).toBe("Unnamed Character");
			expect(summary.saves).toEqual([]);
			expect(summary.senses).toEqual([]);
		});

		it("Should not fall over on nothing at all", () => {
			expect(() => getCharacterSummary(null)).not.toThrow();
		});
	});

	describe("getSummaryLines", () => {
		it("Should drop the lines with nothing to say", () => {
			const labels = getSummaryLines(getCharacterSummary({})).map(it => it.label);
			expect(labels).not.toContain("Senses");
			expect(labels).not.toContain("Languages");
			expect(labels).not.toContain("Exhaustion");
		});

		// An absent AC is itself worth seeing, so this one line always prints
		it("Should always print Armor Class", () => {
			expect(getSummaryLines(getCharacterSummary({})).map(it => it.label)).toContain("Armor Class");
		});

		it("Should show current and maximum hit points together", () => {
			const line = getSummaryLines(getCharacterSummary(baseState)).find(it => it.label === "Hit Points");
			expect(line.value).toBe("20 / 33");
		});

		it("Should keep the lines in a fixed order, so two characters read the same way", () => {
			const labels = getSummaryLines(getCharacterSummary(baseState)).map(it => it.label);
			expect(labels.indexOf("Class")).toBeLessThan(labels.indexOf("Armor Class"));
			expect(labels.indexOf("Armor Class")).toBeLessThan(labels.indexOf("Skills"));
		});
	});
});
