/**
 * Per-character source filtering: which books a character is allowed to *pick* content from.
 *
 * The filter is applied to the pickers only — never to rendering or derivation — so changing it can
 * never break a saved character. Content already chosen keeps working and is flagged instead.
 *
 * Kept dependency-free (the 2014/2024 classification is injected) so it can be unit-tested; the
 * browser side binds `SourceUtil.isClassicSource`, which compares a source's publication date to
 * the 2024 PHB's rather than relying on a hardcoded list.
 */

export const SOURCE_MODE_ALL = "all";
export const SOURCE_MODE_MODERN = "modern"; // 2024 ruleset (XPHB onwards)
export const SOURCE_MODE_CLASSIC = "classic"; // 2014 ruleset
export const SOURCE_MODE_CUSTOM = "custom";

export const SOURCE_MODES = [
	{mode: SOURCE_MODE_ALL, name: "All sources", desc: "Everything available, including homebrew"},
	{mode: SOURCE_MODE_MODERN, name: "2024 rules only", desc: "The 2024 Player's Handbook and later"},
	{mode: SOURCE_MODE_CLASSIC, name: "2014 rules only", desc: "The 2014 Player's Handbook and its era"},
	{mode: SOURCE_MODE_CUSTOM, name: "Custom", desc: "Pick individual books"},
];

/**
 * The default filter: every book, and the newest printing of anything printed twice.
 *
 * "Unrestricted" is not the same as "everything twice". The 2024 books reprint most of the 2014
 * ones, and offering both printings of the Fighter, of Alert, of Longsword and of three hundred and
 * sixty-one spells is a longer list saying the same things. What the new books never reprinted is
 * untouched, so nothing is lost — see `filterReprinted`.
 */
export function getDefaultSourceFilter () {
	return {mode: SOURCE_MODE_ALL, sources: {}, isPreferReprints: true};
}

/** Whether a filter permits everything (so callers can skip work entirely). */
export function isSourceFilterInactive (filter) {
	return !filter || !filter.mode || filter.mode === SOURCE_MODE_ALL;
}

/**
 * Whether the filter changes what a picker offers at all — which is not the same question as
 * {@link isSourceFilterInactive}, because preferring the newest printing narrows the list even when
 * every book is allowed.
 */
export function isSourceFilterNarrowing (filter) {
	return !isSourceFilterInactive(filter) || isPreferringReprints(filter);
}

/**
 * Whether `source` may be picked under `filter`.
 * @param source a source code ("PHB", "XPHB", ...)
 * @param filter `{mode, sources}`
 * @param opts.isClassic classifier returning true for 2014-era sources; when absent, era modes allow all
 */
export function isSourceAllowed (source, filter, {isClassic = null} = {}) {
	if (isSourceFilterInactive(filter)) return true;
	if (source == null) return true; // unsourced content is never hidden

	switch (filter.mode) {
		case SOURCE_MODE_CUSTOM: return !!filter.sources?.[source];
		case SOURCE_MODE_MODERN: return isClassic ? !isClassic(source) : true;
		case SOURCE_MODE_CLASSIC: return isClassic ? !!isClassic(source) : true;
		default: return true;
	}
}

/** A `source => boolean` predicate for a filter, or null when the filter permits everything. */
export function getSourceFilterPredicate (filter, {isClassic = null} = {}) {
	if (isSourceFilterInactive(filter)) return null;
	return source => isSourceAllowed(source, filter, {isClassic});
}

/** Short label for the current filter, for the toolbar chip. */
export function getSourceFilterLabel (filter) {
	const ptBooks = _getSourceFilterBooksLabel(filter);
	// Only worth saying when it is *off*, because on is the default and a chip that always says the
	// same thing says nothing
	return isPreferringReprints(filter) ? ptBooks : `${ptBooks}, all printings`;
}

function _getSourceFilterBooksLabel (filter) {
	if (isSourceFilterInactive(filter)) return "All sources";
	if (filter.mode === SOURCE_MODE_CUSTOM) {
		const n = Object.values(filter.sources || {}).filter(Boolean).length;
		return `${n} book${n === 1 ? "" : "s"}`;
	}
	return SOURCE_MODES.find(it => it.mode === filter.mode)?.name || "All sources";
}

