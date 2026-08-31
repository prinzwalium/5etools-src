/**
 * The build audit: what is broken, and what is unclaimed.
 *
 * Two questions no character sheet usually answers. The first is "does this character break a
 * rule?" — four attuned items, a multiclass whose prerequisite is unmet, more spells prepared than
 * the class allows. The second is rarer and more useful: "what did I leave on the table?" — an
 * ability increase never assigned, an Expertise pick outstanding, a weapon mastery never chosen.
 *
 * Everything here reports; nothing enforces. A DM ruling beats the audit, so a finding is a
 * sentence rather than a block, and a character with findings is still perfectly usable.
 *
 * The checks that need class data (prerequisites, the counts a class grants) take it as an
 * argument, so this module stays DOM-free, data-free and unit-tested.
 */

/** Breaks a rule as written. */
export const AUDIT_BROKEN = "broken";
/** Legal, but something the character is owed has not been taken. */
export const AUDIT_UNCLAIMED = "unclaimed";

/** Attunement is capped at three items for almost every character. */
export const ATTUNEMENT_LIMIT = 3;

const _ABILITY_NAMES = {str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma"};

const _mkFinding = (severity, key, message, hint = null) => ({severity, key, message, hint});

/**
 * Whether ability scores meet a class's `multiclassing.requirements`.
 *
 * The data uses two shapes: a flat map, where *every* entry must be met (Monk needs Dex 13 *and*
 * Wis 13), and `{or: [...]}`, where any one group does (Fighter needs Str 13 *or* Dex 13).
 * @return {{isMet: boolean, text: string}}
 */
export function checkMulticlassRequirements (requirements, state) {
	const scoreOf = abv => Number(state?.[`abil_${abv}`]) || 0;

	const fmtGroup = grp => Object.entries(grp)
		.map(([abv, min]) => `${_ABILITY_NAMES[abv] || abv} ${min}`)
		.join(" and ");
	const isGroupMet = grp => Object.entries(grp).every(([abv, min]) => scoreOf(abv) >= Number(min));

	if (!requirements || !Object.keys(requirements).length) return {isMet: true, text: ""};

	if (requirements.or?.length) {
		return {
			isMet: requirements.or.some(grp => Object.entries(grp).some(([abv, min]) => scoreOf(abv) >= Number(min))),
			// An `or` group lists alternatives, not a conjunction
			text: requirements.or
				.flatMap(grp => Object.entries(grp).map(([abv, min]) => `${_ABILITY_NAMES[abv] || abv} ${min}`))
				.join(" or "),
		};
	}

	return {isMet: isGroupMet(requirements), text: fmtGroup(requirements)};
}

/**
 * Audit a character.
 *
 * @param state the character state.
 * @param opts.encumbrance `{totalWeightLb, capacityLb}` from the derivation.
 * @param opts.classInfos `[{name, level, requirements}]` — one per class entry, for prerequisites.
 *   The first class a character takes has no prerequisite, so only later ones are checked.
 * @param opts.counts `{asiTotal, asiTaken, expertiseTotal, expertiseTaken, masteryTotal,
 *   masteryTaken, preparedLimit, preparedCount}` — whatever the caller could work out; each is
 *   checked only when both halves are present.
 * @param opts.grantedOriginFeats `[{name, source, displayName, from}]` — the Origin feats the
 *   species and background grant *by name*. Given rather than read, because only the caller has the
 *   entities.
 * @param opts.grantedFeatChoices `[{from, count}]` — the "one of your choice" grants, named by the
 *   entity that makes them (the 2024 Human's Versatile).
 * @param opts.openTraitChoices `[{from, trait}]` — "choose one of the following" species traits the
 *   character has reached the level for and not answered.
 * @return {Array<{severity: string, key: string, message: string, hint: string|null}>}
 */
export function auditCharacter (state, {encumbrance = null, classInfos = [], counts = {}, grantedOriginFeats = [], grantedFeatChoices = [], openTraitChoices = [], isSizeOwed = false} = {}) {
	const out = [];
	if (!state) return out;

	const level = Math.max(1, Number(state.level) || 1);
	const classes = state.classes || [];

	/* -------------------------------------------- Broken -------------------------------------------- */

	const nAttuned = (state.inventory || []).filter(it => it.attuned).length;
	if (nAttuned > ATTUNEMENT_LIMIT) {
		out.push(_mkFinding(AUDIT_BROKEN, "attunement",
			`Attuned to ${nAttuned} items; the limit is ${ATTUNEMENT_LIMIT}.`,
			"Un-attune one in the inventory."));
	}

	if (encumbrance && encumbrance.capacityLb && encumbrance.totalWeightLb > encumbrance.capacityLb) {
		out.push(_mkFinding(AUDIT_BROKEN, "encumbrance",
			`Carrying ${encumbrance.totalWeightLb} lb. against a capacity of ${encumbrance.capacityLb} lb.`,
			`Strength × 15 is the carrying capacity${encumbrance.isPowerfulBuild ? ", doubled here by Powerful Build" : ""}.`));
	}

	const classLevels = classes.reduce((acc, it) => acc + (Number(it.level) || 0), 0);
	if (classes.length && classLevels !== level) {
		out.push(_mkFinding(AUDIT_BROKEN, "level-mismatch",
			`Character level is ${level}, but the class levels add up to ${classLevels}.`));
	}

	if (level > 1 && !(Number(state.hpMax) || 0)) {
		out.push(_mkFinding(AUDIT_BROKEN, "hp", "Maximum hit points is 0."));
	}

	// The first class taken has no prerequisite; every one after it does
	classInfos.slice(1).forEach(info => {
		const {isMet, text} = checkMulticlassRequirements(info?.requirements, state);
		if (isMet || !text) return;
		out.push(_mkFinding(AUDIT_BROKEN, `multiclass:${info.name}`,
			`Multiclassing into ${info.name} needs ${text}.`,
			"A DM can waive this; the rules do not."));
	});

	if (counts.preparedLimit != null && counts.preparedCount > counts.preparedLimit) {
		out.push(_mkFinding(AUDIT_BROKEN, "prepared",
			`${counts.preparedCount} spells prepared, against a limit of ${counts.preparedLimit}.`));
	}

	/* -------------------------------------------- Unclaimed -------------------------------------------- */

	(state.pendingAbilityOffers || []).forEach(offer => {
		out.push(_mkFinding(AUDIT_UNCLAIMED, `offer:${offer.id}`,
			`${offer.source} grants ${offer.offer}, not yet assigned.`,
			"Assign it beside the ability scores, or dismiss the reminder."));
	});

	const addShortfall = (key, taken, total, one, many, hint) => {
		if (total == null || taken == null || taken >= total) return;
		const missing = total - taken;
		out.push(_mkFinding(AUDIT_UNCLAIMED, key, `${missing} ${missing === 1 ? one : many} still to choose.`, hint));
	};

	addShortfall("asi", counts.asiTaken, counts.asiTotal,
		"ability score improvement or feat", "ability score improvements or feats",
		"On the class panel, at each Ability Score Improvement.");
	addShortfall("expertise", counts.expertiseTaken, counts.expertiseTotal,
		"Expertise skill", "Expertise skills", "On the class panel's Expertise card.");
	addShortfall("mastery", counts.masteryTaken, counts.masteryTotal,
		"weapon mastery", "weapon masteries", "On the class panel's Weapon Mastery card.");
	// A caster with no cantrips is not ready to play, and this is where "not ready" is listed
	addShortfall("cantrips", counts.cantripsTaken, counts.cantripsTotal,
		"cantrip", "cantrips", "In the spell panel, under Manage Spells.");
	addShortfall("spellsKnown", counts.spellsKnownTaken, counts.spellsKnownTotal,
		"spell", "spells", "In the spell panel, under Manage Spells.");

	if (!classes.length) {
		out.push(_mkFinding(AUDIT_UNCLAIMED, "class", "No class picked yet."));
	}
	if (!state.refSpecies && !(state.speciesText || "").trim()) {
		out.push(_mkFinding(AUDIT_UNCLAIMED, "species", "No species picked yet."));
	}
	if (!state.refBackground && !(state.backgroundText || "").trim()) {
		out.push(_mkFinding(AUDIT_UNCLAIMED, "background", "No background picked yet."));
	}

	// The 2024 classes grant a Fighting Style and an Epic Boon through the class table. Unclaimed,
	// they are simply missing from the character — and nothing was counting them at all.
	if (counts.classFeatTotal != null && counts.classFeatTotal > (counts.classFeatTaken || 0)) {
		const owed = counts.classFeatTotal - (counts.classFeatTaken || 0);
		out.push(_mkFinding(AUDIT_UNCLAIMED, "classfeat",
			`${owed} class-granted feat${owed === 1 ? "" : "s"} (Fighting Style, Epic Boon) still to choose.`,
			"Choose them in the class panel."));
	}

	// A 2024 background hands you a feat. It used to be written into the notes as a line of text,
	// where nothing counted it and its own choices were never asked; if it was skipped, this is
	// what says so.
	const takenFeatKeys = new Set((state.originFeats || []).map(it => `${it.name}|${it.source}`.toLowerCase()));
	grantedOriginFeats
		.filter(it => !takenFeatKeys.has(`${it.name}|${it.source}`.toLowerCase()))
		.forEach(it => out.push(_mkFinding(AUDIT_UNCLAIMED, `originfeat:${it.name}`,
			`${it.from || state.backgroundText || "Your background"} grants the origin feat ${it.displayName || it.name}, not taken.`,
			"Take it from the panel that grants it, with its own choices.")));

	// "An Origin feat of your choice" — the 2024 Human's Versatile. Counted against the feats taken
	// *for the entity that granted it*, which is how the panel counts too: counting all origin feats
	// against all grants let one entity's feat answer another's, so the two disagreed.
	grantedFeatChoices.forEach(({from, count}) => {
		const taken = (state.originFeats || []).filter(it => it.from === from).length;
		const named = grantedOriginFeats.filter(it => it.from === from).length;
		const owed = count - Math.max(0, taken - named);
		if (owed > 0) {
			out.push(_mkFinding(AUDIT_UNCLAIMED, `originfeat:choice:${from}`,
				`${from} grants ${owed} origin feat${owed === 1 ? "" : "s"} of your choice, not taken.`,
				"Take it from the species or background panel."));
		}
	});

	// A species that offers "Small or Medium" is asking a question, and the answer changes carrying
	// capacity, grappling and squeezing
	if (isSizeOwed) {
		out.push(_mkFinding(AUDIT_UNCLAIMED, "size",
			"Your species offers a choice of size, not yet made.",
			"Choose it from the species panel."));
	}

	// A "choose one of the following" trait — an Elf's Lineage, a Dragonborn's Ancestry — decides a
	// cantrip, a damage type, a breath weapon. Unpicked, it reads on the sheet as a trait the
	// character has, when in fact nothing about it has been settled.
	openTraitChoices.forEach(({from, trait}) => {
		out.push(_mkFinding(AUDIT_UNCLAIMED, `traitchoice:${from}:${trait}`,
			`${from}: ${trait} is not chosen.`,
			"Choose it from the species panel."));
	});

	return out;
}

/** Split an audit into its two halves, in the order a reader wants them. */
export function groupFindings (findings) {
	return [
		{severity: AUDIT_BROKEN, label: "Breaks a rule", items: (findings || []).filter(it => it.severity === AUDIT_BROKEN)},
		{severity: AUDIT_UNCLAIMED, label: "Not yet chosen", items: (findings || []).filter(it => it.severity === AUDIT_UNCLAIMED)},
	].filter(grp => grp.items.length);
}
