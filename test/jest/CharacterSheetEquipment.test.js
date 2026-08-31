import * as fs from "fs";
import "../../js/parser.js";
import {
	getAmmoRecovered,
	getChargesAfterRest,
	getCoinDisplay,
	getEquipmentChoiceGroups,
	getEquipmentOptionDisplay,
	getInventoryItemMeta,
	getItemUidParts,
	getNormalisedEquipmentEntry,
	getRechargeRest,
	isAmmunitionType,
	parseRechargeAmount,
	rollRechargeAmount,
} from "../../js/charactersheet/charactersheet-equipment.js";
import {getEncumbrance} from "../../js/charactersheet/charactersheet-derive.js";

const getClass = (file, source) => JSON.parse(fs.readFileSync(`./data/class/class-${file}.json`, "utf8")).class.find(it => it.source === source);

describe("Starting equipment parsing", () => {
	it("Should parse item uids with default source", () => {
		expect(getItemUidParts("chain mail|phb")).toEqual({name: "chain mail", source: "phb"});
		expect(getItemUidParts("longsword")).toEqual({name: "longsword", source: "phb"});
	});

	it("Should normalise the entry kinds", () => {
		expect(getNormalisedEquipmentEntry("chain mail|phb")).toEqual({kind: "item", name: "chain mail", source: "phb", quantity: 1, display: "chain mail"});
		expect(getNormalisedEquipmentEntry({item: "handaxe|phb", quantity: 2}).quantity).toBe(2);
		expect(getNormalisedEquipmentEntry({special: "insignia of rank"}).kind).toBe("special");
		expect(getNormalisedEquipmentEntry({equipmentType: "weaponMartial", quantity: 2})).toEqual({kind: "placeholder", quantity: 2, display: "a martial weapon"});
		expect(getNormalisedEquipmentEntry({value: 400})).toEqual({kind: "coins", quantity: 1, value: 400, display: "4 gp"});
	});

	it("Should parse the PHB fighter's a/b choice groups", () => {
		const fighter = getClass("fighter", "PHB");
		const groups = getEquipmentChoiceGroups(fighter.startingEquipment.defaultData);
		expect(groups).toHaveLength(4);
		expect(groups.every(g => g.isChoice)).toBe(true);
		expect(groups[0].options.map(o => o.key)).toEqual(["a", "b"]);
		expect(getEquipmentOptionDisplay(groups[0].options[0])).toBe("chain mail");
		expect(getEquipmentOptionDisplay(groups[2].options[1])).toBe("2× handaxe");
	});

	it("Should parse 2024-style uppercase groups with coin values (XPHB fighter)", () => {
		const fighter = getClass("fighter", "XPHB");
		const groups = getEquipmentChoiceGroups(fighter.startingEquipment.defaultData);
		const optA = groups[0].options.find(o => o.key === "A");
		expect(optA.entries.some(it => it.kind === "coins" && it.display === "4 gp")).toBe(true);
		expect(optA.entries.find(it => it.name === "javelin").quantity).toBe(8);
	});

	it("Should mark always-granted background groups as non-choices", () => {
		const groups = getEquipmentChoiceGroups([{_: ["ink (1-ounce bottle)|phb", {special: "quill"}]}]);
		expect(groups).toHaveLength(1);
		expect(groups[0].isChoice).toBe(false);
	});

	it("Should display coin values in the largest sensible coin", () => {
		expect(getCoinDisplay(1000)).toBe("10 gp");
		expect(getCoinDisplay(50)).toBe("5 sp");
		expect(getCoinDisplay(7)).toBe("7 cp");
	});
});

describe("Encumbrance", () => {
	it("Should sum inventory weight against Strength-based capacity", () => {
		const state = {
			abil_str: 15,
			inventory: [
				{id: "a", name: "Chain Mail", quantity: 1, weightLb: 55},
				{id: "b", name: "Handaxe", quantity: 2, weightLb: 2},
				{id: "c", name: "Trinket", quantity: 1, weightLb: null},
			],
		};
		expect(getEncumbrance(state)).toMatchObject({totalWeightLb: 59, capacityLb: 225});
	});

	it("Should handle an empty inventory", () => {
		expect(getEncumbrance({abil_str: 10, inventory: []})).toMatchObject({totalWeightLb: 0, capacityLb: 150});
	});
});

