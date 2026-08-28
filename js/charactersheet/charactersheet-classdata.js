/**
 * Shared access layer for class data, for the character sheet/builder.
 *
 * Note that `DataLoader`'s class loader (`DataTypeLoaderCustomClassesSubclass`) already dereferences
 * `classFeatures`/`subclassFeatures` string refs against the top-level `classFeature`/`subclassFeature`
 * arrays, producing a by-level array of resolved feature entries (with `gainSubclassFeature` markers
 * preserved). Everything here builds on that, rather than re-implementing uid parsing.
 */
import {ALL_TOOL_NAMES} from "./charactersheet-choices.js";
import {annotateVariantFeatures, filterActiveFeatures} from "./charactersheet-features.js";
import {filterReprinted} from "./charactersheet-sources.js";

/** Artisan's tools, instrument, gaming set, tool — the item types a proficiency can name. */
const _TOOL_TYPE_ABVS = new Set(["AT", "INS", "GS", "T"]);

export class CharacterSheetClassData {
	/**
	 * Active source-filter predicate (`source => boolean`), or null for "everything".
	 * The underlying entity caches stay unfiltered, so the filter can change at any time; it is
	 * applied on read, and only to the *pickers* — rendering and derivation never consult it.
	 */
	static _fnSourceFilter = null;

	static setSourceFilter (fn) { this._fnSourceFilter = fn || null; }

	static _filterBySource (arr) {
		if (!this._fnSourceFilter) return arr;
		return arr.filter(it => this._fnSourceFilter(it.source));
	}

	/**
	 * A picker's list with earlier printings dropped, applied *after* the source filter so a
	 * 2014-only filter keeps the 2014 printing.
	 *
	 * Deliberately not applied to everything. A **class** is reprinted too — the 2014 Fighter names
	 * the 2024 one — and hiding it would take every 2014 class off the menu, which is a choice a
	 * player makes rather than a duplicate to tidy away. Upstream draws the same line: its feat,
	 * species and background pages deselect reprints by default and its class page does not, because
	 * picking a class from thirteen names is not a list anybody is lost in.
	 */
	static _filterReprints (arr) {
		return filterReprinted(arr);
	}

	static _pAllClasses = null;

	/**
	 * All base classes (site + prerelease + brew), dereferenced, blocklist-filtered, and sorted.
	 * Subclass entities (which lack `hd`) are excluded.
	 */
	static async pGetAllClasses () {
		return this._filterBySource(await this.pGetAllClassesUnfiltered());
	}

	/**
	 * The three Tasha's sidekick classes. They are kept out of `pGetAllClasses` because they have no
	 * hit die of their own — a sidekick's die comes from its stat block — and because they are not
	 * something a player character can take.
	 */
	static pGetAllSidekickClasses () {
		return this._pAllSidekickClasses ||= (async () => {
			const all = [
				...(await DataLoader.pCacheAndGetAllSite(UrlUtil.PG_CLASSES)),
				...(await DataLoader.pCacheAndGetAllPrerelease(UrlUtil.PG_CLASSES)),
				...(await DataLoader.pCacheAndGetAllBrew(UrlUtil.PG_CLASSES)),
			].filter(it => it.isSidekick && !it.className);
			all.sort((a, b) => SortUtil.ascSortLower(a.name, b.name));
			return all;
		})();
	}

	static pGetAllClassesUnfiltered () {
		return this._pAllClasses ||= (async () => {
			const page = UrlUtil.PG_CLASSES;
			const all = [
				...(await DataLoader.pCacheAndGetAllSite(page)),
				...(await DataLoader.pCacheAndGetAllPrerelease(page)),
				...(await DataLoader.pCacheAndGetAllBrew(page)),
			].filter(it => {
				if (!it.hd || it.className) return false;
				const hash = UrlUtil.URL_TO_HASH_BUILDER[page](it);
				return !ExcludeUtil.isExcluded(hash, "class", it.source);
			});
			all.sort((a, b) => SortUtil.ascSortLower(a.name, b.name) || SortUtil.ascSortLower(a.source, b.source));
			return all;
		})();
	}

