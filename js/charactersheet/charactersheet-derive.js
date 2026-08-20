import {
	CHAR_SHEET_ABILITIES,
	CHAR_SHEET_SKILLS,
	CONCENTRATION_MIN_DC,
	EXHAUSTION_MAX_LEVEL,
	EXHAUSTION_PENALTY_PER_LEVEL,
	EXHAUSTION_SPEED_PENALTY_FT_PER_LEVEL,
	PROF_STATE_EXPERTISE,
	PROF_STATE_PROFICIENT,
} from "./charactersheet-consts.js";
import {getChosenFeatureEffects, getChosenFeatureNames, getFeatureInitiativeParts} from "./charactersheet-features.js";
import {PG_OPT_FEATURES, getItemCitation} from "./charactersheet-citations.js";
import {getExpectedHp} from "./charactersheet-levelengine.js";
import {getCarryMultiplier} from "./charactersheet-appearance.js";

/**
 * Pure derivation of renderable stats from character state.
 *
 * `deriveCharacterSheet(state)` is deterministic and side-effect-free: it never touches the DOM,
 * never mutates its input, and depends only on `Parser` for the ability score-to-modifier mapping.
 * This is the seam the leveling engine (roadmap Phase 2) plugs into, and what unit tests exercise.
 */

const _MAX_LEVEL = 20;

/**
 * A breakdown is the list of contributions behind a derived number, so the sheet can explain where
 * a value came from ("Dexterity +3, Proficiency +2, Archery +2"). Zero-value parts are dropped
 * unless they carry an explanatory note.
 *
 * A part may also carry `cite`: which rule allows it to be there, either a key into `CITATIONS` or
 * a `{name, source, page}` descriptor for an entity the character actually has. The producer names
 * its own rule — nothing downstream tries to infer one from the label.
 */
function _mkParts (...parts) {
	return parts.filter(p => p && (p.value || p.isKeep || p.isText));
}

/**
 * Render a breakdown as a one-line explanation, e.g. "Dexterity +3, Proficiency +2 = +5".
 * @param opts.isTotalValue the total is a value rather than a bonus (AC, a save DC, passive
 *        Perception), so it is shown unsigned.
 */
export function formatBreakdown (parts, total, {isTotalValue = false} = {}) {
	const fmtTotal = n => isTotalValue ? `${n}` : _fmtSigned(n);
	if (!parts?.length) return total == null ? "" : fmtTotal(total);
	const ptParts = parts
		.map(p => p.isText ? p.label : `${p.label} ${p.isRaw ? p.value : _fmtSigned(p.value)}`)
		.join(", ");
	return total == null ? ptParts : `${ptParts} = ${fmtTotal(total)}`;
}

function _fmtSigned (n) { return `${n >= 0 ? "+" : "\u2212"}${Math.abs(n)}`; }

/**
 * What worn gear does to an ability score.
 *
 * Two shapes, both the data's own (`ability` on an item):
 *  - `{static: {str: 21}}` — a Belt of Giant Strength, a Headband of Intellect, an Amulet of Health.
 *    The score *becomes* that number, and the item does nothing at all for somebody already at or
 *    above it, which is why it is a floor rather than an assignment.
 *  - `{str: 2}` — a flat increase: a Belt of Dwarvenkind, the Ioun Stones. Capped at 20, the rule
 *    every one of them prints. (A handful in the books name a higher cap in their prose; the data
 *    does not carry it, and 20 is the honest default rather than a guess per item.)
 *
 * Only while equipped, and only while attuned if the item asks for it — a belt in your pack makes
 * nobody stronger, and every item in this family requires attunement.
 */
export function getItemAbilityEffects (state, abv) {
	const adds = [];
	const sets = [];
	(state?.inventory || [])
		.filter(it => it?.equipped && (!it.requiresAttunement || it.attuned))
		.forEach(it => {
			const ability = it.ability;
			if (!ability || typeof ability !== "object") return;

			const setTo = Number(ability.static?.[abv]) || 0;
			if (setTo) sets.push({kind: "set", value: setTo, name: it.name, item: it});

			const add = Number(ability[abv]) || 0;
			if (add) adds.push({kind: "add", value: add, name: it.name, item: it});
		});

	// Increases first, then the floors — so a Belt of Giant Strength still does nothing to somebody
	// an Ioun Stone has already carried past it, whichever order the two are worn in
	return [...adds, ...sets];
}

