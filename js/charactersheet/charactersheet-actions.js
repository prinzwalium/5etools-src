/**
 * Pure derivation of the action economy (Actions / Bonus Actions / Reactions) shown in Play mode.
 *
 * Sources, in order of reliability:
 *  - weapon attacks and the Unarmed Strike (always the Attack action),
 *  - known/prepared spells, bucketed by their casting time,
 *  - a small curated map of common class/feat features whose action economy is unambiguous.
 * Anything not covered is left to the linked feature/spell references elsewhere on the sheet.
 */

/** Curated feature → action economy. Kept deliberately small and to unambiguous cases. */
export const FEATURE_ACTION_ECONOMY = {
	// Bonus actions
	"Second Wind": "bonus",
	"Rage": "bonus",
	"Cunning Action": "bonus",
	"Bardic Inspiration": "bonus",
	"Flurry of Blows": "bonus",
	"Patient Defense": "bonus",
	"Step of the Wind": "bonus",
	"Two-Weapon Fighting": "bonus",
	"Healing Hands": "bonus",
	// Reactions
	"Uncanny Dodge": "reaction",
	"Deflect Missiles": "reaction",
	"Slow Fall": "reaction",
	"Riposte": "reaction",
	"Cutting Words": "reaction",
	// Actions
	"Action Surge": "action",
	"Channel Divinity": "action",
	"Lay on Hands": "action",
	"Wild Shape": "action",
	"Second-Story Work": "action",
};

const _fmtBonus = n => `${n >= 0 ? "+" : "−"}${Math.abs(n)}`;

/** Compact display of a spell's range (`{distance:{type, amount}}`). */
function _fmtSpellRange (range) {
	const d = range?.distance;
	if (!d) return null;
	if (d.type === "self") return "Self";
	if (d.type === "touch") return "Touch";
	if (d.type === "feet") return `${d.amount} ft.`;
	if (d.type === "miles") return `${d.amount} mi.`;
	if (d.type === "sight") return "Sight";
	if (d.type === "unlimited") return "Unlimited";
	return d.amount ? `${d.amount} ${d.type}` : (d.type || null);
}

/**
 * A compact at-a-glance summary line for a known spell: casting time, range, attack or save
 * (using the character's derived spell attack/DC when given), damage types, and concentration.
 * @param ent the spell entity (or null → empty string)
 * @param derivedSpell `{dc, atkMod}` from the character's derivation (optional)
 */
export function getSpellSummary (ent, derivedSpell = null) {
	if (!ent) return "";
	const parts = [];

	const t = Array.isArray(ent.time) ? ent.time[0] : null;
	if (t?.unit) parts.push(t.unit === "action" ? "Action" : t.unit === "bonus" ? "Bonus" : t.unit === "reaction" ? "Reaction" : `${t.number} ${t.unit}${t.number > 1 ? "s" : ""}`);

	const rng = _fmtSpellRange(ent.range);
	if (rng) parts.push(rng);

	if (ent.spellAttack?.length) {
		const bonus = derivedSpell ? ` ${_fmtBonus(derivedSpell.atkMod)}` : "";
		parts.push(`${ent.spellAttack[0] === "M" ? "Melee" : "Ranged"} atk${bonus}`);
	} else if (ent.savingThrow?.length) {
		const abv = String(ent.savingThrow[0]).slice(0, 3).toUpperCase();
		parts.push(`${abv} save${derivedSpell ? ` DC ${derivedSpell.dc}` : ""}`);
	}

	if (ent.damageInflict?.length) parts.push(ent.damageInflict.map(d => d[0].toUpperCase() + d.slice(1)).join("/"));
	if (ent.duration?.some(d => d?.concentration)) parts.push("Conc.");

	return parts.join(" · ");
}

/** Normalise a spell's `time` (array of `{number, unit}`, or a string) to an economy bucket. */
export function normaliseCastTime (time) {
	const unit = Array.isArray(time) ? time[0]?.unit : (typeof time === "string" ? time : null);
	if (unit === "action") return "action";
	if (unit === "bonus") return "bonus";
	if (unit === "reaction") return "reaction";
	return "other"; // minutes/hours (rituals, prep) — not a combat action
}

/**
 * Build the grouped action economy.
 * @param attacks weapon attack rows `[{name, atkBonus, damage}]`
 * @param unarmed the derived Unarmed Strike `{name, atkBonus, damage}` (optional)
 * @param spells known spells `[{name, source, level, castTime}]`
 * @param features character features, each a name string or `{name, tag}` (tag = a renderable `{@...}` link)
 * @return {{action: Array, bonus: Array, reaction: Array}}
 */
