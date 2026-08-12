import * as fs from "fs";
import "../../js/parser.js";
import {
	auditCharacter,
	AUDIT_BROKEN,
	AUDIT_UNCLAIMED,
	checkMulticlassRequirements,
	groupFindings,
} from "../../js/charactersheet/charactersheet-audit.js";

const getClass = name => JSON.parse(fs.readFileSync(`./data/class/class-${name}.json`, "utf8")).class[0];

/** A character with nothing wrong with it, so each test can break exactly one thing. */
const getCleanState = (over = {}) => ({
	level: 5,
	hpMax: 38,
	classes: [{id: "a", name: "Fighter", source: "PHB", level: 5}],
	refSpecies: {name: "Dwarf", source: "PHB"},
	refBackground: {name: "Soldier", source: "PHB"},
	inventory: [],
	pendingAbilityOffers: [],
	abil_str: 16,
	abil_dex: 12,
	abil_con: 14,
	abil_int: 10,
	abil_wis: 12,
	abil_cha: 8,
	...over,
});

const keysOf = findings => findings.map(it => it.key);

describe("Audit: a character with nothing wrong", () => {
	it("Reports nothing", () => {
		expect(auditCharacter(getCleanState())).toEqual([]);
	});

	it("Tolerates being handed nothing", () => {
		expect(auditCharacter(null)).toEqual([]);
		expect(auditCharacter({}).length).toBeGreaterThan(0); // an empty character has plenty unclaimed
	});
});

describe("Audit: what breaks a rule", () => {
	it("Catches a fourth attuned item", () => {
		const inventory = [1, 2, 3, 4].map(n => ({id: `${n}`, name: `Item ${n}`, attuned: true}));
		const found = auditCharacter(getCleanState({inventory})).find(it => it.key === "attunement");
		expect(found).toMatchObject({severity: AUDIT_BROKEN});
		expect(found.message).toMatch(/Attuned to 4 items; the limit is 3/);
	});

	it("Allows exactly three", () => {
		const inventory = [1, 2, 3].map(n => ({id: `${n}`, attuned: true, name: `Item ${n}`}));
		expect(keysOf(auditCharacter(getCleanState({inventory})))).not.toContain("attunement");
	});

	it("Catches being over-encumbered, and leaves a laden-but-legal character alone", () => {
		expect(keysOf(auditCharacter(getCleanState(), {encumbrance: {totalWeightLb: 300, capacityLb: 240}}))).toContain("encumbrance");
		expect(keysOf(auditCharacter(getCleanState(), {encumbrance: {totalWeightLb: 240, capacityLb: 240}}))).not.toContain("encumbrance");
	});

	it("Catches class levels that do not add up to the character's level", () => {
		const found = auditCharacter(getCleanState({level: 6})).find(it => it.key === "level-mismatch");
		expect(found.message).toMatch(/level is 6, but the class levels add up to 5/);
	});

	it("Catches hit points never set, but not at first level", () => {
		expect(keysOf(auditCharacter(getCleanState({hpMax: 0})))).toContain("hp");
		expect(keysOf(auditCharacter(getCleanState({level: 1, hpMax: 0, classes: [{id: "a", name: "Fighter", source: "PHB", level: 1}]})))).not.toContain("hp");
	});

	it("Catches more spells prepared than allowed", () => {
		expect(keysOf(auditCharacter(getCleanState(), {counts: {preparedLimit: 6, preparedCount: 8}}))).toContain("prepared");
		expect(keysOf(auditCharacter(getCleanState(), {counts: {preparedLimit: 6, preparedCount: 6}}))).not.toContain("prepared");
	});
});