/** The cap on a flat ability increase from an item, and the one every such item prints. */
const _ITEM_ABILITY_MAX = 20;

/** One gear effect applied to a running score. The single rule both the score and its parts fold. */
function _applyItemAbilityEffect (score, effect) {
	return effect.kind === "set"
		? Math.max(score, effect.value)
		: Math.min(_ITEM_ABILITY_MAX, score + effect.value);
}

/**
 * An ability score as it actually is: what the character built, then what they are wearing.
 *
 * Everything that reads a score goes through here rather than `state.abil_*` — a Headband of
 * Intellect that raised the number on the sheet but not the Arcana check under it would be worse
 * than no headband. The *base* is still what the builder edits and what point buy counts; this is
 * the number the rules use.
 */
export function getAbilityScore (state, abv) {
	const base = Number(state?.[`abil_${abv}`]) || 10;
	return getItemAbilityEffects(state, abv).reduce(_applyItemAbilityEffect, base);
}

/**
 * Where an ability score came from: its base value, every recorded increase, and what is worn.
 * Increases are recorded in `abilityBonusLog` as they are applied, since scores are stored as
 * final values; anything applied before that log existed simply folds into "base".
 */
export function getAbilityScoreParts (state, abv) {
	const score = Number(state[`abil_${abv}`]) || 10;
	const log = (state.abilityBonusLog || []).filter(it => (it.bonuses || {})[abv]);
	const applied = log.reduce((acc, it) => acc + (Number(it.bonuses[abv]) || 0), 0);

	const parts = [
		{label: "Base", value: score - applied, isRaw: true},
		...log.map(it => ({label: it.source, value: Number(it.bonuses[abv]) || 0})),
	];

	// Each gear part is written as the difference it actually makes, so the breakdown still adds up
	// to the score above it — a "sets to 21" that contributed nothing shows as nothing
	let running = score;
	getItemAbilityEffects(state, abv).forEach(effect => {
		const next = _applyItemAbilityEffect(running, effect);
		if (next === running) return;
		parts.push({
			label: effect.kind === "set" ? `${effect.name} (sets to ${effect.value})` : effect.name,
			value: next - running,
			cite: getItemCitation(effect.item),
		});
		running = next;
	});

	return parts;
}

/** Total character level: the sum of class levels when structured class data exists, else the manual level field. */
export function getTotalLevel (state) {
	const classes = state.classes || [];
	const sum = classes.reduce((acc, cls) => acc + (Number(cls.level) || 0), 0);
	const raw = sum || Number(state.level) || 1;
	return Math.min(_MAX_LEVEL, Math.max(1, raw));
}

export function getProfBonus (state) {
	return 2 + Math.floor((getTotalLevel(state) - 1) / 4);
}

export function getAbilityModifier (state, abv) {
	return Parser.getAbilityModNumber(getAbilityScore(state, abv));
}

/**
 * Whether this character has spellcasting at all, from any source: a class or subclass that grants
 * slots, a species or feat grant, a magic item that carries spells, spells added by hand, or notes
 * the player wrote. Used to keep the spell panel out of a pure martial character's way.
 *
 * @param state The character state.
 * @param [opts.isClassCaster] Whether the class/subclass progression grants slots — the caller
 * computes this from the loaded class data (`getSpellcastingMeta`).
 */
export function hasSpellcasting (state, {isClassCaster = false} = {}) {
	if (!state) return false;
	if (isClassCaster) return true;
	if (state.spellAbility) return true;
	if ((state.spellsKnown || []).length) return true;
	if ((state.grantedSpellChoices || []).length) return true;
	if ((state.spellsText || "").trim()) return true;
	return (state.inventory || []).some(it => it?.grantsSpells);
}

/** Exhaustion, 0–6. At 6 the character dies, which the sheet states rather than enforces. */
export function getExhaustionLevel (state) {
	return Math.max(0, Math.min(EXHAUSTION_MAX_LEVEL, Math.floor(Number(state?.exhaustion) || 0)));
}

/**
 * What exhaustion takes off every d20 test: −2 per level (2024 rules). Ability checks, saving
 * throws and attack rolls are all d20 tests; a set value like a spell save DC is not.
 */
export function getExhaustionPenalty (state) {
	const level = getExhaustionLevel(state);
	// Guarded so a rested character's penalty is 0 rather than -0, which would print as "−0"
	return level ? -EXHAUSTION_PENALTY_PER_LEVEL * level : 0;
}

