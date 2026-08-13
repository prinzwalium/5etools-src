import * as fs from "fs";
import "../../js/parser.js";
import {
	DEFENSE_KIND_CONDITION_IMMUNE,
	DEFENSE_KIND_IMMUNE,
	DEFENSE_KIND_RESIST,
	DEFENSE_KIND_SENSE,
	DEFENSE_KIND_VULNERABLE,
	formatSense,
	getEntityDefenses,
	getEquippedItemDefenses,
	groupDefensesByKind,
	mergeDefenses,
} from "../../js/charactersheet/charactersheet-defenses.js";

const RACES = JSON.parse(fs.readFileSync("./data/races.json", "utf8")).race;
const FEATS = JSON.parse(fs.readFileSync("./data/feats.json", "utf8")).feat;
const ITEMS = JSON.parse(fs.readFileSync("./data/items.json", "utf8")).item;

const getRace = (name, source) => RACES.find(it => it.name === name && (!source || it.source === source));
const getFeat = name => FEATS.find(it => it.name === name);
const getItem = name => ITEMS.find(it => it.name === name);

const namesOf = (defenses, kind) => defenses.filter(it => it.kind === kind).map(it => it.name);

describe("Senses a feat improves rather than grants", () => {
	// `bonusSenses` is the spelling a feat uses when it *raises* a sense; reading only `senses` lost
	// Keenness of the Stone Giant's darkvision entirely
	it("Reads bonusSenses alongside senses", () => {
		const out = getEntityDefenses({name: "Keenness of the Stone Giant", bonusSenses: [{darkvision: 60}]});
		expect(out.map(it => it.name)).toEqual(["Darkvision 60 ft."]);
	});
});

describe("Defenses: what a species grants", () => {
	it("Reads a fixed damage resistance and a darkvision range", () => {
		const dwarf = getEntityDefenses(getRace("Dwarf", "PHB"));
		expect(namesOf(dwarf, DEFENSE_KIND_RESIST)).toEqual(["Poison"]);
		expect(namesOf(dwarf, DEFENSE_KIND_SENSE)).toEqual(["Darkvision 60 ft."]);
	});

	it("Reads two resistances at once", () => {
		expect(namesOf(getEntityDefenses(getRace("Aasimar", "DMG")), DEFENSE_KIND_RESIST)).toEqual(["Necrotic", "Radiant"]);
	});

	it("Leaves a `choose` resistance to the choice engine", () => {
		// A Dragonborn picks its ancestry's damage type; that is a pick, not a grant
		expect(getEntityDefenses(getRace("Dragonborn", "PHB"))).toEqual([]);
	});

	it("Reads immunities, vulnerabilities and condition immunities", () => {
		const skeleton = getEntityDefenses(getRace("Skeleton"));
		expect(namesOf(skeleton, DEFENSE_KIND_IMMUNE)).toEqual(["Poison"]);
		expect(namesOf(skeleton, DEFENSE_KIND_VULNERABLE)).toEqual(["Bludgeoning"]);
		expect(namesOf(skeleton, DEFENSE_KIND_CONDITION_IMMUNE)).toEqual(["Exhaustion", "Poisoned"]);
	});

	it("Grants nothing for a species that grants nothing", () => {
		expect(getEntityDefenses(getRace("Human", "PHB"))).toEqual([]);
		expect(getEntityDefenses(null)).toEqual([]);
	});
});

describe("Defenses: what a feat grants", () => {
	it("Reads a feat's resistances", () => {
		expect(namesOf(getEntityDefenses(getFeat("Infernal Constitution")), DEFENSE_KIND_RESIST)).toEqual(["Cold", "Poison"]);
	});

	it("Reads a sense given as a `senses` group", () => {
		expect(namesOf(getEntityDefenses(getFeat("Blind Fighting")), DEFENSE_KIND_SENSE)).toEqual(["Blindsight 10 ft."]);
	});

	it("Reads an immunity alongside a condition immunity", () => {
		const boon = getEntityDefenses(getFeat("Boon of Poison Mastery"));
		expect(namesOf(boon, DEFENSE_KIND_IMMUNE)).toEqual(["Poison"]);
		expect(namesOf(boon, DEFENSE_KIND_CONDITION_IMMUNE)).toEqual(["Poisoned"]);
	});

	it("Leaves a feat's `choose` resistance to the choice engine", () => {
		expect(getEntityDefenses(getFeat("Boon of Energy Resistance"))).toEqual([]);
	});
});