describe("Equipment: an item's charges", () => {
	it("Knows which rest gives them back", () => {
		expect(["dawn", "dusk", "midnight", "restLong"].map(getRechargeRest)).toEqual(["long", "long", "long", "long"]);
		expect(getRechargeRest("restShort")).toBe("short");
		// "special" means the item's own text decides, so nothing happens automatically
		expect(getRechargeRest("special")).toBeNull();
		expect(getRechargeRest(null)).toBeNull();
	});

	it("Reads the amount, whether a number or a dice tag", () => {
		expect(parseRechargeAmount(3)).toEqual({flat: 3});
		expect(parseRechargeAmount("3")).toEqual({flat: 3});
		expect(parseRechargeAmount("{@dice 1d6 + 4}")).toEqual({count: 1, faces: 6, bonus: 4});
		expect(parseRechargeAmount("{@dice 2d4}")).toEqual({count: 2, faces: 4, bonus: 0});
		expect(parseRechargeAmount("{@dice 1d6 - 1}")).toEqual({count: 1, faces: 6, bonus: -1});
		expect(parseRechargeAmount(null)).toBeNull();
	});

	it("Rolls the dice, and gives everything back when the item says nothing", () => {
		// A roll of 1 on every die: 1d6 + 4 → 5
		expect(rollRechargeAmount("{@dice 1d6 + 4}", {rng: () => 0})).toBe(5);
		// ... and the maximum: 1d6 + 4 → 10
		expect(rollRechargeAmount("{@dice 1d6 + 4}", {rng: () => 0.999})).toBe(10);
		expect(rollRechargeAmount(null, {chargesMax: 7})).toBe(7);
	});

	it("Restores charges only on the rest that recharges the item", () => {
		const wand = {chargesMax: 7, chargesUsed: 5, recharge: "dawn", rechargeAmount: "{@dice 1d6 + 1}"};
		expect(getChargesAfterRest(wand, "short")).toBe(5);
		expect(getChargesAfterRest(wand, "long", {rng: () => 0})).toBe(3); // regained 2 of 5
	});

	it("Never restores past full, and leaves an item with no charges alone", () => {
		expect(getChargesAfterRest({chargesMax: 3, chargesUsed: 2, recharge: "dawn"}, "long")).toBe(0);
		expect(getChargesAfterRest({chargesUsed: 4}, "long")).toBe(4);
	});

	it("Reads charges off the item data", () => {
		const meta = getInventoryItemMeta({name: "Wand of Fireballs", charges: 7, recharge: "dawn", rechargeAmount: "{@dice 1d6 + 1}"});
		expect(meta).toMatchObject({chargesMax: 7, recharge: "dawn", rechargeAmount: "{@dice 1d6 + 1}"});
		expect(getInventoryItemMeta({name: "Longsword"}).chargesMax).toBeUndefined();
	});
});

describe("Equipment: ammunition", () => {
	it("Recognises ammunition by its item type", () => {
		expect(isAmmunitionType("A")).toBe(true);
		expect(isAmmunitionType("A|XPHB")).toBe(true);
		expect(isAmmunitionType("AF|DMG")).toBe(true);
		expect(isAmmunitionType("R")).toBe(false);
		expect(getInventoryItemMeta({name: "Arrows (20)", type: "A|XPHB"}).isAmmo).toBe(true);
	});

	it("Recovers half of what was spent, rounded down", () => {
		expect(getAmmoRecovered(7)).toBe(3);
		expect(getAmmoRecovered(2)).toBe(1);
		expect(getAmmoRecovered(1)).toBe(0);
		expect(getAmmoRecovered(0)).toBe(0);
	});
});