/** ... and off the character's speed: −5 feet per level. */
export function getExhaustionSpeedPenalty (state) {
	return EXHAUSTION_SPEED_PENALTY_FT_PER_LEVEL * getExhaustionLevel(state);
}

/**
 * The Constitution saving throw DC to keep concentrating after taking damage: 10, or half the
 * damage, whichever is higher.
 */
export function getConcentrationSaveDc (damage) {
	return Math.max(CONCENTRATION_MIN_DC, Math.floor((Number(damage) || 0) / 2));
}

/**
 * @param [opts.featureNames] Features the character has *gained* by levelling, which need the class
 * files and so cannot be read from state alone. Passing them is what lets a Swashbuckler's Rakish
 * Audacity reach Initiative; without them only chosen features (Fighting Styles, feats) are counted.
 */
export function deriveCharacterSheet (state, {featureNames = []} = {}) {
	const totalLevel = getTotalLevel(state);
	const pb = getProfBonus(state);
	const magic = getEquippedMagicBonuses(state);
	const exhaustion = getExhaustionPenalty(state);
	const partExhaustion = {label: `Exhaustion ${getExhaustionLevel(state)}`, value: exhaustion, cite: "exhaustion"};

	const abilities = {};
	CHAR_SHEET_ABILITIES.forEach(([abv]) => {
		const mod = getAbilityModifier(state, abv);
		abilities[abv] = {
			score: getAbilityScore(state, abv),
			mod,
			// An ability *check* is a d20 test, so exhaustion applies to it \u2014 but not to the modifier
			// the rest of the sheet is built from (a save DC is not rolled, and is unaffected)
			checkMod: mod + exhaustion,
			scoreParts: getAbilityScoreParts(state, abv),
		};
	});

	const saves = {};
	CHAR_SHEET_ABILITIES.forEach(([abv]) => {
		const isProf = !!state[`save_${abv}`];
		const mod = abilities[abv].mod + (isProf ? pb : 0) + magic.savingThrow + exhaustion;
		saves[abv] = {
			isProf,
			mod,
			parts: _mkParts(
				{label: Parser.attAbvToFull(abv), value: abilities[abv].mod, isKeep: true, cite: "abilityModifier"},
				isProf ? {label: "Proficiency", value: pb, cite: "proficiency"} : null,
				{label: "Magic items", value: magic.savingThrow, cite: _citeSoleItem(getMagicBonusItems(state, "bonusSavingThrow"))},
				partExhaustion,
			),
		};
	});

	const skills = {};
	CHAR_SHEET_SKILLS.forEach(({key, ability}) => {
		const profState = Number(state[`skill_${key}`]) || 0;
		const profMult = profState === PROF_STATE_EXPERTISE ? 2 : profState === PROF_STATE_PROFICIENT ? 1 : 0;
		const profLabel = profState === PROF_STATE_EXPERTISE ? "Expertise (2\u00d7 proficiency)" : "Proficiency";
		skills[key] = {
			profState,
			ability,
			mod: abilities[ability].mod + (pb * profMult) + exhaustion,
			parts: _mkParts(
				{label: Parser.attAbvToFull(ability), value: abilities[ability].mod, isKeep: true, cite: "abilityModifier"},
				profMult ? {label: profLabel, value: pb * profMult, cite: "proficiency"} : null,
				partExhaustion,
			),
		};
	});

	const spellAbility = state.spellAbility || null;
	const spell = spellAbility
		? {
			ability: spellAbility,
			// The DC is set, not rolled, so exhaustion leaves it alone; the attack roll is a d20 test
			dc: 8 + pb + abilities[spellAbility].mod + magic.spellSaveDc,
			atkMod: pb + abilities[spellAbility].mod + magic.spellAttack + exhaustion,
			dcParts: _mkParts(
				{label: "Base", value: 8, isRaw: true},
				{label: "Proficiency", value: pb, cite: "proficiency"},
				{label: Parser.attAbvToFull(spellAbility), value: abilities[spellAbility].mod, isKeep: true, cite: "abilityModifier"},
				{label: "Magic items", value: magic.spellSaveDc, cite: _citeSoleItem(getMagicBonusItems(state, "bonusSpellSaveDc"))},
			),
			atkParts: _mkParts(
				{label: "Proficiency", value: pb, cite: "proficiency"},
				{label: Parser.attAbvToFull(spellAbility), value: abilities[spellAbility].mod, isKeep: true, cite: "abilityModifier"},
				{label: "Magic items", value: magic.spellAttack, cite: _citeSoleItem(getMagicBonusItems(state, "bonusSpellAttack"))},
				partExhaustion,
			),
		}
		: null;

	const initMisc = Number(state.initMisc) || 0;
	// Features that add to Initiative — a Swashbuckler's Charisma, a Bard's half proficiency. Each is
	// its own part, because "Misc +4" explains nothing and this is the number people ask about
	const initFeatureParts = getFeatureInitiativeParts(
		[...featureNames, ...getChosenFeatureNames(state)],
		{abilities: Object.fromEntries(CHAR_SHEET_ABILITIES.map(([abv]) => [abv, abilities[abv].mod])), pb},
	);
	const initFeatures = initFeatureParts.reduce((acc, it) => acc + it.value, 0);

	return {
		totalLevel,
		pb,
		abilities,
		saves,
		skills,
		passivePerception: 10 + skills.perception.mod,
		passivePerceptionParts: _mkParts(
			{label: "Base", value: 10, isRaw: true, cite: "passivePerception"},
			...skills.perception.parts,
		),
		// Initiative is a Dexterity check, so exhaustion drags it down too
		initiative: abilities.dex.mod + initFeatures + initMisc + exhaustion,
		initiativeParts: _mkParts(
			{label: "Dexterity", value: abilities.dex.mod, isKeep: true, cite: "abilityModifier"},
			...initFeatureParts,
			{label: "Misc", value: initMisc},
			partExhaustion,
		),
		exhaustion: {level: getExhaustionLevel(state), penalty: exhaustion, speedPenaltyFt: getExhaustionSpeedPenalty(state)},
		spell,
		armorClass: deriveArmorClass(state),
		// Max HP is a typed value (players roll, DMs grant extras); this is what the rules would give
		hpExpected: getExpectedHp({classes: state.classes || [], conMod: abilities.con.mod}),
		unarmedStrike: getUnarmedStrike(state),
		encumbrance: getEncumbrance(state),
	};
}