/* -------------------------------------------- Browser bindings -------------------------------------------- */
/*
 * The functions above are pure and injectable so they can be unit-tested. The two below bind the
 * 2014/2024 classification to `SourceUtil` (a browser global), and are the only entry points UI code
 * needs — so the binding lives in exactly one place.
 */

/** Whether `source` may be picked by the character in `state`. */
export function isSourceAllowedForState (state, source) {
	return isSourceAllowed(source, state?.sourceFilter, {isClassic: src => SourceUtil.isClassicSource(src)});
}

/** A `source => boolean` predicate for the character in `state`, or null when everything is allowed. */
export function getStateSourcePredicate (state) {
	return getSourceFilterPredicate(state?.sourceFilter, {isClassic: src => SourceUtil.isClassicSource(src)});
}

/**
 * The item picker, restricted to the character's allowed sources.
 *
 * Upstream's `SearchWidget.pGetUserItemSearch()` takes no options, so there is no way to pass a
 * filter into it; this rebuilds the same index and transform over the lower-level entity search,
 * which does accept `fnFilterResults`. Keeping it here avoids editing an upstream file.
 */
export async function pGetUserItemSearchFiltered (state) {
	await SearchWidget.pLoadCustomIndex({
		contentIndexName: "entity_Items",
		errorName: "items",
		customIndexSubSpecs: [
			new SearchWidget.CustomIndexSubSpec({
				dataSource: async () => {
					const allItems = (await Renderer.item.pBuildList()).filter(it => !it._isItemGroup);
					return {
						item: allItems.filter(it => !(it.type && DataUtil.itemType.unpackUid(it.type).abbreviation === Parser.ITM_TYP_ABV__GENERIC_VARIANT)),
					};
				},
				prop: "item",
				catId: Parser.CAT_ID_ITEM,
				page: UrlUtil.PG_ITEMS,
			}),
		],
	});

	const opts = {
		fnTransform: doc => {
			const cpy = MiscUtil.copyFast(doc);
			Object.assign(cpy, SearchWidget.docToPageSourceHash(cpy));
			cpy.tag = `{@item ${doc.n}${doc.s !== Parser.SRC_DMG ? `|${doc.s}` : ""}}`;
			return cpy;
		},
	};
	const fnAllowed = getStateSourcePredicate(state);

	// A 2024 item supersedes the 2014 one it reprints, so only one of the two Longswords is offered.
	// Built from what this character is allowed, so a 2014-only filter supersedes nothing
	let superseded = null;
	if (isPreferringReprints(state?.sourceFilter)) {
		const allItems = (await Renderer.item.pBuildList()).filter(it => !fnAllowed || fnAllowed(it.source));
		superseded = getSupersededKeys(allItems);
	}

	if (fnAllowed || superseded?.size) {
		opts.fnFilterResults = doc => {
			if (fnAllowed && !fnAllowed(doc.s)) return false;
			return !superseded?.has(`${doc.n}|${doc.s}`.toLowerCase());
		};
	}

	return SearchWidget.pGetUserEntitySearch("Select Item", "entity_Items", opts);
}

/**
 * The sources a character actually uses, as `{source, label}` — so picks made outside the current
 * filter can be flagged without hiding them.
 */
export function getUsedSources (state) {
	const out = new Map();
	const add = (source, label) => {
		if (!source) return;
		if (!out.has(source)) out.set(source, []);
		if (label && !out.get(source).includes(label)) out.get(source).push(label);
	};

	(state?.classes || []).forEach(cls => {
		add(cls.source, cls.name);
		if (cls.subclass) add(cls.subclass.source, cls.subclass.name);
		(cls.optionalFeatures || []).forEach(it => add(it.source, it.name));
		(cls.asiFeatChoices || []).forEach(it => { if (it.type === "feat") add(it.source, it.name); });
	});
	(state?.featureFeats || []).forEach(it => add(it.source, it.name));
	(state?.originFeats || []).forEach(it => add(it.source, it.name));
	(state?.manualFeats || []).forEach(it => add(it.source, it.name));
	(state?.spellsKnown || []).forEach(it => add(it.source, it.name));
	(state?.grantedSpellChoices || []).forEach(it => add(it.source, it.name));
	add(state?.refSpecies?.source, state?.refSpecies?.name);
	add(state?.refBackground?.source, state?.refBackground?.name);

	return [...out.entries()].map(([source, labels]) => ({source, labels}));
}