describe("Audit: multiclass prerequisites, read from the class data", () => {
	const wizard = getClass("wizard");
	const monk = getClass("monk");
	const fighter = getClass("fighter");

	it("Reads a single-ability requirement", () => {
		const req = wizard.multiclassing.requirements;
		expect(checkMulticlassRequirements(req, {abil_int: 13})).toMatchObject({isMet: true});
		expect(checkMulticlassRequirements(req, {abil_int: 12})).toMatchObject({isMet: false, text: "Intelligence 13"});
	});

	it("Requires *both* when a class names two", () => {
		const req = monk.multiclassing.requirements; // Dex 13 and Wis 13
		expect(checkMulticlassRequirements(req, {abil_dex: 13, abil_wis: 13}).isMet).toBe(true);
		expect(checkMulticlassRequirements(req, {abil_dex: 13, abil_wis: 12}).isMet).toBe(false);
		expect(checkMulticlassRequirements(req, {abil_dex: 13, abil_wis: 12}).text).toBe("Dexterity 13 and Wisdom 13");
	});

	it("Requires only *one* of an `or` group", () => {
		const req = fighter.multiclassing.requirements; // Str 13 or Dex 13
		expect(checkMulticlassRequirements(req, {abil_str: 13, abil_dex: 8}).isMet).toBe(true);
		expect(checkMulticlassRequirements(req, {abil_str: 8, abil_dex: 13}).isMet).toBe(true);
		expect(checkMulticlassRequirements(req, {abil_str: 12, abil_dex: 12})).toMatchObject({isMet: false, text: "Strength 13 or Dexterity 13"});
	});

	it("Passes a class with no requirement at all", () => {
		expect(checkMulticlassRequirements(null, {})).toEqual({isMet: true, text: ""});
		expect(checkMulticlassRequirements({}, {})).toEqual({isMet: true, text: ""});
	});

	it("Never holds the *first* class to a prerequisite", () => {
		// A Wizard 5 with Intelligence 10 is legal — you may always start as anything
		const state = getCleanState({abil_int: 10, classes: [{id: "a", name: "Wizard", source: "PHB", level: 5}]});
		const classInfos = [{name: "Wizard", requirements: wizard.multiclassing.requirements}];
		expect(keysOf(auditCharacter(state, {classInfos}))).not.toContain("multiclass:Wizard");
	});

	it("Holds a second class to it", () => {
		const state = getCleanState({
			abil_int: 10,
			level: 6,
			classes: [{id: "a", name: "Fighter", source: "PHB", level: 5}, {id: "b", name: "Wizard", source: "PHB", level: 1}],
		});
		const classInfos = [
			{name: "Fighter", requirements: fighter.multiclassing.requirements},
			{name: "Wizard", requirements: wizard.multiclassing.requirements},
		];
		const found = auditCharacter(state, {classInfos}).find(it => it.key === "multiclass:Wizard");
		expect(found).toMatchObject({severity: AUDIT_BROKEN});
		expect(found.message).toMatch(/Multiclassing into Wizard needs Intelligence 13/);
		expect(found.hint).toMatch(/DM can waive/);
	});
});

