/**
 * What the character can actually do *right now*.
 *
 * The Actions panel lists what a character has; this decides which of those are available given
 * live state — spell slots spent, a wand at zero charges, an empty quiver, a concentration already
 * running, a condition that stops you acting at all. Every input is something the sheet already
 * tracks, so nothing here is guesswork: it reports, it does not enforce, and a blocked entry is
 * still shown with the reason rather than hidden.
 *
 * Kept DOM-free and dependency-free so it can be unit-tested.
 */

export const AVAIL_OK = "ok";
/** Possible, but something about it is wrong — casting over a running concentration, say. */
export const AVAIL_WARN = "warn";
/** Not possible: the resource it needs is gone. */
export const AVAIL_BLOCKED = "blocked";

/** Conditions under which a creature takes no actions, bonus actions or reactions at all. */
export const CONDITIONS_NO_ACTIONS = ["Incapacitated", "Paralyzed", "Petrified", "Stunned", "Unconscious"];

/**
 * A feature's name as the economy knows it → the class-table resource that limits its uses.
 *
 * Only the ones the data cannot say. A feature that spends *another* feature's pool says so in its
 * own `consumes`, and that arrives on the entry as `cost`; what is left here is the handful whose
 * limit is a column of the same name — Rage is limited by Rages — which no `consumes` states
 * because there is nothing to state.
 */
const _FEATURE_TO_RESOURCE = {
	"Rage": "Rages",
	"Second Wind": "Second Wind",
	"Action Surge": "Action Surge",
	"Channel Divinity": "Channel Divinity",
	"Wild Shape": "Wild Shape",
	"Bardic Inspiration": "Bardic Inspiration",
};

/**
 * The state of the character's turn as a whole: what is stopping them, and what is dragging on
 * every roll.
 * @return {{blockingConditions: string[], isNoActions: boolean, concentration: string,
 *   exhaustion: number, notes: string[]}}
 */
export function getTurnState (state) {
	const conditions = state?.conditions || [];
	const blockingConditions = CONDITIONS_NO_ACTIONS.filter(it => conditions.includes(it));
	const exhaustion = Math.max(0, Math.floor(Number(state?.exhaustion) || 0));

	const notes = [];
	if (blockingConditions.length) notes.push(`${blockingConditions.join(", ")} — no actions, bonus actions or reactions`);
	if (exhaustion) notes.push(`Exhaustion ${exhaustion} — −${2 * exhaustion} on every d20 test`);
	if (conditions.includes("Prone")) notes.push("Prone — attack rolls have disadvantage, and attacks against you within 5 feet have advantage");
	if (conditions.includes("Grappled") || conditions.includes("Restrained")) notes.push(`${conditions.includes("Restrained") ? "Restrained" : "Grappled"} — speed 0`);

	return {
		blockingConditions,
		isNoActions: !!blockingConditions.length,
		concentration: (state?.concentration || "").trim(),
		exhaustion,
		notes,
	};
}

/**
 * Whether a slot is left to cast a spell of this level, counting up: a 1st-level spell can go in a
 * 2nd-level slot. Pact slots count when they are high enough.
 */
export function hasSlotForLevel (level, {slots = [], pact = null, slotsUsed = {}} = {}) {
	if (!level) return true; // a cantrip needs no slot

	for (let lvl = level; lvl <= (slots.length || 0); ++lvl) {
		const count = Number(slots[lvl - 1]) || 0;
		if (count > (Number(slotsUsed[lvl]) || 0)) return true;
	}

	if (pact?.count && pact.level >= level && pact.count > (Number(slotsUsed.pact) || 0)) return true;

	return false;
}

/** The ammunition an attack needs, and whether any is left. */
export function getAmmoState (attackName, state) {
	const weapon = (state?.inventory || []).find(it => it.name === attackName && it.ammoType);
	if (!weapon) return null;

	// `ammoType` is a uid ("arrow|phb"); an inventory row is keyed by name
	const wanted = String(weapon.ammoType).split("|")[0].toLowerCase();
	const rows = (state.inventory || []).filter(it => it.isAmmo && String(it.name).toLowerCase().includes(wanted));
	const quantity = rows.reduce((acc, it) => acc + (Number(it.quantity) || 0), 0);

	return {name: wanted, quantity, isCarried: !!rows.length};
}

