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

/* -------------------------------------------- features with uses -------------------------------------------- */

/** Every string in a feature's entries, however deeply the data nests them. */
function _collectText (node, out = []) {
	if (typeof node === "string") out.push(node);
	else if (Array.isArray(node)) node.forEach(it => _collectText(it, out));
	else if (node && typeof node === "object") ["entries", "items", "entry"].forEach(k => { if (node[k]) _collectText(node[k], out); });
	return out;
}

/**
 * How many times a feature can be used before a rest, read from what the book says.
 *
 * Not everything a character spends is a column in the class table. Magical Cunning, Arcane
 * Recovery, Action Surge, Natural Recovery, Sorcerous Restoration and fifteen others are ordinary
 * features whose limit lives in one sentence — "Once you use this feature, you can't do so again
 * until you finish a Long Rest" — and because nothing read that sentence, none of them appeared as
 * something a character could spend.
 *
 * The sentence is formulaic enough to read: it is the same phrasing in all twenty, and the handful
 * that scale say so in the same breath ("Starting at level 17, you can use it twice before a
 * rest"). Anything that does not match is left alone rather than guessed at.
 *
 * @param feature a loaded class or subclass feature (`{name, entries}`).
 * @param level the character's level in the class that granted it.
 * @return {?{label: string, value: string, kind: string, rest: string}}
 */
export function getFeatureUses (feature, level = 1) {
	if (!feature?.name) return null;
	const text = _collectText(feature.entries).join(" ");

	const mRest = /can't do so again until you finish a \{@variantrule (Short|Long) Rest/.exec(text);
	if (!mRest) return null;

	// "a Short Rest or Long Rest" — the shorter one is the one that matters
	const rest = /Short Rest/.test(text.slice(mRest.index, mRest.index + 120)) ? "short" : "long";

	let uses = 1;
	const mTwice = /Starting at level (\d+), you can use it twice/.exec(text);
	if (mTwice && Number(level) >= Number(mTwice[1])) uses = 2;

	return {label: feature.name, value: `${uses}`, kind: "uses", rest};
}

/**
 * The use-limited features a character has, as resources.
 *
 * Deduplicated by name and keeping the most generous, because a feature that improves at a later
 * level appears twice in the class data — Action Surge is granted at 2 and again at 17, and the
 * second grant is the same feature with another use.
 *
 * @param featuresByLevel `[[feature, ...], ...]` as the loader returns them, index 0 = level 1.
 * @param level the character's level in that class.
 */
export function getFeatureResources (featuresByLevel, level = 1) {
	const byName = new Map();

	(featuresByLevel || []).slice(0, Math.max(0, Number(level) || 0)).forEach(atLevel => {
		[atLevel].flat().filter(Boolean).forEach(feature => {
			const res = getFeatureUses(feature, level);
			if (!res) return;
			const prev = byName.get(res.label);
			if (!prev || Number(res.value) > Number(prev.value)) byName.set(res.label, res);
		});
	});

	return [...byName.values()];
}