/**
 * Armor Class from equipped gear and the chosen mode.
 *  - "manual": the character's typed AC value, unchanged.
 *  - otherwise: equipped body armor sets the base (Light +Dex, Medium +Dex capped, Heavy flat, plus
 *    the armor's own magic bonus); with no armor, an unarmored formula applies (10+Dex, or a
 *    Barbarian/Monk Unarmored Defense). Equipped shields and other worn magic AC bonuses stack,
 *    plus a flat misc bonus.
 * @return {{ac: number, mode: string, note: string}}
 */
export function deriveArmorClass (state) {
	const mode = state.acMode || "auto";
	if (mode === "manual") return {ac: Number(state.ac) || 10, mode, note: "manual", parts: [{label: "Manual value", value: Number(state.ac) || 10, isRaw: true}]};

	const dexMod = getAbilityModifier(state, "dex");
	const equipped = (state.inventory || []).filter(it => it.equipped);
	const armor = equipped.find(it => it.isArmor && ["LA", "MA", "HA"].includes(it.type));

	let base;
	let note;
	const baseParts = [];
	// The armour itself is the rule for its own base AC; an unarmored formula is the AC rule
	const citeArmor = armor ? getItemCitation(armor) : "armorClass";
	if (armor) {
		const armorAc = Number(armor.baseAc) || 10;
		const magic = Number(armor.bonusAc) || 0;
		baseParts.push({label: armor.name, value: armorAc, isRaw: true, cite: citeArmor});
		if (armor.type === "LA") {
			base = armorAc + dexMod + magic;
			baseParts.push({label: "Dexterity", value: dexMod, isKeep: true, cite: "abilityModifier"});
		} else if (armor.type === "MA") {
			const capped = Math.min(dexMod, armor.dexterityMax ?? 2);
			base = armorAc + capped + magic;
			baseParts.push({label: `Dexterity (max +${armor.dexterityMax ?? 2})`, value: capped, isKeep: true, cite: citeArmor});
		} else {
			base = armorAc + magic; // Heavy: no Dex
		}
		if (magic) baseParts.push({label: "Armor magic bonus", value: magic, cite: citeArmor});
		note = armor.name;
	} else if (mode === "barbarian") {
		base = 10 + dexMod + getAbilityModifier(state, "con");
		baseParts.push({label: "Unarmored Defense (Barbarian)", value: 10, isRaw: true, cite: "armorClass"},
			{label: "Dexterity", value: dexMod, isKeep: true, cite: "abilityModifier"},
			{label: "Constitution", value: getAbilityModifier(state, "con"), isKeep: true, cite: "abilityModifier"});
		note = "Unarmored Defense (Barbarian)";
	} else if (mode === "monk") {
		base = 10 + dexMod + getAbilityModifier(state, "wis");
		baseParts.push({label: "Unarmored Defense (Monk)", value: 10, isRaw: true, cite: "armorClass"},
			{label: "Dexterity", value: dexMod, isKeep: true, cite: "abilityModifier"},
			{label: "Wisdom", value: getAbilityModifier(state, "wis"), isKeep: true, cite: "abilityModifier"});
		note = "Unarmored Defense (Monk)";
	} else {
		base = 10 + dexMod;
		baseParts.push({label: "Unarmored", value: 10, isRaw: true, cite: "armorClass"},
			{label: "Dexterity", value: dexMod, isKeep: true, cite: "abilityModifier"});
		note = "Unarmored";
	}

	const shield = equipped
		.filter(it => it.type === "S")
		.reduce((acc, it) => acc + (Number(it.baseAc) || 2) + (Number(it.bonusAc) || 0), 0);
	const otherMagic = equipped
		.filter(it => !it.isArmor && it.type !== "S" && it.bonusAc)
		.reduce((acc, it) => acc + (Number(it.bonusAc) || 0), 0);
	const misc = Number(state.acMisc) || 0;
	// The Defense fighting style applies only while wearing armor
	const feature = armor ? getChosenFeatureEffects(state).acArmored : 0;
	if (feature) note = `${note} + Defense`;

	const parts = _mkParts(
		...baseParts,
		{label: "Shield", value: shield, cite: _citeSoleItem(equipped.filter(it => it.type === "S"))},
		{label: "Magic items", value: otherMagic, cite: _citeSoleItem(equipped.filter(it => !it.isArmor && it.type !== "S" && it.bonusAc))},
		{label: "Defense (fighting style)", value: feature, cite: {name: "Defense", source: "PHB", page: PG_OPT_FEATURES}},
		{label: "Misc", value: misc},
	);

	return {ac: base + shield + otherMagic + misc + feature, mode, note, parts};
}

