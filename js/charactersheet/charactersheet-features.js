/**
 * Curated mechanical effects of features that live as prose in the data (so they can't be read
 * structurally). Kept small and unambiguous: an entry carries the numeric effects the sheet can
 * apply on its own, plus a short `desc` for the ones that are conditional or need a decision at
 * the table. Anything not listed here stays a plain linked feature reference.
 *
 * Fighting Style names are shared between the 2014 optional features and the 2024 `category: "FS"`
 * feats, so one map covers both.
 */
export const FEATURE_EFFECTS = {
	/* ---- Fighting Styles: numeric ---- */
	"Archery": {rangedAttack: 2, desc: "+2 to ranged weapon attack rolls"},
	"Defense": {acArmored: 1, desc: "+1 AC while wearing armor"},
	"Dueling": {meleeOneHandedDamage: 2, desc: "+2 damage with a one-handed melee weapon (and no other weapon)"},
	"Thrown Weapon Fighting": {thrownDamage: 2, desc: "+2 damage with thrown weapons"},

	/* ---- Fighting Styles: conditional / player-decided, surfaced as notes ---- */
	"Great Weapon Fighting": {desc: "reroll 1s and 2s on damage with a two-handed melee weapon"},
	"Two-Weapon Fighting": {desc: "add your ability modifier to off-hand damage"},
	"Blind Fighting": {desc: "blindsight 10 ft."},
	"Interception": {desc: "reaction: reduce damage to a creature within 5 ft."},
	"Protection": {desc: "reaction: impose disadvantage on an attack against a nearby ally"},
	"Unarmed Fighting": {desc: "unarmed strikes deal d6 (d8 with no weapon or shield)"},
	"Blessed Warrior": {desc: "learn two Cleric cantrips"},
	"Druidic Warrior": {desc: "learn two Druid cantrips"},
	"Superior Technique": {desc: "learn one Battle Master maneuver and gain a superiority die"},

	/* ---- Hit points per level ---- */
	// Read from prose, because that is where it lives: a feat that says "your hit point maximum
	// increases by 2 whenever you gain a level" is a number the sheet can apply, and rolling for hit
	// points is where somebody notices it is missing
	"Tough": {hpPerLevel: 2, desc: "+2 hit points per level"},
	"Dwarven Toughness": {hpPerLevel: 1, desc: "+1 hit point per level"},
	"Draconic Resilience": {hpPerLevel: 1, desc: "+1 hit point per Sorcerer level"},

	/* ---- Initiative ---- */
	"Rakish Audacity": {initiativeAbility: "cha", desc: "add Charisma to Initiative"}, // Rogue (Swashbuckler)
	"Jack of All Trades": {initiativeHalfProf: true, desc: "add half proficiency to Initiative"}, // Bard
};

/**
 * The names of every feature the character has actively *chosen* — Fighting Styles and other
 * optional features, ASI-slot feats, feats granted by a class feature, and background origin feats.
 * Features simply gained by levelling need the async class data, so they are loaded separately and
 * reach this map through `getFeatureInitiativeBonus`.
 */
export function getChosenFeatureNames (state) {
	const out = [];
	(state?.classes || []).forEach(cls => {
		(cls.optionalFeatures || []).forEach(it => { if (it?.name) out.push(it.name); });
		(cls.asiFeatChoices || []).forEach(it => { if (it?.type === "feat" && it.name) out.push(it.name); });
	});
	(state?.featureFeats || []).forEach(it => { if (it?.name) out.push(it.name); });
	(state?.originFeats || []).forEach(it => { if (it?.name) out.push(it.name); });
	(state?.manualFeats || []).forEach(it => { if (it?.name) out.push(it.name); });
	return [...new Set(out)];
}

/**
 * Hit points a character's features add *per level*.
 *
 * Only the unambiguous ones, and only those that scale with level — a flat one-off increase is not
 * this. Used when hit points are rolled, so what the sheet adds to the dice is everything the
 * character is owed rather than Constitution alone.
 */
export function getHpBonusPerLevel (state) {
	return getChosenFeatureNames(state)
		.reduce((acc, name) => acc + (FEATURE_EFFECTS[name]?.hpPerLevel || 0), 0);
}

/**
 * Aggregate the curated effects of a set of feature names.
 * @return {{rangedAttack: number, acArmored: number, meleeOneHandedDamage: number,
 *           thrownDamage: number, notes: Array<{name: string, desc: string}>}}
 */
export function getFeatureEffects (featureNames) {
	const out = {rangedAttack: 0, acArmored: 0, meleeOneHandedDamage: 0, thrownDamage: 0, notes: []};
	const seen = new Set();
	(featureNames || []).forEach(name => {
		if (seen.has(name)) return;
		seen.add(name);
		const eff = FEATURE_EFFECTS[name];
		if (!eff) return;
		out.rangedAttack += eff.rangedAttack || 0;
		out.acArmored += eff.acArmored || 0;
		out.meleeOneHandedDamage += eff.meleeOneHandedDamage || 0;
		out.thrownDamage += eff.thrownDamage || 0;
		if (eff.desc) out.notes.push({name, desc: eff.desc});
	});
	return out;
}

/** The curated effects of everything the character has chosen, straight from state. */
export function getChosenFeatureEffects (state) {
	return getFeatureEffects(getChosenFeatureNames(state));
}

/**
 * What each feature adds to Initiative, as its own breakdown part.
 *
 * One part per feature rather than one total, because Initiative is the number people most often
 * ask to have explained, and "Misc +4" answers nothing. A part with no value is dropped: a
 * Swashbuckler with Charisma 10 gains nothing from Rakish Audacity, and saying "+0" is noise.
 *
 * @param featureNames the character's feature names (gained + chosen)
 * @param ctx `{abilities: {abv: mod}, pb}`
 * @return {Array<{label: string, value: number}>}
 */
export function getFeatureInitiativeParts (featureNames, {abilities = {}, pb = 0} = {}) {
	const out = [];
	const seen = new Set();
	(featureNames || []).forEach(name => {
		if (seen.has(name)) return;
		seen.add(name);
		const eff = FEATURE_EFFECTS[name];
		if (!eff) return;

		if (eff.initiativeAbility) out.push({label: name, value: Number(abilities[eff.initiativeAbility]) || 0});
		if (eff.initiativeHalfProf) out.push({label: name, value: Math.floor(pb / 2)});
	});
	return out.filter(it => it.value);
}

/**
 * Total Initiative bonus from the character's features.
 * @param featureNames the character's feature names (gained + chosen)
 * @param ctx `{abilities: {abv: mod}, pb}`
 */
export function getFeatureInitiativeBonus (featureNames, ctx) {
	return getFeatureInitiativeParts(featureNames, ctx).reduce((acc, it) => acc + it.value, 0);
}
