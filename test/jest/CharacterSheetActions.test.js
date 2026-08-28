import {buildActionEconomy, getGeneralActionEntries, getSpellSummary, normaliseCastTime} from "../../js/charactersheet/charactersheet-actions.js";

describe("Action economy: casting-time normalisation", () => {
	it("Should map a spell's time to an economy bucket", () => {
		expect(normaliseCastTime([{number: 1, unit: "action"}])).toBe("action");
		expect(normaliseCastTime([{number: 1, unit: "bonus"}])).toBe("bonus");
		expect(normaliseCastTime([{number: 1, unit: "reaction"}])).toBe("reaction");
		expect(normaliseCastTime([{number: 1, unit: "minute"}])).toBe("other");
		expect(normaliseCastTime("bonus")).toBe("bonus");
		expect(normaliseCastTime(null)).toBe("other");
	});
});

describe("Action economy: grouping", () => {
	it("Should list weapons and the Unarmed Strike as Actions", () => {
		const out = buildActionEconomy({
			attacks: [{name: "Longsword", atkBonus: 6, damage: "1d8+3 slashing"}],
			unarmed: {name: "Unarmed Strike", atkBonus: 5, damage: "3 bludgeoning"},
		});
		expect(out.action.map(a => a.label)).toEqual(["Longsword", "Unarmed Strike"]);
		expect(out.action[0].sub).toBe("+6 to hit, 1d8+3 slashing");
		expect(out.bonus).toHaveLength(0);
	});

	it("Should bucket spells by casting time, defaulting unknowns to Action and skipping long casts", () => {
		const out = buildActionEconomy({
			spells: [
				{name: "Fire Bolt", level: 0, castTime: "action"},
				{name: "Healing Word", level: 1, castTime: "bonus"},
				{name: "Shield", level: 1, castTime: "reaction"},
				{name: "Mystery", level: 2, castTime: null}, // default → action
				{name: "Detect Magic", level: 1, castTime: "other"}, // ritual/long — skipped
			],
		});
		expect(out.action.map(a => a.label).sort()).toEqual(["Fire Bolt", "Mystery"]);
		expect(out.bonus.map(a => a.label)).toEqual(["Healing Word"]);
		expect(out.reaction.map(a => a.label)).toEqual(["Shield"]);
	});

	it("Should place curated features in their economy and ignore unknown features", () => {
		const out = buildActionEconomy({
			features: ["Second Wind", "Uncanny Dodge", "Channel Divinity", "Sneak Attack", "Second Wind"],
		});
		expect(out.bonus.map(a => a.label)).toEqual(["Second Wind"]); // de-duplicated
		expect(out.reaction.map(a => a.label)).toEqual(["Uncanny Dodge"]);
		expect(out.action.map(a => a.label)).toEqual(["Channel Divinity"]);
		// "Sneak Attack" is not in the curated map → not listed as its own action
		expect([...out.action, ...out.bonus, ...out.reaction].some(a => a.label === "Sneak Attack")).toBe(false);
	});

	it("Should carry a renderable tag on features for hover links", () => {
		const out = buildActionEconomy({features: [{name: "Cunning Action", tag: "{@classFeature Cunning Action|Rogue||2}"}]});
		expect(out.bonus[0]).toMatchObject({label: "Cunning Action", kind: "feature", tag: "{@classFeature Cunning Action|Rogue||2}"});
	});
});

describe("Spell summary line", () => {
	it("Should summarise an attack cantrip with the character's spell attack", () => {
		const firebolt = {time: [{number: 1, unit: "action"}], range: {distance: {type: "feet", amount: 120}}, spellAttack: ["R"], damageInflict: ["fire"]};
		expect(getSpellSummary(firebolt, {dc: 15, atkMod: 7})).toBe("Action · 120 ft. · Ranged atk +7 · Fire");
	});

	it("Should summarise a save spell with the character's DC and concentration", () => {
		const hold = {time: [{number: 1, unit: "action"}], range: {distance: {type: "feet", amount: 60}}, savingThrow: ["wisdom"], duration: [{concentration: true}]};
		expect(getSpellSummary(hold, {dc: 14, atkMod: 6})).toBe("Action · 60 ft. · WIS save DC 14 · Conc.");
	});

	it("Should handle self/touch ranges and bonus-action timing, and empty for no entity", () => {
		expect(getSpellSummary({time: [{number: 1, unit: "bonus"}], range: {distance: {type: "self"}}})).toBe("Bonus · Self");
		expect(getSpellSummary({time: [{number: 1, unit: "action"}], range: {distance: {type: "touch"}}})).toBe("Action · Touch");
		expect(getSpellSummary(null)).toBe("");
	});
});

