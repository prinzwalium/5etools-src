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
 * @param featureVariants the class entry's taken optional features; an untaken one is not a resource.
 */
export function getFeatureResources (featuresByLevel, level = 1, {featureVariants = []} = {}) {
	const byName = new Map();
	const isTakenVariant = feature => annotateVariantFeatures([{feature}], featureVariants)[0].isVariantTaken;

	(featuresByLevel || []).slice(0, Math.max(0, Number(level) || 0)).forEach(atLevel => {
		[atLevel].flat().filter(Boolean).forEach(feature => {
			if (isVariantClassFeature(feature) && !isTakenVariant(feature)) return;
			const res = getFeatureUses(feature, level);
			if (!res) return;
			const prev = byName.get(res.label);
			if (!prev || Number(res.value) > Number(prev.value)) byName.set(res.label, res);
		});
	});

	return [...byName.values()];
}

/* -------------------------------------------- optional (variant) class features -------------------------------------------- */

/**
 * Tasha's optional class features are flagged `isClassFeatureVariant`, and the data references them
 * from `classFeatures` *alongside the features they replace* — the level-1 Ranger list is Favored
 * Enemy, Favored Foe, Natural Explorer, Deft Explorer, in that order. Nothing read the flag, so a
 * Ranger was granted all four: both halves of two either/or pairs, and the replaced feature still
 * counted. They are a permission the table gives, not a grant, so they are opted into per class
 * entry and what they replace is then suppressed.
 *
 * The book states the replacement in the feature's own italic header —
 * `{@i 8th-level cleric {@variantrule optional class features|tce|optional feature}, which replaces
 * the Divine Strike feature}` — in the same phrasing in all seven cases, so it is read rather than
 * curated.
 */

/** The italic "Nth-level <class> optional feature, which replaces ..." line, if the feature has one. */
function _getVariantHeaderText (feature) {
	return _collectText(feature?.entries)
		.find(it => /^\{@i .*(?:optional class features\|tce|variant feature)/.test(it)) || null;
}

export function isVariantClassFeature (feature) {
	return !!feature?.isClassFeatureVariant;
}

/**
 * The names of the features this variant replaces — `["Natural Explorer"]` for Deft Explorer, and
 * `[]` for the majority, which are additions rather than swaps ("Steady Aim", "Wild Companion", ...).
 */
export function getVariantReplacedNames (feature) {
	if (!isVariantClassFeature(feature)) return [];
	const header = _getVariantHeaderText(feature);
	if (!header) return [];
	// Non-greedy: Favored Foe's header runs on into "and works with the Foe Slayer feature"
	const m = /which replaces the (.+?) feature/.exec(header);
	return m ? [m[1]] : [];
}

/**
 * The variant a variant depends on. "Deft Explorer Improvement" (levels 6 and 10) is not a feature
 * anyone takes: it is the rest of Deft Explorer, arriving later, and it carries no header of its
 * own. Taking it separately would be a choice the book does not offer, so it follows its parent.
 */
export function getVariantParentName (feature) {
	if (!isVariantClassFeature(feature)) return null;
	if (_getVariantHeaderText(feature)) return null;
	const m = /^(.+) Improvement$/.exec(feature?.name || "");
	return m ? m[1] : null;
}

/** Stable identity for a taken variant, matching how the class entry stores it. */
export function isSameVariant (a, b) {
	return !!a && !!b && a.name === b.name && a.source === b.source;
}

/**
 * Split a class's feature timeline into what the character actually has and what the variant rules
 * are still offering.
 *
 * @param timeline `[{level, feature, isSubclassFeature}, ...]` in gain order.
 * @param taken the class entry's `featureVariants` — `[{name, source}, ...]`.
 * @return each timeline entry annotated with `{isVariant, isVariantTaken, replacedBy}`.
 *   `isVariantTaken` is false for an untaken option; `replacedBy` names the taken variant that
 *   supersedes a base feature. Either one means the character does not have that feature.
 */
export function annotateVariantFeatures (timeline, taken = []) {
	const takenList = (taken || []).filter(it => it?.name);

	// A parent's toggle carries its "... Improvement" entries, which are stored under no name of
	// their own; everything else matches on name, and on source when both sides carry one
	const isTaken = feature => {
		const parent = getVariantParentName(feature);
		if (parent) return takenList.some(it => it.name === parent);
		return takenList.some(it => it.name === feature?.name
			&& (!it.source || !feature?.source || it.source === feature.source));
	};

	const replacedBy = new Map();
	(timeline || []).forEach(({feature}) => {
		if (!isVariantClassFeature(feature) || !isTaken(feature)) return;
		getVariantReplacedNames(feature).forEach(replaced => replacedBy.set(replaced, feature.name));
	});

	return (timeline || []).map(meta => {
		const isVariant = isVariantClassFeature(meta.feature);
		return {
			...meta,
			isVariant,
			isVariantTaken: isVariant ? isTaken(meta.feature) : false,
			replacedBy: isVariant ? null : (replacedBy.get(meta.feature?.name) ?? null),
		};
	});
}

/** The annotated timeline reduced to what the character actually gained. */
export function filterActiveFeatures (annotated) {
	return (annotated || []).filter(it => (it.isVariant ? it.isVariantTaken : !it.replacedBy));
}

/* -------------------------------------------- what a feature costs -------------------------------------------- */

/**
 * What using a feature spends, from its own `consumes`.
 *
 * A hundred and thirty-seven features carry this — `{name: "Channel Divinity"}`,
 * `{name: "Ki", amount: 2}`, and one `{name: "Sorcery Point", amountMin: 1, amountMax: 5}` (Bastion
 * of Law) — and none of it was read. What stood in its place was a nine-line map from a feature's
 * name to the resource it spent, which covered Flurry of Blows and Patient Defense and nothing a
 * subclass added: a Way of Mercy monk's Hand of Harm, a Twilight cleric's Channel Divinity, a Psi
 * Warrior's whole subclass. The data says all of it.
 *
 * `amount` absent means one. A range means the player chooses how much to put in, so the low end is
 * what it takes to use at all.
 *
 * @return {?{resource: string, amount: number, amountMin: ?number, amountMax: ?number}}
 */
export function getFeatureCost (feature) {
	const consumes = feature?.consumes;
	if (!consumes || typeof consumes !== "object" || !consumes.name) return null;

	const min = Number(consumes.amountMin);
	const max = Number(consumes.amountMax);
	if (!isNaN(min) && !isNaN(max)) return {resource: consumes.name, amount: min, amountMin: min, amountMax: max};

	const n = Number(consumes.amount);
	return {resource: consumes.name, amount: isNaN(n) || !n ? 1 : n, amountMin: null, amountMax: null};
}

/**
 * When a feature is used, if the book says so in the one phrase that always states it.
 *
 * "As a Bonus Action, you can spend 1 Focus Point…" — fifty-six of the features that spend
 * something say which part of the turn they take, which is fifty-six more than the curated map in
 * `charactersheet-actions.js` knew. The other eighty-one do not say, because they are riders on
 * something else (Psionic Strike happens on a hit) or sub-options of a parent feature that already
 * said it — so they are left alone rather than guessed into the Action column.
 *
 * @return {?("action"|"bonus"|"reaction")}
 */
export function getFeatureActionBucket (feature) {
	const text = _collectText(feature?.entries).join(" ");
	const m = /\bas an? (bonus action|reaction|magic action|action)\b/i.exec(text);
	if (!m) return null;
	switch (m[1].toLowerCase()) {
		case "bonus action": return "bonus";
		case "reaction": return "reaction";
		default: return "action";
	}
}