export function buildActionEconomy ({attacks = [], unarmed = null, spells = [], features = []} = {}) {
	const out = {action: [], bonus: [], reaction: []};

	const addWeapon = a => {
		if (!a?.name) return;
		out.action.push({label: a.name, sub: `${_fmtBonus(a.atkBonus)} to hit${a.damage ? `, ${a.damage}` : ""}`, kind: "weapon"});
	};
	attacks.forEach(addWeapon);
	if (unarmed) addWeapon(unarmed);

	spells.forEach(sp => {
		// Unknown casting time (e.g. legacy saves) defaults to Action, which fits the large majority of spells.
		const ct = sp.castTime === "bonus" || sp.castTime === "reaction" || sp.castTime === "action" ? sp.castTime : "action";
		if (sp.castTime === "other") return; // ritual/long-cast: skip the combat economy
		out[ct].push({
			label: sp.name,
			source: sp.source,
			sub: sp.level === 0 ? "Cantrip" : `Level ${sp.level}`,
			kind: "spell",
			// Carried through for the availability check: which slot it needs, and whether casting it
			// would drop whatever is already being concentrated on
			spellLevel: sp.level,
			isConcentration: !!sp.isConcentration,
		});
	});

	const seen = new Set();
	features.forEach(f => {
		const name = typeof f === "string" ? f : f?.name;
		const tag = typeof f === "string" ? null : f?.tag;
		if (!name || seen.has(name)) return;
		seen.add(name);

		// The book's own "as a Bonus Action" first, the curated map second. The map was written when
		// nothing read the features themselves, and it knows twenty names; the phrasing is in
		// fifty-six of the features that spend a resource, including every subclass one
		const econ = (typeof f === "object" && f?.bucket) || FEATURE_ACTION_ECONOMY[name];
		if (!econ || !out[econ]) return;

		// What it costs, so the panel can say so and the availability check can see whether the
		// character can still pay it
		const cost = typeof f === "object" ? f?.cost || null : null;
		out[econ].push({label: name, kind: "feature", tag, cost, sub: (typeof f === "object" ? f?.sub : null) || null});
	});

	return out;
}

/* -------------------------------------------- what anyone can do -------------------------------------------- */

/**
 * Actions in `data/actions.json` the sheet should not list.
 *
 * Not because they are wrong — because the sheet already says them better. "Attack" is above the
 * list as the character's actual weapons; "Cast a Spell" and "Magic" are the spells themselves;
 * "Activate an Item" is the charge chip on the item. And a few are not a thing you decide to do at
 * all: improvising is what the list is *for*, and ending concentration has its own button.
 */
const _GENERAL_ACTION_SKIP = new Set([
	"Attack", "Cast a Spell", "Magic", "Activate an Item", "Use an Object",
	"Improvising an Action", "Other Activity", "End Concentration",
]);

/**
 * Grapple and Shove, for a character playing by the 2024 rules.
 *
 * They stopped being actions of their own and became options on an Unarmed Strike, so they are in
 * the variant rules rather than the action list — and a turn helper that omits the two things
 * everybody reaches for at the table would be missing the point. Curated because the shape they
 * live in now is prose, and only these two are affected.
 */
const _MODERN_UNARMED_OPTIONS = [
	{name: "Grapple", sub: "Unarmed Strike: Str save or Grappled", cite: {name: "Unarmed Strike", source: "XPHB"}},
	{name: "Shove", sub: "Unarmed Strike: Str save, push 5 ft. or knock Prone", cite: {name: "Unarmed Strike", source: "XPHB"}},
];

/** Jumping is movement rather than an action, and is the rule most often looked up mid-turn. */
const _JUMP = {name: "Jump", bucket: "free", sub: "Long: Str score in feet with a 10 ft. run-up. High: 3 + Str modifier"};

/**
 * The actions every character has, whatever they are.
 *
 * Read from `data/actions.json` rather than listed here: the book already writes them down, with
 * their timing and their text, and two editions' worth of differences that nobody should be
 * maintaining by hand — 2024 renamed Search to Study and Influence, and moved Grapple and Shove
 * onto the Unarmed Strike.
 *
 * @param actionEntities the `action` entries, as loaded.
 * @param [opts.isClassic] read the 2014 list rather than the 2024 one.
 * @return {Array<{label: string, bucket: string, sub: string|null, kind: string, ent: object|null}>}
 */
export function getGeneralActionEntries (actionEntities, {isClassic = false} = {}) {
	const wantSource = isClassic ? "PHB" : "XPHB";

	const out = (actionEntities || [])
		.filter(ent => ent?.name && String(ent.source).toUpperCase() === wantSource)
		.filter(ent => !_GENERAL_ACTION_SKIP.has(ent.name))
		.map(ent => {
			// `time` is an array that may hold several — Identify a Spell is a reaction *or* an
			// action. The first is the one it is normally taken as
			const bucket = normaliseCastTime(ent.time);
			return {
				label: ent.name,
				bucket: bucket === "other" ? "free" : bucket,
				sub: null,
				kind: "general",
				ent,
			};
		});

	if (!isClassic) {
		_MODERN_UNARMED_OPTIONS.forEach(it => out.push({label: it.name, bucket: "action", sub: it.sub, kind: "general", cite: it.cite, ent: null}));
	}
	out.push({label: _JUMP.name, bucket: _JUMP.bucket, sub: _JUMP.sub, kind: "general", ent: null});

	out.sort((a, b) => a.label.localeCompare(b.label));
	return out;
}