/*
 * What *any* character can do on their turn — Dash, Dodge, Hide, Ready, Two-Weapon Fighting.
 *
 * Read from the book's own action list rather than written out here, because the two editions
 * differ in ways nobody should be holding in their head: 2024 split Search into Study and
 * Influence, and moved Grapple and Shove onto the Unarmed Strike.
 */
describe("Action economy: what anyone can do", () => {
	const ACTIONS = [
		{name: "Dash", source: "XPHB", time: [{number: 1, unit: "action"}]},
		{name: "Dash", source: "PHB", time: [{number: 1, unit: "action"}]},
		{name: "Two-Weapon Fighting", source: "XPHB", time: [{number: 1, unit: "bonus"}]},
		{name: "Opportunity Attack", source: "XPHB", time: [{number: 1, unit: "reaction"}]},
		{name: "Study", source: "XPHB", time: [{number: 1, unit: "action"}]},
		{name: "Search", source: "PHB", time: [{number: 1, unit: "action"}]},
		{name: "Grapple", source: "PHB", time: [{number: 1, unit: "action"}]},
		// The sheet says these better itself, as the character's own weapons and spells
		{name: "Attack", source: "XPHB", time: [{number: 1, unit: "action"}]},
		{name: "Magic", source: "XPHB", time: [{number: 1, unit: "action"}]},
		// Another book's optional variant, and not something every character has
		{name: "Disarm", source: "DMG", time: [{number: 1, unit: "action"}]},
	];

	const labels = opts => getGeneralActionEntries(ACTIONS, opts).map(it => it.label);

	it("Should read the edition the character is playing", () => {
		expect(labels({})).toContain("Study");
		expect(labels({})).not.toContain("Search");
		expect(labels({isClassic: true})).toContain("Search");
		expect(labels({isClassic: true})).not.toContain("Study");
	});

	it("Should leave out what the sheet already lists better, and another book's variants", () => {
		const shown = labels({});
		expect(shown).not.toContain("Attack");
		expect(shown).not.toContain("Magic");
		expect(shown).not.toContain("Disarm");
	});

	it("Should bucket each by what it costs", () => {
		const byLabel = Object.fromEntries(getGeneralActionEntries(ACTIONS, {}).map(it => [it.label, it.bucket]));
		expect(byLabel["Dash"]).toBe("action");
		expect(byLabel["Two-Weapon Fighting"]).toBe("bonus");
		expect(byLabel["Opportunity Attack"]).toBe("reaction");
	});

	// 2024 made both an option on an Unarmed Strike, so they are in the variant rules and not here
	it("Should still offer Grapple and Shove under the 2024 rules", () => {
		expect(labels({})).toEqual(expect.arrayContaining(["Grapple", "Shove"]));
		// 2014 has them as actions of their own, so they come from the data and are not duplicated
		expect(labels({isClassic: true}).filter(it => it === "Grapple")).toHaveLength(1);
	});

	it("Should include jumping, which costs no action and is looked up constantly", () => {
		const jump = getGeneralActionEntries(ACTIONS, {}).find(it => it.label === "Jump");
		expect(jump.bucket).toBe("free");
		expect(jump.sub).toMatch(/Str score in feet/);
	});
});

/*
 * A feature reaches the turn helper by what the book says about it, not only by being on a list of
 * twenty names somebody wrote down.
 */
describe("Action economy: features that say when they happen", () => {
	it("Takes the feature's own bucket over the curated map", () => {
		const econ = buildActionEconomy({
			attacks: [], spells: [],
			features: [{name: "Hand of Harm", bucket: "bonus", cost: {resource: "Ki", label: "Ki Points", amount: 1}, sub: "Costs 1 Ki Point"}],
		});
		expect(econ.bonus.map(it => it.label)).toEqual(["Hand of Harm"]);
		expect(econ.bonus[0].sub).toBe("Costs 1 Ki Point");
		expect(econ.bonus[0].cost).toEqual({resource: "Ki", label: "Ki Points", amount: 1});
	});

	it("Falls back to the curated map where the book does not say", () => {
		const econ = buildActionEconomy({attacks: [], spells: [], features: [{name: "Rage", bucket: null}]});
		expect(econ.bonus.map(it => it.label)).toEqual(["Rage"]);
	});

	it("Leaves out a feature that is neither", () => {
		const econ = buildActionEconomy({attacks: [], spells: [], features: [{name: "Psionic Strike", bucket: null}]});
		expect([...econ.action, ...econ.bonus, ...econ.reaction]).toEqual([]);
	});

	it("Still accepts a plain name", () => {
		const econ = buildActionEconomy({attacks: [], spells: [], features: ["Action Surge"]});
		expect(econ.action.map(it => it.label)).toEqual(["Action Surge"]);
	});
});