/** The character's used sources that fall outside `filter` (empty when nothing is out of filter). */
export function getOutOfFilterSources (state, filter, {isClassic = null} = {}) {
	if (isSourceFilterInactive(filter)) return [];
	return getUsedSources(state).filter(it => !isSourceAllowed(it.source, filter, {isClassic}));
}

/* -------------------------------------------- reprints -------------------------------------------- */

/**
 * Drop an entity when the thing it was reprinted as is also on offer.
 *
 * A hundred and sixty of the entries a picker shows are earlier printings of another entry in the
 * same list — Alert from the 2014 book and Alert from the 2024 one, fifty feats and ninety-seven
 * species and subspecies in all — and the data says so, in `reprintedAs`. Nothing read it, so those
 * pickers offered every one of them twice, with nothing on the row to say which was which.
 *
 * Applied *after* the source filter, which is what makes it right in every mode: filtered to the
 * 2014 books, the 2024 reprint is already gone and the original survives.
 *
 * `reprintedAs` is a uid string, or `{uid, tag}` when the reprint is a different kind of thing
 * entirely (a dragonmark subrace became a feat). A cross-kind reprint is never in this list, so it
 * never hides anything — which is the answer that keeps the subrace pickable.
 */
export function filterReprinted (entities) {
	const present = new Set((entities || []).flatMap(_getReprintKeys));

	return (entities || []).filter(ent => {
		const reprints = [ent?.reprintedAs].flat().filter(Boolean);
		if (!reprints.length) return true;

		return !reprints.some(it => {
			const key = _getReprintUidKey(typeof it === "string" ? it : it?.uid);
			return key && present.has(key);
		});
	});
}

/**
 * The identities an entity answers to, for reprint matching.
 *
 * A subclass is named twice — "Path of the Berserker" in `name` and "Berserker" in `shortName` —
 * and a reprint uid names the short one, so both are offered.
 */
function _getReprintKeys (ent) {
	if (!ent?.source) return [];
	return [ent.name, ent.shortName]
		.filter(Boolean)
		.map(name => `${name}|${ent.source}`.toLowerCase());
}

/**
 * A reprint uid reduced to the same identity.
 *
 * Two shapes, and the difference is the *middle*: most things are `"Actor|XPHB"`, while a subclass
 * carries its parent class between the two — `"Berserker|Barbarian|XPHB|XPHB"`. The name is always
 * first and the source always last, which covers both without either being special-cased. Reading
 * the second segment as the source, as the first version did, made every subclass reprint a silent
 * no-match.
 */
function _getReprintUidKey (uid) {
	if (!uid) return null;
	const parts = String(uid).split("|");
	const name = parts[0];
	const source = parts[parts.length - 1];
	return name && source && parts.length > 1 ? `${name}|${source}`.toLowerCase() : null;
}

/**
 * The `name|source` keys {@link filterReprinted} would drop, for callers that cannot filter the
 * entities themselves.
 *
 * The species, background and item pickers are 5etools' own search widget, which is handed *search
 * documents* — a name, a source and a hash, with none of the data a reprint is stated in. So the
 * decision is made here, against the real entities, and the widget is given a set of keys to reject.
 */
export function getSupersededKeys (entities) {
	const kept = new Set(filterReprinted(entities).map(it => it));
	return new Set((entities || [])
		.filter(it => !kept.has(it))
		.filter(it => it?.name && it?.source)
		.map(it => `${it.name}|${it.source}`.toLowerCase()));
}

/**
 * Whether the filter should let a later printing supersede the one it reprints.
 *
 * On by default, which makes the 2024 books the ones a character is built from: where a 2014 entry
 * has a 2024 reprint, only the reprint is offered, and anything the 2024 books never reprinted stays
 * exactly where it was. That last part is why this is not the same as the "2024 rules only" mode —
 * that one drops the 2014 books entirely, and with them every subclass, spell and item the new books
 * did not carry over.
 *
 * Absent means on, so a character saved before this existed gets it too.
 */
export function isPreferringReprints (filter) {
	return filter?.isPreferReprints !== false;
}