	/** A single class by name/source, with dereferenced by-level `classFeatures`. */
	static pGetClass ({name, source}) {
		const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CLASSES]({name, source});
		return DataLoader.pCacheAndGet(UrlUtil.PG_CLASSES, source, hash, {isCopy: true});
	}

	static _pAllSubclasses = null;

	/** All subclasses (site + prerelease + brew), dereferenced and blocklist-filtered. */
	static async pGetAllSubclasses () {
		return this._filterBySource(await this.pGetAllSubclassesUnfiltered());
	}

	static pGetAllSubclassesUnfiltered () {
		return this._pAllSubclasses ||= (async () => {
			const page = UrlUtil.PG_CLASSES;
			return [
				...(await DataLoader.pCacheAndGetAllSite(page)),
				...(await DataLoader.pCacheAndGetAllPrerelease(page)),
				...(await DataLoader.pCacheAndGetAllBrew(page)),
			].filter(it => it.className && it.shortName);
		})();
	}

	/** Subclasses available for a given class. */
	static async pGetSubclassesForClass ({className, classSource}) {
		return (await this.pGetAllSubclasses())
			.filter(it => it.className === className && it.classSource === classSource)
			.sort((a, b) => SortUtil.ascSortLower(a.name, b.name) || SortUtil.ascSortLower(a.source, b.source));
	}

	/** Look up a subclass the character already has — unfiltered, so a source filter never hides it. */
	static async pGetSubclass ({className, classSource, shortName, source}) {
		return (await this.pGetAllSubclassesUnfiltered())
			.find(it => it.className === className && it.classSource === classSource && it.shortName === shortName && it.source === source);
	}

	static _pAllOptionalFeatures = null;

	/** All optional features (fighting styles, invocations, maneuvers, ...; site + prerelease + brew). */
	static async pGetAllOptionalFeatures () {
		return this._filterBySource(await this.pGetAllOptionalFeaturesUnfiltered());
	}

	static pGetAllOptionalFeaturesUnfiltered () {
		return this._pAllOptionalFeatures ||= (async () => {
			const page = UrlUtil.PG_OPT_FEATURES;
			return [
				...(await DataLoader.pCacheAndGetAllSite(page)),
				...(await DataLoader.pCacheAndGetAllPrerelease(page)),
				...(await DataLoader.pCacheAndGetAllBrew(page)),
			].filter(it => {
				const hash = UrlUtil.URL_TO_HASH_BUILDER[page](it);
				return !ExcludeUtil.isExcluded(hash, "optionalfeature", it.source);
			});
		})();
	}

	static _pToolNames = null;

	/**
	 * Every tool a character can be proficient with, read from the item data.
	 *
	 * By the item's **type code**, never by its name: matching `" Tools"` would find Smith's Tools and
	 * miss all seven *Supplies* (Alchemist's, Painter's, ...), Cook's Utensils, all 23 instruments and
	 * all five gaming sets — 28 of the 40 in the base file alone. The codes are `AT` artisan's tools,
	 * `INS` instrument, `GS` gaming set, `T` tool, and they span two files, so the built list is used
	 * rather than either file directly.
	 *
	 * Magic items carry the same type codes (a *Horn of Valhalla* is an `INS`), so only base items
	 * count: proficiency is with the kind of tool, not with a particular magical one.
	 */
	static pGetToolProficiencyNames () {
		return this._pToolNames ||= (async () => {
			try {
				const all = await Renderer.item.pBuildList();
				const names = new Set(
					all
						.filter(it => _TOOL_TYPE_ABVS.has(String(it.type || "").split("|")[0]))
						// "Artisan's Tools" and "Gaming Set" are the *category*, not a tool you can be
						// proficient with — the data marks them as groups
						.filter(it => !it._isItemGroup)
						// A *+1 Rhythm-Maker's Drum* is an instrument, but proficiency is with the Drum
						.filter(it => !it.baseItem && !it.wondrous && !it.reqAttune && (!it.rarity || it.rarity === "none"))
						// Base gear, or something with a price — which is what separates a tool anyone can
						// buy from a named treasure that happens to share its type
						.filter(it => it._isBaseItem || it.value != null)
						.map(it => it.name)
						.filter(Boolean),
				);
				const out = [...names].sort(SortUtil.ascSortLower);
				// A filter that matched nothing is a broken read, not an empty world
				return out.length ? out : ALL_TOOL_NAMES;
			} catch (e) {
				return ALL_TOOL_NAMES;
			}
		})();
	}

	static _pAllActions = null;

	/**
	 * The general actions — Dash, Dodge, Hide, Ready, Two-Weapon Fighting.
	 *
	 * From the book's own file, because the two editions differ in ways nobody should be keeping in
	 * their head: 2024 split Search into Study and Influence, and moved Grapple and Shove onto the
	 * Unarmed Strike. Brew is included, so a table that has written its own action gets it too.
	 */
	static pGetAllActions () {
		return this._pAllActions ||= (async () => {
			const page = UrlUtil.PG_ACTIONS;
			return [
				...(await DataLoader.pCacheAndGetAllSite(page)),
				...(await DataLoader.pCacheAndGetAllPrerelease(page)),
				...(await DataLoader.pCacheAndGetAllBrew(page)),
			].filter(it => {
				const hash = UrlUtil.URL_TO_HASH_BUILDER[page](it);
				return !ExcludeUtil.isExcluded(hash, "action", it.source);
			});
		})();
	}

	static _pAllFeats = null;

	/** All feats (site + prerelease + brew), blocklist-filtered and sorted. */
	static async pGetAllFeats () {
		return this._filterReprints(this._filterBySource(await this.pGetAllFeatsUnfiltered()));
	}

	static pGetAllFeatsUnfiltered () {
		return this._pAllFeats ||= (async () => {
			const page = UrlUtil.PG_FEATS;
			const all = [
				...(await DataLoader.pCacheAndGetAllSite(page)),
				...(await DataLoader.pCacheAndGetAllPrerelease(page)),
				...(await DataLoader.pCacheAndGetAllBrew(page)),
			].filter(it => {
				const hash = UrlUtil.URL_TO_HASH_BUILDER[page](it);
				return !ExcludeUtil.isExcluded(hash, "feat", it.source);
			});
			all.sort((a, b) => SortUtil.ascSortLower(a.name, b.name) || SortUtil.ascSortLower(a.source, b.source));
			return all;
		})();
	}

	/**
	 * A single feat by name/source; the `; subtype` suffix in background feat uids is stripped for
	 * lookup. Unfiltered: a feat named by a background the character already has is always resolvable.
	 */
	static async pGetFeat ({name, source}) {
		const baseName = String(name || "").split(";")[0].trim().toLowerCase();
		if (!baseName) return null;
		const feats = await this.pGetAllFeatsUnfiltered();
		const src = String(source || "").toLowerCase();
		return feats.find(f => f.name.toLowerCase() === baseName && f.source.toLowerCase() === src)
			|| feats.find(f => f.name.toLowerCase() === baseName)
			|| null;
	}

	/**
	 * A background by name and source.
	 *
	 * Unfiltered, like `pGetFeat`: a background the character already has must stay resolvable even
	 * when the source filter would no longer offer it. Used by the Background panel and the audit,
	 * both of which describe what the character *has*.
	 */
	static pGetBackground ({name, source}) {
		return this._pGetByHash(UrlUtil.PG_BACKGROUNDS, {name, source});
	}

	/** A species by name and source. See `pGetBackground`. */
	static pGetSpecies ({name, source}) {
		return this._pGetByHash(UrlUtil.PG_RACES, {name, source});
	}

	static async _pGetByHash (page, {name, source}) {
		if (!name || !source) return null;
		try {
			const hash = UrlUtil.URL_TO_HASH_BUILDER[page]({name, source});
			return await DataLoader.pCacheAndGet(page, source, hash, {isCopy: true});
		} catch (e) {
			return null;
		}
	}

	/**
	 * Load the class (and subclass) entity behind each of a character's class entries — what the
	 * panels need before they can read slots, resources or features off the data.
	 * @return {Promise<Array<{entry: Object, cls: Object|null, sc: Object|null}>>}
	 */
	static async pGetLoadedClasses (classes) {
		const out = [];
		for (const entry of classes || []) {
			const cls = await this.pGetClass({name: entry.name, source: entry.source}).catch(() => null);
			const sc = entry.subclass
				? await this.pGetSubclass({
					className: entry.name,
					classSource: entry.source,
					shortName: entry.subclass.shortName,
					source: entry.subclass.source,
				}).catch(() => null)
				: null;
			out.push({entry, cls, sc});
		}
		return out;
	}

	/** All spells from site + prerelease + brew, excluded entries removed. Cached. */
	static async pGetAllSpells () {
		return this._filterBySource(await this.pGetAllSpellsUnfiltered());
	}

	static pGetAllSpellsUnfiltered () {
		return this._pAllSpells ||= (async () => {
			const page = UrlUtil.PG_SPELLS;
			return [
				...(await DataLoader.pCacheAndGetAllSite(page)),
				...(await DataLoader.pCacheAndGetAllPrerelease(page)),
				...(await DataLoader.pCacheAndGetAllBrew(page)),
			].filter(it => {
				const hash = UrlUtil.URL_TO_HASH_BUILDER[page](it);
				return !ExcludeUtil.isExcluded(hash, "spell", it.source);
			});
		})();
	}

	/**
	 * Spells on a class's spell list (by class name; 2014/2024 lists cross-reference each other),
	 * sorted by level then name. Includes both the base and variant class lists.
	 */
	static async pGetSpellsForClass (className) {
		const target = String(className || "").toLowerCase();
		if (!target) return [];
		const all = await this.pGetAllSpells();
		return all
			.filter(sp => [
				...Renderer.spell.getCombinedClasses(sp, "fromClassList"),
				...Renderer.spell.getCombinedClasses(sp, "fromClassListVariant"),
			].some(c => (c.name || "").toLowerCase() === target))
			.sort((a, b) => (a.level - b.level) || SortUtil.ascSortLower(a.name, b.name));
	}

	/** Optional features matching any of the given feature type tags (e.g. ["FS:F"], ["EI"]). */
	static async pGetOptionalFeaturesByTypes (featureTypes) {
		const all = await this.pGetAllOptionalFeatures();
		return all
			.filter(it => (it.featureType || []).some(ft => featureTypes.includes(ft)))
			.sort((a, b) => SortUtil.ascSortLower(a.name, b.name) || SortUtil.ascSortLower(a.source, b.source));
	}

	/**
	 * Base weapons — the types, not the thousands of magic variants — optionally narrowed to a
	 * weapon category ("martial", "simple").
	 *
	 * Read from the item data by `weaponCategory`, which every base weapon carries, rather than by
	 * parsing the `fromFilter` string a feat writes its choice as. The filter says two things
	 * ("martial or mundane weapons", "mundane only") and the item says both of them itself.
	 */
	static async pGetBaseWeapons ({categories = null} = {}) {
		const all = await Renderer.item.pBuildList();
		const wanted = categories ? new Set(categories.map(it => String(it).toLowerCase())) : null;
		const seen = new Set();
		return all
			.filter(it => it.weapon && it._isBaseItem)
			.filter(it => !wanted || wanted.has(String(it.weaponCategory).toLowerCase()))
			.filter(it => !this._fnSourceFilter || this._fnSourceFilter(it.source))
			.filter(it => { const k = it.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
			.map(it => ({name: it.name, source: it.source, weaponCategory: it.weaponCategory}))
			.sort((a, b) => SortUtil.ascSortLower(a.name, b.name));
	}

	/**
	 * All features a character has from its structured classes/subclasses, up to each class's level.
	 * @return {Promise<Array<{name: string, feature: object, isSubclassFeature: boolean}>>}
	 */
	static async pGetCharacterFeatures (classes) {
		const out = [];
		for (const entry of classes || []) {
			const cls = await this.pGetClass({name: entry.name, source: entry.source}).catch(() => null);
			if (!cls) continue;
			const sc = entry.subclass
				? await this.pGetSubclass({className: entry.name, classSource: entry.source, shortName: entry.subclass.shortName, source: entry.subclass.source}).catch(() => null)
				: null;
			this.getActiveFeatureTimeline(cls, {subclass: sc, level: entry.level, featureVariants: entry.featureVariants}).forEach(({feature, isSubclassFeature}) => {
				const {name} = this.getFeatureNameMeta(feature);
				if (name) out.push({name, feature, isSubclassFeature});
			});
		}
		return out;
	}

	/**
	 * Every feature name a character has, including nested sub-features (e.g. a 2014 subclass's
	 * level feature bundles Rakish Audacity, Fancy Footwork, ... as dereferenced sub-entries).
	 * Used to match against curated feature-effect maps.
	 */
	static async pGetCharacterFeatureNames (classes) {
		const feats = await this.pGetCharacterFeatures(classes);
		const names = new Set();
		const collect = node => {
			if (Array.isArray(node)) return node.forEach(collect);
			if (node && typeof node === "object") {
				if (typeof node.name === "string") names.add(node.name);
				if (Array.isArray(node.entries)) collect(node.entries);
			}
		};
		feats.forEach(({name, feature}) => {
			if (name) names.add(name);
			collect(feature?.entries);
		});
		return [...names];
	}

	/**
	 * Display name/source for a dereferenced feature. The dereferencer's entry-nesting step strips
	 * `name`/`source` from wrapper features with a `header`, moving the named content into
	 * `entries[0]`, so resolve by drilling down.
	 */
	static getFeatureNameMeta (feature) {
		let cur = feature;
		while (cur && cur.name == null && Array.isArray(cur.entries)) cur = cur.entries[0];
		return {
			name: cur?.name ?? feature._displayName ?? null,
			source: cur?.source ?? feature.source ?? null,
		};
	}

	/**
	 * Feat categories a feature grants by choice (e.g. 2024 Fighting Style / Epic Boon), read from
	 * `{@filter ...|feats|category=FS}` references in its prose. Returns distinct `{category}` grants.
	 */
	static getFeatureFeatGrants (feature) {
		const cats = new Set();
		const walk = node => {
			if (Array.isArray(node)) return node.forEach(walk);
			if (node && typeof node === "object") {
				// An `options` block is a *menu* — "Eldritch Invocation Options" holds every invocation,
				// one of which (Lessons of the First Ones) grants an Origin feat. Walking into it would
				// have the listing itself grant a feat, which is how a chooser turned up on a card that
				// grants nothing. What an option grants is the option's business, once it is taken.
				if (node.type === "options") return;
				return walk(node.entries);
			}
			if (typeof node !== "string") return;
			const re = /\{@filter [^|}]*\|feats\|([^}]*)\}/g;
			let m;
			while ((m = re.exec(node))) {
				const cat = /category=([^|}]+)/.exec(m[1]);
				// The data writes the category either way round (`category=o`, `category=EB`), and a
				// feat's own `category` is upper case. Normalised here so one spelling reaches the UI
				if (cat) cats.add(cat[1].trim().toUpperCase());
			}
		};
		walk(feature?.entries);
		return [...cats].map(category => ({category}));
	}

	/**
	 * Resolved class feature entries gained at exactly `level`.
	 * Entries flagged `gainSubclassFeature: true` mark where subclass features slot into the timeline.
	 */
	static getClassFeaturesAtLevel (cls, level) {
		return (cls.classFeatures || [])[level - 1] || [];
	}

	/** Resolved subclass feature entries gained at exactly `level`. */
	static getSubclassFeaturesAtLevel (sc, level) {
		return (sc.subclassFeatures || [])
			.flat()
			.filter(it => it.level === level);
	}

	/**
	 * The feature timeline for levels 1..`level`, in gain order, with subclass features (when a
	 * subclass is provided) spliced in at their `gainSubclassFeature` markers.
	 *
	 * Tasha's optional features sit in this list beside the features they replace, so every entry is
	 * annotated with `isVariant` / `isVariantTaken` / `replacedBy` against the class entry's
	 * `featureVariants`. The builder wants the whole list, to offer the ones not taken; everything
	 * else wants `getActiveFeatureTimeline`, which is this minus the options nobody took and the
	 * features a taken option superseded.
	 *
	 * @return {Array<{level: number, feature: object, isSubclassFeature: boolean, isVariant: boolean, isVariantTaken: boolean, replacedBy: ?string}>}
	 */
	static getFeatureTimeline (cls, {subclass = null, level, featureVariants = []}) {
		const out = [];

		for (let lvl = 1; lvl <= level; ++lvl) {
			this.getClassFeaturesAtLevel(cls, lvl).forEach(feature => {
				out.push({level: lvl, feature, isSubclassFeature: false});

				if (!feature.gainSubclassFeature || !subclass) return;

				this.getSubclassFeaturesAtLevel(subclass, lvl)
					.forEach(scFeature => out.push({level: lvl, feature: scFeature, isSubclassFeature: true}));
			});
		}

		return annotateVariantFeatures(out, featureVariants);
	}

	/** {@link getFeatureTimeline}, reduced to the features the character actually has. */
	static getActiveFeatureTimeline (cls, opts) {
		return filterActiveFeatures(this.getFeatureTimeline(cls, opts));
	}
}
