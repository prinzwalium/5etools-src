import {describe, expect, it} from "@jest/globals";
import {
	STEP_ASI,
	STEP_EXPERTISE,
	STEP_HP,
	STEP_MASTERY,
	STEP_OPTIONAL_FEATURE,
	STEP_ORIGIN_CHOICE,
	STEP_ORIGIN_FEAT,
	STEP_SPELLS,
	STEP_SUBCLASS,
	STEP_TRAIT_CHOICE,
	getOutstandingDecisions,
} from "../../js/charactersheet/charactersheet-buildsteps.js";

/**
 * What the guided setup has to walk somebody through before a character can be played.
 *
 * The guide used to stop after species, class, background, abilities and equipment — which hands
 * back a level-5 Cleric with no subclass, no Ability Score Improvement and no spells, none of it
 * mentioned. These are the decisions it missed.
 */

const kindsOf = decisions => decisions.map(it => it.kind);

/** A class whose subclass arrives at level 3 and which takes an ASI at 4. */
const ROGUE = {
	name: "Rogue",
	source: "XPHB",
	classFeatures: [
		[{name: "Expertise"}],
		[{name: "Cunning Action"}],
		[{name: "Rogue Subclass", gainSubclassFeature: true}],
		[{name: "Ability Score Improvement"}],
	],
	subclassTitle: "Rogue Subclass",
};

const baseState = extra => ({level: 4, classes: [], ...extra});

describe("Outstanding decisions: the class", () => {
	it("Asks for a subclass once its level has arrived", () => {
		const entry = {id: "a", name: "Rogue", level: 3, subclass: null};
		const decisions = getOutstandingDecisions({state: baseState({classes: [entry]}), loaded: [{entry, cls: ROGUE}]});
		expect(kindsOf(decisions)).toContain(STEP_SUBCLASS);
	});

	it("Does not ask before that level", () => {
		const entry = {id: "a", name: "Rogue", level: 2, subclass: null};
		const decisions = getOutstandingDecisions({state: baseState({classes: [entry]}), loaded: [{entry, cls: ROGUE}]});
		expect(kindsOf(decisions)).not.toContain(STEP_SUBCLASS);
	});

	it("Stops asking once one is chosen", () => {
		const entry = {id: "a", name: "Rogue", level: 3, subclass: {name: "Thief"}};
		const decisions = getOutstandingDecisions({state: baseState({classes: [entry]}), loaded: [{entry, cls: ROGUE}]});
		expect(kindsOf(decisions)).not.toContain(STEP_SUBCLASS);
	});

	it("Counts the ability score improvements still owed", () => {
		const entry = {id: "a", name: "Rogue", level: 4, subclass: {name: "Thief"}, asiFeatChoices: []};
		const [asi] = getOutstandingDecisions({state: baseState({classes: [entry]}), loaded: [{entry, cls: ROGUE}]})
			.filter(it => it.kind === STEP_ASI);
		expect(asi.count).toBe(1);
	});

	it("Asks for an optional feature the class grants", () => {
		const cls = {
			...ROGUE,
			optionalfeatureProgression: [{name: "Fighting Style", featureType: ["FS"], progression: [1, 1, 1, 1]}],
		};
		const entry = {id: "a", name: "Rogue", level: 3, subclass: {name: "Thief"}, optionalFeatures: []};
		const decisions = getOutstandingDecisions({state: baseState({classes: [entry]}), loaded: [{entry, cls}]});
		expect(kindsOf(decisions)).toContain(STEP_OPTIONAL_FEATURE);
	});
});

describe("Outstanding decisions: spells", () => {
	const CLERIC = {name: "Cleric", source: "XPHB", casterProgression: "full", cantripProgression: [3, 3, 3, 4, 4]};

	it("Asks a caster for the cantrips it has not chosen", () => {
		const entry = {id: "a", name: "Cleric", level: 5};
		const [spells] = getOutstandingDecisions({state: baseState({classes: [entry], spellsKnown: []}), loaded: [{entry, cls: CLERIC}]})
			.filter(it => it.kind === STEP_SPELLS);
		expect(spells.count).toBe(4);
		expect(spells.label).toMatch(/4 cantrips/);
	});

	it("Counts only what is missing", () => {
		const entry = {id: "a", name: "Cleric", level: 5};
		const spellsKnown = [
			{name: "Guidance", level: 0, className: "Cleric"},
			{name: "Sacred Flame", level: 0, className: "Cleric"},
			{name: "Bless", level: 1, className: "Cleric"},
		];
		const [spells] = getOutstandingDecisions({state: baseState({classes: [entry], spellsKnown}), loaded: [{entry, cls: CLERIC}]})
			.filter(it => it.kind === STEP_SPELLS);
		expect(spells.count).toBe(2);
	});

	it("Says nothing to a class that does not cast", () => {
		const entry = {id: "a", name: "Rogue", level: 3, subclass: {name: "Thief"}};
		const decisions = getOutstandingDecisions({state: baseState({classes: [entry]}), loaded: [{entry, cls: ROGUE}]});
		expect(kindsOf(decisions)).not.toContain(STEP_SPELLS);
	});
});

