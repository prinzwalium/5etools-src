import "../../js/parser.js";
import {
	annotateEconomy,
	AVAIL_BLOCKED,
	AVAIL_OK,
	AVAIL_WARN,
	getAmmoState,
	getEntryAvailability,
	getItemEntries,
	getTurnState,
	hasSlotForLevel,
} from "../../js/charactersheet/charactersheet-availability.js";

const getCtx = (over = {}) => ({
	state: {},
	turn: getTurnState({}),
	slots: [],
	pact: null,
	slotsUsed: {},
	resources: {},
	...over,
});

describe("Availability: the state of the turn", () => {
	it("Is unremarkable for a healthy character", () => {
		const turn = getTurnState({});
		expect(turn.isNoActions).toBe(false);
		expect(turn.notes).toEqual([]);
	});

	it("Knows the conditions that stop a character acting", () => {
		const turn = getTurnState({conditions: ["Stunned", "Prone"]});
		expect(turn.isNoActions).toBe(true);
		expect(turn.blockingConditions).toEqual(["Stunned"]);
		expect(turn.notes[0]).toMatch(/Stunned — no actions/);
	});

	it("Says what exhaustion is costing, and what being prone costs", () => {
		expect(getTurnState({exhaustion: 3}).notes[0]).toMatch(/−6 on every d20 test/);
		expect(getTurnState({conditions: ["Prone"]}).notes[0]).toMatch(/disadvantage/);
		expect(getTurnState({conditions: ["Restrained"]}).notes[0]).toMatch(/speed 0/);
	});

	it("Carries what is being concentrated on", () => {
		expect(getTurnState({concentration: " Bless "}).concentration).toBe("Bless");
	});
});

describe("Availability: spell slots", () => {
	const slots = [4, 3, 2]; // 1st–3rd

	it("A cantrip needs nothing", () => {
		expect(hasSlotForLevel(0, {slots: [], slotsUsed: {}})).toBe(true);
	});

	it("Casts from its own level while any are left", () => {
		expect(hasSlotForLevel(1, {slots, slotsUsed: {1: 3}})).toBe(true);
		expect(hasSlotForLevel(1, {slots, slotsUsed: {1: 4}, 2: 0})).toBe(true); // upcast into 2nd
	});

	it("Upcasts into a higher slot when its own are gone", () => {
		expect(hasSlotForLevel(1, {slots, slotsUsed: {1: 4, 2: 3}})).toBe(true); // 3rd-level slots remain
		expect(hasSlotForLevel(1, {slots, slotsUsed: {1: 4, 2: 3, 3: 2}})).toBe(false);
	});

	it("Never downcasts", () => {
		expect(hasSlotForLevel(3, {slots, slotsUsed: {3: 2}})).toBe(false);
	});

	it("Counts a pact slot when it is high enough", () => {
		expect(hasSlotForLevel(2, {slots: [], pact: {count: 2, level: 3}, slotsUsed: {}})).toBe(true);
		expect(hasSlotForLevel(2, {slots: [], pact: {count: 2, level: 3}, slotsUsed: {pact: 2}})).toBe(false);
		expect(hasSlotForLevel(4, {slots: [], pact: {count: 2, level: 3}, slotsUsed: {}})).toBe(false);
	});
});

describe("Availability: what blocks an entry", () => {
	it("Blocks a spell with no slot for it", () => {
		const ctx = getCtx({slots: [2], slotsUsed: {1: 2}});
		expect(getEntryAvailability({kind: "spell", label: "Magic Missile", spellLevel: 1}, ctx))
			.toEqual({status: AVAIL_BLOCKED, reason: "No level 1+ slots left"});
	});

	it("Lets a cantrip through regardless", () => {
		const ctx = getCtx({slots: [2], slotsUsed: {1: 2}});
		expect(getEntryAvailability({kind: "spell", label: "Fire Bolt", spellLevel: 0}, ctx).status).toBe(AVAIL_OK);
	});

	it("Warns rather than blocks when a spell would drop a running concentration", () => {
		const ctx = getCtx({slots: [2], turn: getTurnState({concentration: "Hex"})});
		expect(getEntryAvailability({kind: "spell", label: "Bless", spellLevel: 1, isConcentration: true}, ctx))
			.toEqual({status: AVAIL_WARN, reason: "Would drop Hex"});
	});

	it("Says nothing when the running concentration is the same spell", () => {
		const ctx = getCtx({slots: [2], turn: getTurnState({concentration: "Bless"})});
		expect(getEntryAvailability({kind: "spell", label: "Bless", spellLevel: 1, isConcentration: true}, ctx).status).toBe(AVAIL_OK);
	});

	it("Blocks an item with no charges left", () => {
		expect(getEntryAvailability({kind: "item", label: "Wand", chargesLeft: 0}, getCtx()))
			.toEqual({status: AVAIL_BLOCKED, reason: "No charges left"});
		expect(getEntryAvailability({kind: "item", label: "Wand", chargesLeft: 2}, getCtx()).status).toBe(AVAIL_OK);
	});

	it("Blocks a feature whose uses are spent", () => {
		const ctx = getCtx({resources: {Rages: {total: 3, used: 3}}});
		expect(getEntryAvailability({kind: "feature", label: "Rage"}, ctx))
			.toEqual({status: AVAIL_BLOCKED, reason: "No rages left"});
		expect(getEntryAvailability({kind: "feature", label: "Rage"}, getCtx({resources: {Rages: {total: 3, used: 1}}})).status).toBe(AVAIL_OK);
	});

	it("Leaves a feature with no tracked resource alone", () => {
		expect(getEntryAvailability({kind: "feature", label: "Cunning Action"}, getCtx()).status).toBe(AVAIL_OK);
	});

	it("Blocks everything while incapacitated, whatever it is", () => {
		const ctx = getCtx({turn: getTurnState({conditions: ["Unconscious"]})});
		["spell", "weapon", "feature", "item"].forEach(kind => {
			expect(getEntryAvailability({kind, label: "x", spellLevel: 0}, ctx))
				.toEqual({status: AVAIL_BLOCKED, reason: "Unconscious"});
		});
	});
});

