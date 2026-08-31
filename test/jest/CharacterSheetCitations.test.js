import {describe, expect, it} from "@jest/globals";
import fs from "fs";
import {
	CITATIONS,
	getBreakdownCitation,
	getItemCitation,
	getOptionalFeatureCitation,
	getPartCitations,
	isSameCitation,
	resolveCitation,
} from "../../js/charactersheet/charactersheet-citations.js";

const _readData = path => JSON.parse(fs.readFileSync(path, "utf8"));

describe("Character Sheet — rule citations", () => {
	describe("resolveCitation", () => {
		it("Should resolve a catalogue key to its entry", () => {
			expect(resolveCitation("proficiency")).toEqual({name: "Proficiency", source: "XPHB", page: "variantrules.html"});
		});

		it("Should pass a built descriptor through, defaulting the source", () => {
			expect(resolveCitation({name: "Chain Mail", page: "items.html"}))
				.toEqual({name: "Chain Mail", source: "PHB", page: "items.html"});
		});

		it("Should return null for nothing, an unknown key, or a descriptor with no target", () => {
			expect(resolveCitation(null)).toBeNull();
			expect(resolveCitation(undefined)).toBeNull();
			expect(resolveCitation("notARule")).toBeNull();
			expect(resolveCitation({name: "Nameless"})).toBeNull();
			expect(resolveCitation({page: "items.html"})).toBeNull();
		});
	});

	describe("Entity citations", () => {
		it("Should cite an item the character owns", () => {
			expect(getItemCitation({name: "Cloak of Protection", source: "DMG"}))
				.toEqual({name: "Cloak of Protection", source: "DMG", page: "items.html"});
		});

		it("Should cite an optional feature", () => {
			expect(getOptionalFeatureCitation({name: "Archery", source: "PHB"}))
				.toEqual({name: "Archery", source: "PHB", page: "optionalfeatures.html"});
		});

		it("Should refuse to cite something with no name", () => {
			expect(getItemCitation(null)).toBeNull();
			expect(getItemCitation({})).toBeNull();
			expect(getOptionalFeatureCitation({source: "PHB"})).toBeNull();
		});
	});

	describe("getBreakdownCitation", () => {
		it("Should give each kind of number the rule it is computed under", () => {
			expect(getBreakdownCitation("save").name).toBe("Saving Throw");
			expect(getBreakdownCitation("skill").name).toBe("Skill");
			expect(getBreakdownCitation("ac").name).toBe("Armor Class");
			expect(getBreakdownCitation("passivePerception").name).toBe("Passive Perception");
			expect(getBreakdownCitation("initiative").name).toBe("Initiative");
			// A spell attack is still an attack roll
			expect(getBreakdownCitation("spellAttack").name).toBe("Attack Roll");
		});

		it("Should return null for a kind with no rule of its own", () => {
			expect(getBreakdownCitation("somethingElse")).toBeNull();
			expect(getBreakdownCitation(null)).toBeNull();
		});
	});

	describe("getPartCitations", () => {
		it("Should list each cited part once, in order", () => {
			const parts = [
				{label: "Dexterity", value: 3, cite: "abilityModifier"},
				{label: "Proficiency", value: 2, cite: "proficiency"},
				{label: "Misc", value: 1},
				{label: "Expertise", value: 2, cite: "proficiency"},
			];
			expect(getPartCitations(parts).map(it => it.name)).toEqual(["Ability Score and Modifier", "Proficiency"]);
		});

		it("Should be empty when nothing is cited", () => {
			expect(getPartCitations([{label: "Misc", value: 1}])).toEqual([]);
			expect(getPartCitations([])).toEqual([]);
			expect(getPartCitations(null)).toEqual([]);
		});
	});

	describe("isSameCitation", () => {
		it("Should match a key against the descriptor it resolves to", () => {
			expect(isSameCitation("proficiency", CITATIONS.proficiency)).toBe(true);
			expect(isSameCitation("proficiency", "skill")).toBe(false);
		});

		it("Should not treat two unresolvable citations as equal", () => {
			expect(isSameCitation(null, null)).toBe(false);
		});
	});

	// The point of citing a rule is that the app ships the book it is in. A catalogue entry that
	// names an entity the data does not have would show an empty modal.
	describe("Every catalogue citation exists in the data", () => {
		const byPage = {
			"variantrules.html": _readData("data/variantrules.json").variantrule,
			"conditionsdiseases.html": _readData("data/conditionsdiseases.json").condition,
		};

		Object.entries(CITATIONS).forEach(([key, cite]) => {
			it(`Should find "${cite.name}" (${cite.source}) for ${key}`, () => {
				const pool = byPage[cite.page];
				expect(pool).toBeDefined();
				const found = pool.find(it => it.name === cite.name && it.source === cite.source);
				expect(found).toBeDefined();
				// ...and it must actually have text to show
				expect(found.entries?.length).toBeGreaterThan(0);
			});
		});
	});
});