/**
 * Sum the passive bonuses granted by *equipped* magic items: to saving throws (Cloak/Ring of
 * Protection), spell save DC, and spell attack (arcane foci, rods/wands). AC bonuses are handled
 * separately in `deriveArmorClass`.
 * @return {{savingThrow: number, spellSaveDc: number, spellAttack: number}}
 */
export function getEquippedMagicBonuses (state) {
	const out = {savingThrow: 0, spellSaveDc: 0, spellAttack: 0};
	(state.inventory || [])
		.filter(it => it.equipped)
		.forEach(it => {
			out.savingThrow += Number(it.bonusSavingThrow) || 0;
			out.spellSaveDc += Number(it.bonusSpellSaveDc) || 0;
			out.spellAttack += Number(it.bonusSpellAttack) || 0;
		});
	return out;
}

/** The equipped items actually contributing one of those bonuses, so the part can cite them. */
export function getMagicBonusItems (state, key) {
	return (state.inventory || []).filter(it => it.equipped && Number(it[key]));
}

/**
 * A "Magic items" part can only point somewhere when exactly one item is responsible. With two
 * contributing there is no single rule to show, and inventing a combined one would be a lie.
 */
function _citeSoleItem (items) {
	return items.length === 1 ? getItemCitation(items[0]) : null;
}

/**
 * Build an attack row from a weapon's stored metadata: picks the attack ability (Dex for ranged,
 * the better of Str/Dex for finesse, else Str), assumes proficiency, and folds in the weapon's magic
 * attack/damage bonuses. Returns `{name, atkBonus, damage}` matching the attacks collection shape.
 */
