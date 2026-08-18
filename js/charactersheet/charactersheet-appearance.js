/**
 * The descriptive half of a species, which is data too.
 *
 * Thirty-five species carry a **Random Height and Weight** table — `heightAndWeight`, four numbers —
 * and sixteen carry `traitTags`, a structured summary of what their traits *do*. Both were unread:
 * the Appearance panel took height and weight as free text with no way to roll them, and the tags
 * were never looked at, including the one that changes a number (**Powerful Build**, which is worth
 * double carrying capacity and was silently costing Goliaths half of theirs).
 *
 * Pure and DOM-free: entities in, numbers out. The dice roll is injected so a test can pin it.
 */

/** The tag that doubles what a character can carry, push, drag and lift. */
export const TRAIT_TAG_POWERFUL_BUILD = "Powerful Build";

/**
 * The species' random height and weight table, or `null`.
 *
 * A `_isBaseRace` entry is the "Elf" umbrella rather than a species anybody plays, and 5etools' own
 * renderer skips it for the same reason: its subraces carry the real table.
 */
export function getHeightAndWeightTable (race) {
	const hw = race?.heightAndWeight;
	if (!hw || race._isBaseRace) return null;
	if (hw.baseHeight == null || hw.baseWeight == null) return null;
	return {
		baseHeight: Number(hw.baseHeight) || 0,
		baseWeight: Number(hw.baseWeight) || 0,
		heightMod: hw.heightMod == null ? "0" : String(hw.heightMod),
		// Absent means ×1: a species whose weight rises with height alone
		weightMod: hw.weightMod == null ? "1" : String(hw.weightMod),
	};
}

/** `"2d10"` → `{count: 2, faces: 10}`; a plain number → a fixed value; anything else → null. */
export function parseDiceExpression (expr) {
	const str = String(expr ?? "").trim().toLowerCase();
	if (!str) return null;

	const m = /^(\d*)d(\d+)$/.exec(str);
	if (m) return {count: Number(m[1] || 1), faces: Number(m[2])};

	const flat = Number(str);
	return Number.isFinite(flat) ? {count: 0, faces: 0, flat} : null;
}

/** Sum of the expression, rolled. `fnRollDie(faces)` returns 1..faces. */
export function rollDiceExpression (expr, fnRollDie) {
	const parsed = parseDiceExpression(expr);
	if (!parsed) return 0;
	if (parsed.flat != null) return parsed.flat;

	let total = 0;
	for (let i = 0; i < parsed.count; ++i) total += fnRollDie(parsed.faces);
	return total;
}

/** The smallest and largest the expression can be. */
export function getDiceExpressionRange (expr) {
	const parsed = parseDiceExpression(expr);
	if (!parsed) return {min: 0, max: 0};
	if (parsed.flat != null) return {min: parsed.flat, max: parsed.flat};
	return {min: parsed.count, max: parsed.count * parsed.faces};
}

const _defaultRollDie = faces => Math.floor(Math.random() * faces) + 1;

/**
 * Roll the species' height and weight, by the book's own rule.
 *
 * The height roll is not just added to the height — it *multiplies* the weight modifier, which is
 * why a tall member of a species is heavy out of proportion. Rolling the two independently is the
 * obvious mistake and gives a visibly wrong spread.
 *
 * @return {{heightIn, weightLb, heightRoll, weightModRoll}}
 */
export function rollHeightAndWeight (hw, {fnRollDie = _defaultRollDie} = {}) {
	if (!hw) return null;

	const heightRoll = rollDiceExpression(hw.heightMod, fnRollDie);
	const weightModRoll = rollDiceExpression(hw.weightMod, fnRollDie);

	return {
		heightRoll,
		weightModRoll,
		heightIn: hw.baseHeight + heightRoll,
		weightLb: Math.round((hw.baseWeight + (weightModRoll * heightRoll)) * 100) / 100,
	};
}

/** What the table can produce, for a "4'8"–6'0"" hint beside the button. */
export function getHeightAndWeightRange (hw) {
	if (!hw) return null;
	const height = getDiceExpressionRange(hw.heightMod);
	const weight = getDiceExpressionRange(hw.weightMod);
	return {
		minHeightIn: hw.baseHeight + height.min,
		maxHeightIn: hw.baseHeight + height.max,
		minWeightLb: hw.baseWeight + (weight.min * height.min),
		maxWeightLb: hw.baseWeight + (weight.max * height.max),
	};
}

/** Inches as feet and inches — `68` → `5'8"`. */
export function formatHeight (inches) {
	const total = Math.round(Number(inches) || 0);
	const feet = Math.floor(total / 12);
	const rem = total % 12;
	if (!feet) return `${rem}"`;
	return `${feet}'${rem ? `${rem}"` : ""}`;
}

/* -------------------------------------------- trait tags -------------------------------------------- */

/** The species' `traitTags`, cleaned up. */
export function getTraitTags (race) {
	return [race?.traitTags].flat().filter(Boolean).map(it => String(it).trim()).filter(Boolean);
}

/**
 * What multiplies carrying capacity.
 *
 * Powerful Build counts you as one size larger for carrying, pushing, dragging and lifting, and one
 * size larger is double. Nothing else in the tag list changes a number, so nothing else is read
 * here — a tag whose effect is situational belongs in the trait text, where it already is.
 */
export function getCarryMultiplier (traitTags) {
	return [traitTags].flat().filter(Boolean).some(it => String(it).trim() === TRAIT_TAG_POWERFUL_BUILD)
		? 2
		: 1;
}