describe("Defenses: what equipped gear grants", () => {
	const ring = getItem("Ring of Fire Resistance");
	const periapt = getItem("Periapt of Proof against Poison");

	it("Counts an item only while it is equipped", () => {
		const state = {inventory: [{name: ring.name, ...ring, equipped: false}]};
		expect(getEquippedItemDefenses(state)).toEqual([]);
		expect(getEquippedItemDefenses({inventory: [{name: ring.name, ...ring, equipped: true}]}))
			.toEqual([{kind: DEFENSE_KIND_RESIST, name: "Fire", note: null, source: "Ring of Fire Resistance", isFromItem: true}]);
	});

	it("Credits the item that granted it", () => {
		const worn = getEquippedItemDefenses({inventory: [{...periapt, equipped: true}]});
		expect(worn.every(it => it.source === "Periapt of Proof against Poison")).toBe(true);
		expect(namesOf(worn, DEFENSE_KIND_IMMUNE)).toEqual(["Poison"]);
		expect(namesOf(worn, DEFENSE_KIND_CONDITION_IMMUNE)).toEqual(["Poisoned"]);
	});

	it("Reads nothing off gear that grants nothing", () => {
		expect(getEquippedItemDefenses({inventory: [{name: "Longsword", equipped: true}]})).toEqual([]);
		expect(getEquippedItemDefenses({})).toEqual([]);
	});
});

describe("Defenses: merging and grouping for the sheet", () => {
	it("Lists something granted twice once, crediting both sources", () => {
		const merged = mergeDefenses([
			{id: "a", kind: DEFENSE_KIND_RESIST, name: "Fire", source: "Tiefling"},
			{kind: DEFENSE_KIND_RESIST, name: "Fire", source: "Ring of Fire Resistance", isFromItem: true},
		]);
		expect(merged).toHaveLength(1);
		expect(merged[0].sources).toEqual(["Tiefling", "Ring of Fire Resistance"]);
	});

	it("Knows when something depends on gear staying on", () => {
		const [fromItem] = mergeDefenses([{kind: DEFENSE_KIND_RESIST, name: "Fire", source: "Ring", isFromItem: true}]);
		expect(fromItem.isFromItem).toBe(true);
		const [fromSpecies] = mergeDefenses([
			{kind: DEFENSE_KIND_RESIST, name: "Fire", source: "Ring", isFromItem: true},
			{kind: DEFENSE_KIND_RESIST, name: "Fire", source: "Tiefling"},
		]);
		expect(fromSpecies.isFromItem).toBe(false);
	});

	it("Groups by kind, in the order a sheet reads them", () => {
		const groups = groupDefensesByKind([
			{kind: DEFENSE_KIND_SENSE, name: "Darkvision 60 ft.", source: "Dwarf"},
			{kind: DEFENSE_KIND_CONDITION_IMMUNE, name: "Poisoned", source: "Boon"},
			{kind: DEFENSE_KIND_RESIST, name: "Poison", source: "Dwarf"},
		]);
		expect(groups.map(it => it.label)).toEqual(["Resistances", "Condition Immunities", "Senses"]);
	});

	it("Sorts each group and drops the empty ones", () => {
		const groups = groupDefensesByKind([
			{kind: DEFENSE_KIND_RESIST, name: "Radiant", source: "Aasimar"},
			{kind: DEFENSE_KIND_RESIST, name: "Necrotic", source: "Aasimar"},
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0].items.map(it => it.name)).toEqual(["Necrotic", "Radiant"]);
	});

	it("Ignores entries with no name", () => {
		expect(mergeDefenses([{kind: DEFENSE_KIND_RESIST}, null])).toEqual([]);
		expect(groupDefensesByKind(null)).toEqual([]);
	});
});

describe("Defenses: the shapes the data uses", () => {
	it("Keeps the note off a conditional group, and reads its inner kind", () => {
		const defenses = getEntityDefenses({resist: [{resist: ["bludgeoning", "piercing"], note: "while raging", cond: true}]});
		expect(defenses.map(it => `${it.name} (${it.note})`)).toEqual(["Bludgeoning (while raging)", "Piercing (while raging)"]);
	});

	it("Reads a nested group whose kind differs from its parent's", () => {
		const defenses = getEntityDefenses({resist: [{immune: ["fire"], note: "in sunlight"}]});
		expect(defenses).toEqual([{kind: DEFENSE_KIND_IMMUNE, name: "Fire", note: "in sunlight"}]);
	});

	it("Keeps a `special` clause as the words the book uses", () => {
		expect(getEntityDefenses({immune: [{special: "damage from its own spells"}]}))
			.toEqual([{kind: DEFENSE_KIND_IMMUNE, name: "damage from its own spells", note: null}]);
	});

	it("Formats a sense with and without a range", () => {
		expect(formatSense("darkvision", 60)).toBe("Darkvision 60 ft.");
		expect(formatSense("truesight", null)).toBe("Truesight");
	});
});