/**
 * Decide one economy entry's availability.
 *
 * @param item an entry from `buildActionEconomy`, plus `spellLevel`/`isConcentration` for a spell
 *   and `chargesLeft` for an item.
 * @param ctx `{state, turn, slots, pact, slotsUsed, resources}` — `resources` maps a label to
 *   `{total, used}`.
 * @return {{status: string, reason: string|null}}
 */
export function getEntryAvailability (item, ctx) {
	const {turn} = ctx;

	// Nothing at all is possible while incapacitated
	if (turn.isNoActions) return {status: AVAIL_BLOCKED, reason: turn.blockingConditions.join(", ")};

	switch (item?.kind) {
		case "spell": {
			const level = Number(item.spellLevel) || 0;
			if (level && !hasSlotForLevel(level, ctx)) {
				return {status: AVAIL_BLOCKED, reason: `No level ${level}+ slots left`};
			}
			if (item.isConcentration && turn.concentration && turn.concentration !== item.label) {
				return {status: AVAIL_WARN, reason: `Would drop ${turn.concentration}`};
			}
			return {status: AVAIL_OK, reason: null};
		}

		case "item": {
			if (item.chargesLeft === 0) return {status: AVAIL_BLOCKED, reason: "No charges left"};
			return {status: AVAIL_OK, reason: null};
		}

		case "weapon": {
			const ammo = getAmmoState(item.label, ctx.state);
			if (ammo && !ammo.quantity) {
				return {status: AVAIL_BLOCKED, reason: ammo.isCarried ? `Out of ${ammo.name}s` : `No ${ammo.name}s carried`};
			}
			return {status: AVAIL_OK, reason: null};
		}

		case "feature": {
			// What the feature itself says it spends, and how much of it — a Way of Mercy monk's Hand
			// of Healing costs one Focus Point, Hand of Ultimate Mercy costs five, and a pool with
			// four left can pay for one and not the other
			if (item.cost?.label) {
				const pool = ctx.resources?.[item.cost.label];
				const need = Math.max(1, Number(item.cost.amount) || 1);
				if (pool && pool.total && pool.total - pool.used < need) {
					const left = Math.max(0, pool.total - pool.used);
					return {
						status: AVAIL_BLOCKED,
						reason: left ? `Needs ${need} ${item.cost.label}, ${left} left` : `No ${item.cost.label.toLowerCase()} left`,
					};
				}
				return {status: AVAIL_OK, reason: null};
			}

			const label = _FEATURE_TO_RESOURCE[item.label];
			const res = label ? ctx.resources?.[label] : null;
			if (res && res.total && res.used >= res.total) {
				return {status: AVAIL_BLOCKED, reason: `No ${label.toLowerCase()} left`};
			}
			return {status: AVAIL_OK, reason: null};
		}

		default: return {status: AVAIL_OK, reason: null};
	}
}

/**
 * Equipped items with charges, as entries for the action economy — a wand is one of the things a
 * character can do on their turn, and until now the panel never said so.
 */
export function getItemEntries (state) {
	return (state?.inventory || [])
		.filter(it => it.equipped && it.chargesMax)
		.map(it => {
			const chargesLeft = Math.max(0, it.chargesMax - (Number(it.chargesUsed) || 0));
			return {
				label: it.name,
				source: it.source,
				kind: "item",
				chargesLeft,
				sub: `${chargesLeft}/${it.chargesMax} charges`,
			};
		});
}

/** Annotate a whole economy in place of the caller doing it entry by entry. */
export function annotateEconomy (economy, ctx) {
	const out = {};
	Object.entries(economy || {}).forEach(([bucket, items]) => {
		out[bucket] = (items || []).map(it => ({...it, ...getEntryAvailability(it, ctx)}));
	});
	return out;
}
