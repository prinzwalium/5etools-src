/**
 * Shared constants for the character sheet.
 * Kept dependency-free so both the (DOM-facing) page and the (pure) derivation logic can import them.
 */

export const CHAR_SHEET_SCHEMA_VERSION = 2;

export const CHAR_SHEET_ABILITIES = [
	["str", "Strength"],
	["dex", "Dexterity"],
	["con", "Constitution"],
	["int", "Intelligence"],
	["wis", "Wisdom"],
	["cha", "Charisma"],
];

export const CHAR_SHEET_SKILLS = [
	{key: "acrobatics", name: "Acrobatics", ability: "dex"},
	{key: "animalHandling", name: "Animal Handling", ability: "wis"},
	{key: "arcana", name: "Arcana", ability: "int"},
	{key: "athletics", name: "Athletics", ability: "str"},
	{key: "deception", name: "Deception", ability: "cha"},
	{key: "history", name: "History", ability: "int"},
	{key: "insight", name: "Insight", ability: "wis"},
	{key: "intimidation", name: "Intimidation", ability: "cha"},
	{key: "investigation", name: "Investigation", ability: "int"},
	{key: "medicine", name: "Medicine", ability: "wis"},
	{key: "nature", name: "Nature", ability: "int"},
	{key: "perception", name: "Perception", ability: "wis"},
	{key: "performance", name: "Performance", ability: "cha"},
	{key: "persuasion", name: "Persuasion", ability: "cha"},
	{key: "religion", name: "Religion", ability: "int"},
	{key: "sleightOfHand", name: "Sleight of Hand", ability: "dex"},
	{key: "stealth", name: "Stealth", ability: "dex"},
	{key: "survival", name: "Survival", ability: "wis"},
];

export const PROF_STATE_NONE = 0;
export const PROF_STATE_PROFICIENT = 1;
export const PROF_STATE_EXPERTISE = 2;

/** Class-table resources that are expendable uses (label → rest that restores them). Others (Weapon
 *  Mastery, Invocations, Favored Enemy) are known-counts, not uses, so they get no tracker. */
export const EXPENDABLE_RESOURCES = {
	"Rages": "long",
	"Ki Points": "short",
	"Focus Points": "short",
	"Channel Divinity": "short",
	"Wild Shape": "short",
	"Sorcery Points": "long",
	"Superiority Dice": "short",
	"Psionic Energy Dice": "long",
	"Second Wind": "short",
	"Action Surge": "short",
	"Indomitable": "long",
	"Bardic Inspiration": "long",
};

/**
 * Exhaustion (2024): each level takes 2 off every d20 test and 5 feet off speed, and the sixth
 * level kills. The sheet applies the first two and states the third rather than enforcing it.
 */
export const EXHAUSTION_MAX_LEVEL = 6;
export const EXHAUSTION_PENALTY_PER_LEVEL = 2;
export const EXHAUSTION_SPEED_PENALTY_FT_PER_LEVEL = 5;

/** Concentration survives damage on a Constitution save of DC 10, or half the damage if higher. */
export const CONCENTRATION_MIN_DC = 10;

/** The standard conditions (Exhaustion is tracked separately as a 0–6 level). */
export const CHAR_SHEET_CONDITIONS = [
	"Blinded", "Charmed", "Deafened", "Frightened", "Grappled", "Incapacitated", "Invisible",
	"Paralyzed", "Petrified", "Poisoned", "Prone", "Restrained", "Stunned", "Unconscious",
];

let _SKILL_KEY_BY_NAME = null;

/** Map a skill name as found in data (e.g. "animal handling") to its state key (e.g. "animalHandling"). */
export function getSkillKeyByName (name) {
	if (!_SKILL_KEY_BY_NAME) {
		_SKILL_KEY_BY_NAME = {};
		CHAR_SHEET_SKILLS.forEach(({key}) => _SKILL_KEY_BY_NAME[key.toLowerCase()] = key);
	}
	const norm = String(name).replace(/[^a-z]/gi, "").toLowerCase();
	return _SKILL_KEY_BY_NAME[norm] || null;
}

/** Display name for a skill state key (e.g. "animalHandling" → "Animal Handling"). */
export function getSkillNameByKey (key) {
	return CHAR_SHEET_SKILLS.find(it => it.key === key)?.name || key;
}