describe("Availability: ammunition", () => {
	const getState = quantity => ({inventory: [
		{name: "Longbow", ammoType: "arrow|phb"},
		{name: "Arrows (20)", isAmmo: true, quantity},
	]});

	it("Finds the ammunition a weapon needs", () => {
		expect(getAmmoState("Longbow", getState(12))).toEqual({name: "arrow", quantity: 12, isCarried: true});
	});

	it("Blocks the attack when the quiver is empty", () => {
		const ctx = getCtx({state: getState(0)});
		expect(getEntryAvailability({kind: "weapon", label: "Longbow"}, ctx))
			.toEqual({status: AVAIL_BLOCKED, reason: "Out of arrows"});
	});

	it("Says so when none is carried at all", () => {
		const ctx = getCtx({state: {inventory: [{name: "Longbow", ammoType: "arrow|phb"}]}});
		expect(getEntryAvailability({kind: "weapon", label: "Longbow"}, ctx))
			.toEqual({status: AVAIL_BLOCKED, reason: "No arrows carried"});
	});

	it("Leaves a melee weapon alone", () => {
		expect(getAmmoState("Longsword", getState(0))).toBeNull();
		expect(getEntryAvailability({kind: "weapon", label: "Longsword"}, getCtx({state: getState(0)})).status).toBe(AVAIL_OK);
	});
});

describe("Availability: items as things you can do", () => {
	it("Offers an equipped item with charges, and counts them", () => {
		const entries = getItemEntries({inventory: [
			{name: "Wand of Fireballs", equipped: true, chargesMax: 7, chargesUsed: 2},
			{name: "Wand of Wonder", equipped: false, chargesMax: 7},
			{name: "Longsword", equipped: true},
		]});
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({label: "Wand of Fireballs", kind: "item", chargesLeft: 5, sub: "5/7 charges"});
	});
});

describe("Availability: annotating a whole economy", () => {
	it("Keeps the buckets and adds a verdict to each entry", () => {
		const economy = {
			action: [{kind: "spell", label: "Fireball", spellLevel: 3}],
			bonus: [{kind: "feature", label: "Rage"}],
			reaction: [],
		};
		const annotated = annotateEconomy(economy, getCtx({slots: [4, 3], resources: {Rages: {total: 2, used: 2}}}));
		expect(annotated.action[0]).toMatchObject({label: "Fireball", status: AVAIL_BLOCKED, reason: "No level 3+ slots left"});
		expect(annotated.bonus[0]).toMatchObject({label: "Rage", status: AVAIL_BLOCKED});
		expect(annotated.reaction).toEqual([]);
	});
});

/*
 * A feature that spends a pool says so in its own `consumes`, and how much. Both matter: a Focus
 * pool with four left can pay for Hand of Healing and not for Hand of Ultimate Mercy, and the old
 * check — is the pool empty? — called both of them fine.
 */
describe("Availability: what a feature costs", () => {
	const cost = (label, amount) => ({resource: label, label, amount});

	it("Blocks a feature the pool cannot pay for, even with some left", () => {
		const ctx = getCtx({resources: {"Focus Points": {total: 6, used: 2}}});
		expect(getEntryAvailability({kind: "feature", label: "Hand of Ultimate Mercy", cost: cost("Focus Points", 5)}, ctx))
			.toEqual({status: AVAIL_BLOCKED, reason: "Needs 5 Focus Points, 4 left"});
	});

	it("Allows one the pool can pay for", () => {
		const ctx = getCtx({resources: {"Focus Points": {total: 6, used: 2}}});
		expect(getEntryAvailability({kind: "feature", label: "Hand of Healing", cost: cost("Focus Points", 1)}, ctx).status)
			.toBe(AVAIL_OK);
	});

	it("Says the pool is empty when it is", () => {
		const ctx = getCtx({resources: {"Channel Divinity": {total: 2, used: 2}}});
		expect(getEntryAvailability({kind: "feature", label: "Turn Undead", cost: cost("Channel Divinity", 1)}, ctx))
			.toEqual({status: AVAIL_BLOCKED, reason: "No channel divinity left"});
	});

	it("Leaves a cost alone when the character holds no such pool", () => {
		// A Psi Warrior from Tasha's states its dice in prose, so there is no column to check against;
		// reporting it blocked would be a guess in the wrong direction
		const entry = {kind: "feature", label: "Psionic Strike", cost: {resource: "Psionic Energy Die", label: null, amount: 1}};
		expect(getEntryAvailability(entry, getCtx()).status).toBe(AVAIL_OK);
	});

	it("Still falls back to a feature that is its own limit", () => {
		const ctx = getCtx({resources: {Rages: {total: 3, used: 3}}});
		expect(getEntryAvailability({kind: "feature", label: "Rage"}, ctx).status).toBe(AVAIL_BLOCKED);
	});
});