export function getWeaponAttack (state, item) {
	const pb = getProfBonus(state);
	const type = String(item.type || "").split("|")[0];
	const props = item.properties || [];
	const isRanged = type === "R";
	const isFinesse = props.includes("F");
	const isTwoHanded = props.includes("2H");
	const isThrown = props.includes("T");

	let abv = "str";
	if (isRanged) abv = "dex";
	else if (isFinesse) abv = getAbilityModifier(state, "dex") > getAbilityModifier(state, "str") ? "dex" : "str";
	const abilMod = getAbilityModifier(state, abv);

	// Fighting-style effects. Dueling's "no other weapon" clause can't be known from the item alone,
	// so it is applied to any one-handed melee weapon.
	const effects = getChosenFeatureEffects(state);
	const featureAttack = isRanged ? effects.rangedAttack : 0;
	const featureDamage = (!isRanged && !isTwoHanded ? effects.meleeOneHandedDamage : 0)
		+ (isThrown ? effects.thrownDamage : 0);

	const bonusAttack = Number(item.bonusAttack) || 0;
	const bonusDamage = Number(item.bonusDamage) || 0;

	let damage = "";
	if (item.dmg1) {
		const dmgTypeFull = item.dmgType ? ` ${Parser.dmgTypeToFull(item.dmgType, {styleHint: "classic"})}` : "";
		const dmgMod = abilMod + bonusDamage + featureDamage;
		const modStr = dmgMod === 0 ? "" : (dmgMod > 0 ? `+${dmgMod}` : `${dmgMod}`);
		damage = `${item.dmg1}${modStr}${dmgTypeFull}`;
	}

	const abilName = Parser.attAbvToFull(abv);
	const exhaustion = getExhaustionPenalty(state);
	return {
		name: item.name || "",
		// An attack roll is a d20 test; the damage it deals is not
		atkBonus: abilMod + pb + bonusAttack + featureAttack + exhaustion,
		damage,
		atkParts: _mkParts(
			{label: abilName, value: abilMod, isKeep: true, cite: "abilityModifier"},
			{label: "Proficiency", value: pb, cite: "proficiency"},
			{label: "Magic weapon", value: bonusAttack, cite: getItemCitation(item)},
			{label: "Archery (fighting style)", value: featureAttack, cite: {name: "Archery", source: "PHB", page: PG_OPT_FEATURES}},
			{label: `Exhaustion ${getExhaustionLevel(state)}`, value: exhaustion, cite: "exhaustion"},
		),
		damageParts: _mkParts(
			{label: item.dmg1 || "", isText: !!item.dmg1, cite: getItemCitation(item)},
			{label: abilName, value: abilMod, isKeep: true, cite: "abilityModifier"},
			{label: "Magic weapon", value: bonusDamage, cite: getItemCitation(item)},
			{label: "Fighting style", value: featureDamage},
		),
	};
}

/** The always-available Unarmed Strike: 1 + Strength modifier bludgeoning, with proficiency. */
export function getUnarmedStrike (state) {
	const strMod = getAbilityModifier(state, "str");
	const dmg = 1 + strMod;
	const pb = getProfBonus(state);
	const exhaustion = getExhaustionPenalty(state);
	return {
		name: "Unarmed Strike",
		atkBonus: strMod + pb + exhaustion,
		damage: `${Math.max(0, dmg)} bludgeoning`,
		atkParts: _mkParts(
			{label: "Strength", value: strMod, isKeep: true, cite: "abilityModifier"},
			{label: "Proficiency", value: pb, cite: "proficiency"},
			{label: `Exhaustion ${getExhaustionLevel(state)}`, value: exhaustion, cite: "exhaustion"},
		),
	};
}

/**
 * Carried weight from the inventory vs. the carrying capacity (Strength × 15).
 *
 * Doubled by **Powerful Build**, which counts a character as one size larger for carrying, pushing,
 * dragging and lifting — fifteen species have it, and every one of them was being told it could
 * carry half what it can.
 */
export function getEncumbrance (state) {
	const totalWeightLb = (state.inventory || [])
		.reduce((acc, it) => acc + ((Number(it.weightLb) || 0) * (Number(it.quantity) || 0)), 0);

	const carryMult = getCarryMultiplier(state.speciesTraitTags);

	return {
		totalWeightLb: Math.round(totalWeightLb * 100) / 100,
		// The effective score: a Belt of Giant Strength is mostly bought for what it lets you carry
		capacityLb: getAbilityScore(state, "str") * 15 * carryMult,
		isPowerfulBuild: carryMult > 1,
	};
}
