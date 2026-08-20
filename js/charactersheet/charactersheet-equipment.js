/**
 * Pure parsing of `startingEquipment` data into renderable/resolvable choice groups.
 *
 * `defaultData` groups map option keys ("a"/"b"/..., uppercase in 2024-style data, "_" for
 * always-granted) to item lists whose entries are `"uid"` strings, `{item, quantity, displayName}`,
 * `{special, quantity}`, `{equipmentType, quantity}`, or `{value}` (coins, in cp).
 */

export const EQUIPMENT_ALWAYS_KEY = "_";

/** Parse an item uid ("chain mail|phb") into `{name, source}`; source defaults to PHB. */
export function getItemUidParts (uid) {
	const [name, source] = String(uid).split("|");
	return {name: name.trim(), source: (source || "phb").trim()};
}

/** Parse a bonus string/number like "+1" or "2" into a signed integer (0 when absent/invalid). */
export function parseItemBonus (val) {
	if (val == null) return 0;
	const n = Number(String(val).replace(/[^-\d]/g, ""));
	return isNaN(n) ? 0 : n;
}

/**
 * Extract the mechanical fields a character sheet needs from an item entity — armor class,
 * armor category and Dex cap, weapon damage/properties, magic AC/attack bonuses, and attunement.
 * Kept flat so it can be stored directly on an inventory row and read by the pure derivations.
 */
export function getInventoryItemMeta (ent) {
	if (!ent) return {};
	const out = {};
	const type = String(ent.type || "").split("|")[0];
	if (type) out.type = type;
	if (ent.armor) out.isArmor = true;
	if (ent.ac != null) out.baseAc = Number(ent.ac) || 0;
	if (ent.dexterityMax != null) out.dexterityMax = Number(ent.dexterityMax);
	if (ent.stealth) out.stealth = true;
	if (ent.weapon) out.isWeapon = true;
	if (ent.dmg1) out.dmg1 = ent.dmg1;
	if (ent.dmgType) out.dmgType = ent.dmgType;
	if (ent.property?.length) out.properties = ent.property.map(p => String(p).split("|")[0]);
	if (ent.mastery?.length) out.mastery = ent.mastery.map(m => String(m).split("|")[0]);
	if (ent.weaponCategory) out.weaponCategory = ent.weaponCategory;
	const bonusAc = parseItemBonus(ent.bonusAc);
	if (bonusAc) out.bonusAc = bonusAc;
	// `bonusWeapon` applies to both rolls; `bonusWeaponAttack`/`bonusWeaponDamage` are roll-specific.
	const bonusShared = parseItemBonus(ent.bonusWeapon);
	const bonusAttack = bonusShared + parseItemBonus(ent.bonusWeaponAttack);
	const bonusDamage = bonusShared + parseItemBonus(ent.bonusWeaponDamage);
	if (bonusAttack) out.bonusAttack = bonusAttack;
	if (bonusDamage) out.bonusDamage = bonusDamage;
	const bonusSpellAttack = parseItemBonus(ent.bonusSpellAttack);
	if (bonusSpellAttack) out.bonusSpellAttack = bonusSpellAttack;
	const bonusSpellSaveDc = parseItemBonus(ent.bonusSpellSaveDc);
	if (bonusSpellSaveDc) out.bonusSpellSaveDc = bonusSpellSaveDc;
	const bonusSavingThrow = parseItemBonus(ent.bonusSavingThrow);
	if (bonusSavingThrow) out.bonusSavingThrow = bonusSavingThrow;
	if (ent.reqAttune) out.requiresAttunement = true;
	// What the item does to an ability score, in the data's own shape: `{static: {str: 21}}` for a
	// Belt of Giant Strength, `{con: 2}` for a Belt of Dwarvenkind. Read by `getAbilityScore`
	if (ent.ability && typeof ent.ability === "object") out.ability = ent.ability;
	// Wands, staves, rings of spell storing, ... — enough to make the character a spell user
	if (ent.attachedSpells) out.grantsSpells = true;
	// What the item defends against while worn, kept in the data's own shape so one reader serves
	// species, feats and gear alike (`charactersheet-defenses.js`)
	["resist", "immune", "vulnerable", "conditionImmune", "senses"].forEach(key => {
		if (ent[key]?.length) out[key] = ent[key];
	});
	// A wand's charges, and how it gets them back
	const charges = Number(ent.charges);
	if (charges) {
		out.chargesMax = charges;
		if (ent.recharge) out.recharge = ent.recharge;
		if (ent.rechargeAmount != null) out.rechargeAmount = ent.rechargeAmount;
	}
	if (isAmmunitionType(type)) out.isAmmo = true;
	// Which ammunition this weapon needs, so the sheet can tell you the quiver is empty
	if (ent.ammoType) out.ammoType = ent.ammoType;
	return out;
}

/* -------------------------------------------- Charges -------------------------------------------- */

/** Ammunition, mundane ("A") or futuristic ("AF"). */
export function isAmmunitionType (type) {
	return ["A", "AF"].includes(String(type || "").split("|")[0]);
}

/**
 * Which rest gives an item its charges back. The data says *when* ("dawn", "dusk", "midnight"), and
 * every one of those falls inside a long rest at a normal table; `restShort` is its own case, and
 * "special" means the item's own text decides, so nothing is restored automatically.
 * @return {"long"|"short"|null}
 */
export function getRechargeRest (recharge) {
	switch (String(recharge || "")) {
		case "dawn": case "dusk": case "midnight": case "restLong": return "long";
		case "restShort": return "short";
		default: return null;
	}
}