describe("Outstanding decisions: the pools and the rest", () => {
	it("Counts Expertise across every class that grants it", () => {
		const cls = {...ROGUE, classTableGroups: []};
		const entry = {id: "a", name: "Rogue", level: 3, subclass: {name: "Thief"}};
		const decisions = getOutstandingDecisions({
			state: baseState({classes: [entry], skill_stealth: 1}),
			loaded: [{entry, cls}],
		});
		// Rogue 1 grants two Expertise skills, and none has been doubled
		const expertise = decisions.find(it => it.kind === STEP_EXPERTISE);
		expect(expertise?.count).toBe(2);
	});

	it("Asks for hit points only while there are none", () => {
		expect(kindsOf(getOutstandingDecisions({state: baseState({hpMax: 0})}))).toContain(STEP_HP);
		expect(kindsOf(getOutstandingDecisions({state: baseState({hpMax: 38})}))).not.toContain(STEP_HP);
	});

	it("Asks for an origin feat the background grants and nobody took", () => {
		const backgroundEnt = {name: "Sailor", feats: [{"tavern brawler|xphb": true}]};
		const decisions = getOutstandingDecisions({state: baseState({hpMax: 10}), backgroundEnt});
		expect(kindsOf(decisions)).toContain(STEP_ORIGIN_FEAT);
	});

	it("And stops once it is taken", () => {
		const backgroundEnt = {name: "Sailor", feats: [{"tavern brawler|xphb": true}]};
		const state = baseState({hpMax: 10, originFeats: [{name: "Tavern Brawler", source: "XPHB", from: "Sailor"}]});
		expect(kindsOf(getOutstandingDecisions({state, backgroundEnt}))).not.toContain(STEP_ORIGIN_FEAT);
	});

	// The 2024 Human: "an Origin feat of your choice", counted against feats taken *for it*
	it("Tells one entity's feat from another's", () => {
		const speciesEnt = {name: "Human", feats: [{anyFromCategory: {category: ["O"], count: 1}}]};
		const backgroundEnt = {name: "Sailor", feats: [{"tavern brawler|xphb": true}]};
		const state = baseState({hpMax: 10, originFeats: [{name: "Tavern Brawler", source: "XPHB", from: "Sailor"}]});

		const decisions = getOutstandingDecisions({state, speciesEnt, backgroundEnt});
		expect(decisions.filter(it => it.kind === STEP_ORIGIN_FEAT).map(it => it.detail)).toEqual(["Human"]);
	});

	it("Has nothing to say about a character with nothing picked", () => {
		expect(getOutstandingDecisions({state: baseState({hpMax: 8})})).toEqual([]);
	});

	it("Copes with no arguments at all", () => {
		expect(kindsOf(getOutstandingDecisions())).toContain(STEP_HP);
		expect(kindsOf(getOutstandingDecisions({}))).not.toContain(STEP_MASTERY);
	});
});

/**
 * The other half of what a species asks. An Elf's Lineage decides a cantrip and a speed, a
 * Dragonborn's Ancestry a damage type and a breath weapon — and nothing listed them, so a guided
 * Elf reached the table with a trait that had never been answered.
 */
describe("Outstanding decisions: 'choose one of the following' traits", () => {
	const ELF = {
		name: "Elf",
		entries: [
			{
				name: "Elven Lineage",
				entries: [
					"You are part of a lineage that grants you supernatural boons. Choose one of the following options:",
					{type: "list", items: [{name: "Drow", entries: ["…"]}, {name: "High Elf", entries: ["…"]}, {name: "Wood Elf", entries: ["…"]}]},
				],
			},
		],
	};

	it("Asks for a lineage nobody has picked", () => {
		const decisions = getOutstandingDecisions({state: baseState({hpMax: 10}), speciesEnt: ELF});
		expect(decisions.filter(it => it.kind === STEP_TRAIT_CHOICE).map(it => it.label)).toEqual(["Elven Lineage"]);
	});

	it("And stops once it is picked", () => {
		const state = baseState({hpMax: 10, traitChoices: [{source: "Elf", trait: "Elven Lineage", option: "Wood Elf"}]});
		expect(kindsOf(getOutstandingDecisions({state, speciesEnt: ELF}))).not.toContain(STEP_TRAIT_CHOICE);
	});
});

/**
 * The same proficiency cannot be gained twice — a skill records a state, not a count, so the second
 * grant lands on a ticked box and is simply lost. A choice with nothing left to offer is spent.
 */
describe("Outstanding decisions: a choice the character has outgrown", () => {
	const HALF_ELF = {name: "Half-Elf", skillProficiencies: [{choose: {from: ["perception", "stealth"], count: 1}}]};

	it("Still asks while an option remains", () => {
		const state = baseState({hpMax: 10, skill_perception: 1});
		expect(kindsOf(getOutstandingDecisions({state, speciesEnt: HALF_ELF}))).toContain(STEP_ORIGIN_CHOICE);
	});

	it("Goes quiet once every option is already held", () => {
		const state = baseState({hpMax: 10, skill_perception: 1, skill_stealth: 1});
		expect(kindsOf(getOutstandingDecisions({state, speciesEnt: HALF_ELF}))).not.toContain(STEP_ORIGIN_CHOICE);
	});
});