describe("Audit: what is left unclaimed", () => {
	it("Lists an ability increase that was never assigned", () => {
		const state = getCleanState({pendingAbilityOffers: [{id: "x", source: "Soldier", offer: "+2 Str"}]});
		const found = auditCharacter(state).find(it => it.key === "offer:x");
		expect(found).toMatchObject({severity: AUDIT_UNCLAIMED});
		expect(found.message).toBe("Soldier grants +2 Str, not yet assigned.");
	});

	it("Counts the choices still owed, singular and plural", () => {
		const one = auditCharacter(getCleanState(), {counts: {asiTotal: 2, asiTaken: 1}}).find(it => it.key === "asi");
		expect(one.message).toBe("1 ability score improvement or feat still to choose.");
		const two = auditCharacter(getCleanState(), {counts: {expertiseTotal: 4, expertiseTaken: 2}}).find(it => it.key === "expertise");
		expect(two.message).toBe("2 Expertise skills still to choose.");
	});

	it("Says nothing once a count is met or exceeded", () => {
		expect(keysOf(auditCharacter(getCleanState(), {counts: {masteryTotal: 3, masteryTaken: 3}}))).not.toContain("mastery");
		expect(keysOf(auditCharacter(getCleanState(), {counts: {masteryTotal: 3, masteryTaken: 4}}))).not.toContain("mastery");
	});

	it("Ignores a count it was told nothing about", () => {
		expect(keysOf(auditCharacter(getCleanState(), {counts: {asiTotal: 2}}))).not.toContain("asi");
		expect(keysOf(auditCharacter(getCleanState(), {counts: {asiTaken: 0}}))).not.toContain("asi");
	});

	it("Notices the big pieces missing entirely", () => {
		const keys = keysOf(auditCharacter({level: 1}));
		expect(keys).toEqual(expect.arrayContaining(["class", "species", "background"]));
	});

	// The bug this was written for: a 2024 background's Origin feat was written into a text box as a
	// line of prose, so nothing counted it and nothing said it was missing
	it("Says when the background's origin feat was never taken", () => {
		const state = getCleanState({backgroundText: "Sailor"});
		const found = auditCharacter(state, {grantedOriginFeats: [{name: "Tavern Brawler", source: "XPHB"}]})
			.find(it => it.key === "originfeat:Tavern Brawler");
		expect(found).toMatchObject({severity: AUDIT_UNCLAIMED});
		expect(found.message).toBe("Sailor grants the origin feat Tavern Brawler, not taken.");
	});

	it("Says nothing once it has been taken", () => {
		const state = getCleanState({backgroundText: "Sailor", originFeats: [{name: "Tavern Brawler", source: "XPHB"}]});
		const keys = keysOf(auditCharacter(state, {grantedOriginFeats: [{name: "Tavern Brawler", source: "XPHB"}]}));
		expect(keys).not.toContain("originfeat:Tavern Brawler");
	});

	// A uid's case is the data's business, not the character's
	it("Matches the feat however either side spells it", () => {
		const state = getCleanState({backgroundText: "Sailor", originFeats: [{name: "Tavern Brawler", source: "xphb"}]});
		const keys = keysOf(auditCharacter(state, {grantedOriginFeats: [{name: "tavern brawler", source: "XPHB"}]}));
		expect(keys).not.toContain("originfeat:tavern brawler");
	});

	// The panel said the Human's feat was taken while the Build Check said it was owed: one counted
	// all origin feats against all grants, so the background's feat answered the species' question
	it("Counts an origin feat of your choice against the entity that granted it", () => {
		const state = getCleanState({
			backgroundText: "Sailor",
			originFeats: [{name: "Tavern Brawler", source: "XPHB", from: "Sailor"}],
		});
		const found = auditCharacter(state, {
			grantedOriginFeats: [{name: "Tavern Brawler", source: "XPHB", from: "Sailor"}],
			grantedFeatChoices: [{from: "Human", count: 1}],
		}).find(it => it.key === "originfeat:choice:Human");

		expect(found).toMatchObject({severity: AUDIT_UNCLAIMED});
		expect(found.message).toBe("Human grants 1 origin feat of your choice, not taken.");
	});

	it("Says nothing once that entity's own feat is taken", () => {
		const state = getCleanState({
			originFeats: [
				{name: "Tavern Brawler", source: "XPHB", from: "Sailor"},
				{name: "Alert", source: "XPHB", from: "Human"},
			],
		});
		const keys = keysOf(auditCharacter(state, {
			grantedOriginFeats: [{name: "Tavern Brawler", source: "XPHB", from: "Sailor"}],
			grantedFeatChoices: [{from: "Human", count: 1}],
		}));
		expect(keys).not.toContain("originfeat:choice:Human");
	});

	it("Accepts a hand-typed species or background as picked", () => {
		const keys = keysOf(auditCharacter(getCleanState({refSpecies: null, speciesText: "Automaton", refBackground: null, backgroundText: "Clockwork"})));
		expect(keys).not.toContain("species");
		expect(keys).not.toContain("background");
	});
});

describe("Audit: grouping for display", () => {
	it("Puts what is broken before what is merely unchosen, and drops empty groups", () => {
		const findings = auditCharacter(getCleanState({
			level: 6,
			pendingAbilityOffers: [{id: "x", source: "Soldier", offer: "+2 Str"}],
		}));
		const groups = groupFindings(findings);
		expect(groups.map(it => it.label)).toEqual(["Breaks a rule", "Not yet chosen"]);
		expect(groupFindings([])).toEqual([]);
		expect(groupFindings(auditCharacter(getCleanState())).length).toBe(0);
	});
});