/**
 * Parse the recharge amount, which is a flat number, a `{@dice}` tag, or absent (meaning all of
 * them come back).
 * @return {{count: number, faces: number, bonus: number}|{flat: number}|null}
 */
export function parseRechargeAmount (val) {
	if (val == null) return null;
	if (typeof val === "number") return {flat: val};

	const str = String(val).replace(/\{@\w+\s+([^}]+)\}/g, "$1").trim();
	if (/^\d+$/.test(str)) return {flat: Number(str)};

	const m = /^(\d*)d(\d+)\s*(?:([+-])\s*(\d+))?$/i.exec(str);
	if (!m) return null;
	return {
		count: Number(m[1] || 1),
		faces: Number(m[2]),
		bonus: m[3] === "-" ? -Number(m[4]) : Number(m[4] || 0),
	};
}

/**
 * How many charges come back on a rest. A dice expression is rolled — `rng` is injectable so the
 * result can be pinned in a test — and an item with no stated amount regains all of them.
 */
export function rollRechargeAmount (rechargeAmount, {chargesMax = 0, rng = Math.random} = {}) {
	const parsed = parseRechargeAmount(rechargeAmount);
	if (!parsed) return chargesMax;
	if (parsed.flat != null) return parsed.flat;

	let total = parsed.bonus;
	for (let i = 0; i < parsed.count; ++i) total += Math.floor(rng() * parsed.faces) + 1;
	return Math.max(0, total);
}

/**
 * An item's charges after a rest of the given kind: unchanged unless this rest is the one that
 * recharges it, and never above its maximum.
 * @return {number} charges now expended
 */
export function getChargesAfterRest (item, restKind, {rng = Math.random} = {}) {
	const used = Math.max(0, Number(item?.chargesUsed) || 0);
	if (!item?.chargesMax || getRechargeRest(item.recharge) !== restKind) return used;

	const regained = rollRechargeAmount(item.rechargeAmount, {chargesMax: item.chargesMax, rng});
	return Math.max(0, used - regained);
}

/* -------------------------------------------- Ammunition -------------------------------------------- */

/**
 * "You can recover half your expended ammunition by taking a minute to search the battlefield."
 * Rounded down, and never more than was actually spent.
 */
export function getAmmoRecovered (spent) {
	return Math.floor(Math.max(0, Number(spent) || 0) / 2);
}

/** Display a copper-piece value in the largest sensible coin, e.g. 400 → "4 gp". */
export function getCoinDisplay (valueCp) {
	if (valueCp % 100 === 0) return `${valueCp / 100} gp`;
	if (valueCp % 10 === 0) return `${valueCp / 10} sp`;
	return `${valueCp} cp`;
}

const _EQUIPMENT_TYPE_DISPLAY = {
	weaponSimple: "a simple weapon",
	weaponSimpleMelee: "a simple melee weapon",
	weaponMartial: "a martial weapon",
	weaponMartialMelee: "a martial melee weapon",
	instrumentMusical: "a musical instrument",
	armorLight: "light armor",
	armorMedium: "medium armor",
	armorHeavy: "heavy armor",
	weaponMelee: "a melee weapon",
	weaponRanged: "a ranged weapon",
	focusSpellcasting: "a spellcasting focus",
	setGaming: "a gaming set",
	toolArtisan: "artisan's tools",
};

/**
 * Normalise one item entry.
 * @return {{kind: "item"|"special"|"placeholder"|"coins", name?, source?, quantity, display}}
 */
export function getNormalisedEquipmentEntry (entry) {
	if (typeof entry === "string") {
		const {name, source} = getItemUidParts(entry);
		return {kind: "item", name, source, quantity: 1, display: name};
	}
	if (entry.item) {
		const {name, source} = getItemUidParts(entry.item);
		return {kind: "item", name, source, quantity: entry.quantity || 1, display: entry.displayName || name};
	}
	if (entry.special) {
		return {kind: "special", quantity: entry.quantity || 1, display: entry.special};
	}
	if (entry.equipmentType) {
		const display = _EQUIPMENT_TYPE_DISPLAY[entry.equipmentType] || entry.equipmentType;
		return {kind: "placeholder", quantity: entry.quantity || 1, display};
	}
	if (entry.value != null) {
		return {kind: "coins", quantity: 1, value: entry.value, display: getCoinDisplay(entry.value)};
	}
	return {kind: "special", quantity: 1, display: JSON.stringify(entry)};
}

/**
 * Parse `startingEquipment.defaultData` (or a background's `startingEquipment`) into choice groups.
 * @return {Array<{options: Array<{key: string, entries: Array}>, isChoice: boolean}>}
 */
export function getEquipmentChoiceGroups (defaultData) {
	return (defaultData || [])
		.map(grp => {
			const options = Object.entries(grp)
				.filter(([, entries]) => Array.isArray(entries))
				.map(([key, entries]) => ({
					key,
					entries: entries.map(getNormalisedEquipmentEntry),
				}));
			if (!options.length) return null;
			return {
				options,
				isChoice: !(options.length === 1 && options[0].key === EQUIPMENT_ALWAYS_KEY),
			};
		})
		.filter(Boolean);
}

/** Display text for one option's entries, e.g. "chain mail, 2× handaxe, 4 gp". */
export function getEquipmentOptionDisplay (option) {
	return option.entries
		.map(it => `${it.quantity > 1 ? `${it.quantity}× ` : ""}${it.display}`)
		.join(", ");
}
