import {CharacterSheetClassData} from "./charactersheet-classdata.js";
import {getCantripsKnown, getDynamicSpellGrants, getFixedSpellsKnownGrants, getGrantedSpellUids, getInnateSpellCastingNote, getInnateSpellGrants, getPreparedSpellCount, getSpellcastingMeta, getSpellsKnown, isSpellMatchingFilter} from "./charactersheet-levelengine.js";
import {deriveCharacterSheet, getAbilityModifier, hasSpellcasting} from "./charactersheet-derive.js";
import {getSpellSummary, normaliseCastTime} from "./charactersheet-actions.js";

/**
 * Tracked spellcasting: the known/prepared spell list (validated against the character's class
 * spell lists) and checkbox-per-slot expenditure tracking fed by the leveling engine.
 */
export class CharacterSpellsPanel {
	constructor ({comp, wrpSlots, wrpKnown, wrpPanel = null, wrpBody = null}) {
		this._comp = comp;
		this._wrpPanel = wrpPanel;
		this._wrpBody = wrpBody;
		this._wrpSlots = wrpSlots;
		this._wrpKnown = wrpKnown;
		this._renderToken = 0;
	}

	init () {
		this._comp._addHookBase("classes", () => {
			this._pRenderSlots();
			this._pRenderKnown(); // granted (subclass) spells depend on class/subclass
		});
		this._comp._addHookBase("slotsUsed", () => this._pRenderSlots());
		this._comp._addHookBase("spellsKnown", () => {
			this._pRenderKnown();
			this._pRenderSlots(); // known counts live in the slots block
		});
		this._comp._addHookBase("grantedSpellChoices", () => this._pRenderKnown());
		// Whether the character has spellcasting at all can change from any of these
		["inventory", "spellsText", "spellAbility", "spellsKnown", "grantedSpellChoices", "classes"]
			.forEach(prop => this._comp._addHookBase(prop, () => this._pRenderVisibility()));
		// The spell-summary numbers depend on the spellcasting ability score/level, so refresh on those too.
		["spellAbility", "level", "abil_int", "abil_wis", "abil_cha"].forEach(prop => this._comp._addHookBase(prop, () => this._pRenderKnown()));
		document.getElementById("cs-spell-add").addEventListener("click", () => this._pOnAddSpell());
		const btnBrowse = document.getElementById("cs-spell-browse");
		if (btnBrowse) btnBrowse.addEventListener("click", () => this._pOnBrowseClassSpells());

		this._pRenderKnown();
		this._pRenderSlots();
		this._pRenderVisibility();
	}

	/**
	 * A character with no spellcasting from any source keeps only the panel's header, so the page
	 * is not half spell furniture for a Fighter — while "Add Spell" stays reachable for a spell the
	 * DM hands out. Adding one brings the rest of the panel back.
	 */
	async _pRenderVisibility () {
		if (!this._wrpBody) return;
		const loaded = await this._pGetLoadedClasses();
		const meta = getSpellcastingMeta(loaded.map(({entry, cls, sc}) => ({cls, sc, level: entry.level})));
		const isClassCaster = !!(meta.slots?.some(Boolean) || meta.pact);
		const isCaster = hasSpellcasting(this._comp._state, {isClassCaster});

		this._wrpBody.classList.toggle("ve-hidden", !isCaster);
		this._wrpPanel?.classList.toggle("cs__panel--quiet", !isCaster);
		// "Class Spells" browses the class's learnable list — only a class caster has one, even if
		// a species or an item has given this character a spell of their own
		document.getElementById("cs-spell-browse")?.classList.toggle("ve-hidden", !isClassCaster);
	}

	/** Cache spell entities by "name|source" (lowercased) for enriching the known list with cast details. */
	async _pEnsureSpellData () {
		if (this._spellByKey) return this._spellByKey;
		// Unfiltered: this index resolves spells the character already knows, which a source filter must never hide.
		const all = await CharacterSheetClassData.pGetAllSpellsUnfiltered().catch(() => []);
		this._spellByKey = new Map();
		this._spellByName = new Map();
		all.forEach(sp => {
			this._spellByKey.set(`${sp.name.toLowerCase()}|${sp.source.toLowerCase()}`, sp);
			if (!this._spellByName.has(sp.name.toLowerCase())) this._spellByName.set(sp.name.toLowerCase(), sp);
		});
		return this._spellByKey;
	}

	/** Spells the character's classes/subclasses grant automatically (domain/patron/circle lists). */
	async _pGetGrantedSpells () {
		const loaded = await this._pGetLoadedClasses();
		const byKey = await this._pEnsureSpellData();
		const out = [];
		const seen = new Set();
		const add = (uid, {cls, castingNote = null}) => {
			const [name, source] = uid.split("|");
			const spEnt = byKey.get(`${name}|${(source || "phb").toLowerCase()}`) || this._spellByName.get(name);
			const resolved = {
				name: spEnt?.name || name.replace(/\b\w/g, c => c.toUpperCase()),
				source: spEnt?.source || (source || "PHB").toUpperCase(),
				level: spEnt?.level ?? 0,
				className: cls?.name || null,
				granted: true,
				castingNote,
			};
			const key = `${resolved.name.toLowerCase()}|${resolved.source.toLowerCase()}`;
			if (seen.has(key)) return;
			seen.add(key);
			out.push(resolved);
		};

		loaded.forEach(({entry, cls, sc}) => {
			[cls, sc].forEach(ent => {
				if (!ent) return;
				getGrantedSpellUids(ent, entry.level).forEach(uid => add(uid, {cls}));
				// The innate bucket's frequency wrappers, which the uid reader cannot see into. Each
				// carries how it is cast, because a Way of Shadow monk's Darkness costs Ki, not a slot
				getInnateSpellGrants(ent, entry.level).forEach(grant => add(grant.uid, {cls, castingNote: getInnateSpellCastingNote(grant)}));
			});
		});
		return out;
	}

	/**
	 * The dynamic `additionalSpells` grants a character has: `{choose}` picks still to resolve
	 * (a domain/patron "choose a spell of level ≤ X") and `{all}` entries that widen the learnable
	 * pool. Each pick carries a stable `grantKey` so its selection survives re-renders.
	 */
	async _pGetDynamicGrants () {
		const loaded = await this._pGetLoadedClasses();
		const out = [];
		loaded.forEach(({entry, cls, sc}) => {
			[[cls, cls?.name], [sc, sc?.name]].forEach(([ent, entName]) => {
				if (!ent) return;
				// Mystic Arcanum and its like are picks at a fixed spell level, expressed in the same
				// shape so this one chooser resolves both
				[...getDynamicSpellGrants(ent, entry.level), ...getFixedSpellsKnownGrants(ent, entry.level)].forEach(grant => {
					out.push({
						...grant,
						grantKey: `${entry.id}:${entName}:${grant.id}`,
						sourceName: grant.groupName || entName,
						className: cls?.name || null,
					});
				});
			});
		});
		return out;
	}

	/** Spell entities matching a dynamic grant's filter (or its explicit `from` list). */
	async _pGetSpellsForGrant (grant) {
		const byKey = await this._pEnsureSpellData();
		if (grant.from?.length) {
			return grant.from
				.map(uid => {
					const [name, source] = uid.split("|");
					return byKey.get(`${name}|${(source || "phb").toLowerCase()}`) || this._spellByName.get(name);
				})
				.filter(Boolean);
		}
		const all = await CharacterSheetClassData.pGetAllSpells().catch(() => []);
		return all.filter(sp => isSpellMatchingFilter(CharacterSpellsPanel._getSpellWithClasses(sp), grant.filter));
	}

	/** Annotate a spell entity with the class names it appears on, for filter matching. */
	static _getSpellWithClasses (sp) {
		if (sp._csClassNames) return sp;
		sp._csClassNames = [
			...Renderer.spell.getCombinedClasses(sp, "fromClassList"),
			...Renderer.spell.getCombinedClasses(sp, "fromClassListVariant"),
		].map(c => c.name).filter(Boolean);
		return sp;
	}

	async _pOnChooseGrantedSpell (grant) {
		// Exclude by name, not name+source: the same spell reprinted in two books is still one spell.
		const chosenKeys = new Set((this._comp._state.grantedSpellChoices || [])
			.filter(it => it.grantKey === grant.grantKey)
			.map(it => it.name.toLowerCase()));
		const pool = (await this._pGetSpellsForGrant(grant))
			.filter(sp => !chosenKeys.has(sp.name.toLowerCase()))
			.sort((a, b) => (a.level - b.level) || SortUtil.ascSortLower(a.name, b.name));
		if (!pool.length) return;

		const picked = await InputUiUtil.pGetUserEnum({
			values: pool,
			isResolveItem: true,
			fnDisplay: sp => `${sp.name} (${sp.level === 0 ? "cantrip" : Parser.spLevelToFull(sp.level)}, ${Parser.sourceJsonToAbv(sp.source)})`,
			title: `${grant.sourceName}: choose a spell`,
			placeholder: "Select a spell...",
		});
		if (picked == null) return;
		this._comp.addGrantedSpellChoice({
			grantKey: grant.grantKey,
			name: picked.name,
			source: picked.source,
			level: picked.level,
			className: grant.className,
		});
	}

	/** Pending/!resolved dynamic spell picks, rendered above the known list. */
	_renderDynamicGrantChoosers (grants) {
		const chooseGrants = grants.filter(g => g.type === "choose");
		if (!chooseGrants.length) return;

		const chosenAll = this._comp._state.grantedSpellChoices || [];
		const wrp = document.createElement("div");
		wrp.className = "ve-mb-1";

		chooseGrants.forEach(grant => {
			const chosen = chosenAll.filter(it => it.grantKey === grant.grantKey);
			const row = document.createElement("div");
			row.className = "ve-small ve-mb-1 ve-flex-v-center ve-flex-wrap";

			const lbl = document.createElement("span");
			const remaining = grant.count - chosen.length;
			lbl.className = remaining > 0 ? "ve-text-danger bold ve-mr-1" : "ve-muted ve-mr-1";
			// A fixed-level grant names its spell level, because the 2024 Warlock calls all four
			// "Mystic Arcanum" and only the level tells them apart
			lbl.textContent = grant.spellLevel != null
				? `${grant.sourceName} (${Parser.getOrdinalForm(grant.spellLevel)}-level spell) (${chosen.length}/${grant.count}): `
				: `${grant.sourceName} spell (${chosen.length}/${grant.count}): `;
			row.appendChild(lbl);

			chosen.forEach(sp => {
				const spn = document.createElement("span");
				spn.className = "ve-mr-1";
				spn.innerHTML = Renderer.get().render(`{@spell ${sp.name}|${sp.source}}`);
				const btnRm = document.createElement("button");
				btnRm.type = "button";
				btnRm.className = "ve-btn ve-btn-xxs ve-btn-default no-print ve-ml-1";
				btnRm.title = `Remove ${sp.name}`;
				btnRm.textContent = "×";
				btnRm.addEventListener("click", () => this._comp.removeGrantedSpellChoice(sp.id));
				spn.appendChild(btnRm);
				row.appendChild(spn);
			});

			if (remaining > 0) {
				const btn = document.createElement("button");
				btn.type = "button";
				btn.className = "ve-btn ve-btn-xxs ve-btn-primary no-print";
				btn.textContent = "Choose spell...";
				btn.addEventListener("click", () => this._pOnChooseGrantedSpell(grant));
				row.appendChild(btn);
			}

			wrp.appendChild(row);
		});

		this._wrpKnown.appendChild(wrp);
	}

	/* -------------------------------------------- Class-filtered spell manager -------------------------------------------- */

	/** Highest leveled-spell level the character can cast (from slot tables / pact magic). */
	static _getMaxSpellLevel (meta) {
		let maxLevel = meta.pact ? meta.pact.level : 0;
		if (meta.slots) maxLevel = Math.max(maxLevel, meta.slots.reduce((m, n, i) => (n > 0 ? i + 1 : m), 0));
		return maxLevel;
	}

	/**
	 * Manage a caster class's spells from a list restricted to that class and to the levels the
	 * character can actually learn (cantrips + leveled spells up to the highest slot level). This is
	 * the class-scoped alternative to the free-form search, so players never wade through off-list spells.
	 */
	async _pOnBrowseClassSpells () {
		const loaded = await this._pGetLoadedClasses();
		const casters = loaded.filter(({cls, sc}) => [cls, sc].some(it => it?.casterProgression || it?.spellcastingAbility || it?.cantripProgression || it?.spellsKnownProgression));
		if (!casters.length) return JqueryUtil.doToast({type: "warning", content: "This character has no spellcasting class yet."});

		let target = casters[0];
		if (casters.length > 1) {
			const name = await InputUiUtil.pGetUserEnum({
				values: casters.map(c => c.entry.name),
				isResolveItem: true,
				title: "Manage spells for which class?",
				placeholder: "Select a class...",
			});
			if (name == null) return;
			target = casters.find(c => c.entry.name === name) || target;
		}

		const {entry, cls, sc} = target;
		const className = cls?.name || entry.name;

		const meta = getSpellcastingMeta([{cls, sc, level: entry.level}]);
		const maxLevel = CharacterSpellsPanel._getMaxSpellLevel(meta);
		const cantripEnt = [cls, sc].find(it => it?.cantripProgression);
		const hasCantrips = !!(cantripEnt && getCantripsKnown(cantripEnt, entry.level));

		const spells = (await CharacterSheetClassData.pGetSpellsForClass(className))
			.filter(sp => (sp.level === 0 ? hasCantrips : sp.level <= Math.max(maxLevel, 1)));
		if (!spells.length) return JqueryUtil.doToast({type: "warning", content: `No learnable ${className} spells found at this level.`});

		const knownKeys = new Set(this._comp._state.spellsKnown
			.filter(it => (it.className || null) === (className || null))
			.map(it => `${it.name}|${it.source}`));
		const values = spells.map(sp => {
			const ptSrc = sp.source !== Parser.SRC_PHB ? ` (${Parser.sourceJsonToAbv(sp.source)})` : "";
			const ptLvl = sp.level === 0 ? "Cantrip" : Parser.spLevelToFull(sp.level);
			const ptRit = sp.meta?.ritual ? " [ritual]" : "";
			return `${sp.name}${ptSrc} — ${ptLvl}${ptRit}`;
		});
		const defaults = spells.map((sp, ix) => (knownKeys.has(`${sp.name}|${sp.source}`) ? ix : null)).filter(ix => ix != null);

		// Show this class's allowances so players know how many to pick
		const limits = [];
		if (cantripEnt) {
			const maxCantrips = getCantripsKnown(cantripEnt, entry.level);
			if (maxCantrips != null) limits.push(`${maxCantrips} cantrip${maxCantrips === 1 ? "" : "s"}`);
		}
		const knownEnt = [cls, sc].find(it => it?.spellsKnownProgression);
		const preparedEnt = [cls, sc].find(it => it?.preparedSpells || it?.preparedSpellsProgression);
		if (knownEnt) {
			const maxKnown = getSpellsKnown(knownEnt, entry.level);
			if (maxKnown != null) limits.push(`${maxKnown} spells known`);
		} else if (preparedEnt) {
			const abv = preparedEnt.spellcastingAbility;
			const maxPrep = getPreparedSpellCount(preparedEnt, entry.level, abv ? getAbilityModifier(this._comp._getState(), abv) : 0);
			if (maxPrep != null) limits.push(`${maxPrep} spells prepared`);
		}
		const ptLimits = limits.length ? ` You can have <b>${limits.join("</b> and <b>")}</b>.` : "";

		const ixs = await InputUiUtil.pGetUserMultipleChoice({
			title: `${className} Spells`,
			htmlDescription: `<div class="ve-muted ve-small ve-mb-1">Showing cantrips and spells up to ${maxLevel ? Parser.spLevelToFull(maxLevel) : "your castable"} level.${ptLimits} Tick the spells this class knows or has prepared.</div>`,
			values,
			defaults,
			max: values.length, // no hard cap; over-selection is surfaced as a warning in the counts row
			isSearchable: true,
			fnGetSearchText: v => v,
		});
		if (ixs == null || typeof ixs === "symbol") return;

		const chosen = ixs.map(ix => {
			const sp = spells[ix];
			return {name: sp.name, source: sp.source, level: sp.level, ritual: !!sp.meta?.ritual, castTime: normaliseCastTime(sp.time)};
		});
		this._comp.setKnownSpellsForClass(className, chosen);
	}

	/* -------------------------------------------- Slots -------------------------------------------- */

	_pGetLoadedClasses () {
		return CharacterSheetClassData.pGetLoadedClasses(this._comp._state.classes);
	}

	async _pRenderSlots () {
		const token = ++this._renderToken;
		const loaded = await this._pGetLoadedClasses();
		if (token !== this._renderToken) return;

		const meta = getSpellcastingMeta(loaded.map(({entry, cls, sc}) => ({cls, sc, level: entry.level})));
		this._wrpSlots.innerHTML = "";
		if (!meta.slots?.some(Boolean) && !meta.pact) return;

		const slotsUsed = this._comp._state.slotsUsed || {};

		const renderSlotRow = ({label, count, used, onSet}) => {
			const row = document.createElement("div");
			row.className = "ve-flex-v-center ve-small ve-mb-1";
			const lbl = document.createElement("span");
			lbl.className = "ve-muted ve-mr-1";
			lbl.style.width = "42px";
			lbl.textContent = label;
			row.appendChild(lbl);
			for (let i = 0; i < count; ++i) {
				const cb = document.createElement("input");
				cb.type = "checkbox";
				cb.className = "ve-mr-1";
				cb.title = "Expend/restore this slot";
				cb.checked = i < used;
				cb.addEventListener("change", () => onSet((i + 1 === used) ? i : i + 1));
				row.appendChild(cb);
			}
			this._wrpSlots.appendChild(row);
		};

		(meta.slots || []).forEach((count, ix) => {
			if (!count) return;
			const level = ix + 1;
			renderSlotRow({
				label: Parser.spLevelToFull(level),
				count,
				used: Math.min(count, Number(slotsUsed[level]) || 0),
				onSet: used => this._comp.setSlotsUsed(level, used),
			});
		});

		if (meta.pact) {
			renderSlotRow({
				label: "Pact",
				count: meta.pact.count,
				used: Math.min(meta.pact.count, Number(slotsUsed.pact) || 0),
				onSet: used => this._comp.setSlotsUsed("pact", used),
			});
			const note = document.createElement("div");
			note.className = "ve-muted ve-small ve-mb-1";
			note.textContent = `Pact slots are ${Parser.spLevelToFull(meta.pact.level)}-level`;
			this._wrpSlots.appendChild(note);
		}

		const countItems = this._getSpellCountItems(loaded);
		if (countItems.length) this._wrpSlots.appendChild(this._getCountsLine(countItems));

		const btnReset = document.createElement("button");
		btnReset.type = "button";
		btnReset.className = "ve-btn ve-btn-xxs ve-btn-default no-print";
		btnReset.textContent = "Restore all slots";
		btnReset.addEventListener("click", () => this._comp._state.slotsUsed = {});
		this._wrpSlots.appendChild(btnReset);
	}

	/** Cantrip / known-or-prepared counts vs the class progressions (granted spells don't count). */
	_getSpellCountItems (loaded) {
		const known = this._comp._state.spellsKnown || [];
		const state = this._comp._getState();
		const out = [];
		loaded.forEach(({entry, cls, sc}) => {
			const clsName = cls?.name;
			const mine = known.filter(it => !it.className || it.className === clsName);
			const cntCantrips = mine.filter(it => it.level === 0).length;
			const cntLeveled = mine.filter(it => it.level > 0).length;

			const cantripEnt = [cls, sc].find(it => it?.cantripProgression);
			if (cantripEnt) {
				const maxCantrips = getCantripsKnown(cantripEnt, entry.level);
				if (maxCantrips != null) out.push({text: `Cantrips: ${cntCantrips}/${maxCantrips}`, isOver: cntCantrips > maxCantrips});
			}

			const knownEnt = [cls, sc].find(it => it?.spellsKnownProgression);
			const preparedEnt = [cls, sc].find(it => it?.preparedSpells || it?.preparedSpellsProgression);
			if (knownEnt) {
				const maxKnown = getSpellsKnown(knownEnt, entry.level);
				if (maxKnown != null) out.push({text: `Spells known: ${cntLeveled}/${maxKnown}`, isOver: cntLeveled > maxKnown});
			} else if (preparedEnt) {
				const abv = preparedEnt.spellcastingAbility;
				const mod = abv ? getAbilityModifier(state, abv) : 0;
				const maxPrep = getPreparedSpellCount(preparedEnt, entry.level, mod);
				if (maxPrep != null) out.push({text: `Spells prepared: ${cntLeveled}/${maxPrep}`, isOver: cntLeveled > maxPrep});
			}
		});
		return out;
	}

	_getCountsLine (countItems, {isBold = false} = {}) {
		const disp = document.createElement("div");
		disp.className = `ve-small ${isBold ? "ve-mb-1" : ""}`;
		disp.innerHTML = countItems
			.map(c => `<span class="${c.isOver ? "ve-text-danger bold" : "ve-muted"}" title="${c.isOver ? "Over the usual limit" : ""}">${c.text.qq()}</span>`)
			.join(`<span class="ve-muted"> &middot; </span>`);
		return disp;
	}

	/* -------------------------------------------- Known spells -------------------------------------------- */

	async _pRenderKnown () {
		const token = (this._knownToken = (this._knownToken || 0) + 1);
		const known = this._comp._state.spellsKnown || [];
		this._wrpKnown.innerHTML = "";

		const byKey = await this._pEnsureSpellData();
		if (token !== this._knownToken) return;
		const granted = await this._pGetGrantedSpells();
		if (token !== this._knownToken) return;
		const dynamicGrants = await this._pGetDynamicGrants();
		if (token !== this._knownToken) return;

		// Spells picked for a {choose} grant are granted too, so show them with the always-prepared list.
		// A fixed-level pick is not always prepared, though: a Mystic Arcanum is cast once per long
		// rest and never out of a slot, so it carries that note instead.
		const noteByGrantKey = new Map(dynamicGrants
			.filter(g => g.spellLevel != null)
			.map(g => [g.grantKey, "once per long rest"]));
		const chosenGranted = (this._comp._state.grantedSpellChoices || [])
			.map(it => ({name: it.name, source: it.source, level: it.level, className: it.className, granted: true, castingNote: noteByGrantKey.get(it.grantKey) || null}));

		// A granted spell already chosen manually shouldn't appear twice.
		const knownKeys = new Set(known.map(it => `${it.name.toLowerCase()}|${(it.source || "").toLowerCase()}`));
		const grantedSeen = new Set();
		const grantedShown = [...granted, ...chosenGranted].filter(sp => {
			const key = `${sp.name.toLowerCase()}|${sp.source.toLowerCase()}`;
			if (knownKeys.has(key) || grantedSeen.has(key)) return false;
			grantedSeen.add(key);
			return true;
		});

		const hasChoosers = dynamicGrants.some(g => g.type === "choose");
		if (!known.length && !grantedShown.length && !hasChoosers) return;
		const derivedSpell = deriveCharacterSheet(this._comp._getState()).spell;

		// Prominent counts right above the list, so players see how many they may pick (red when over)
		const countItems = this._getSpellCountItems(await this._pGetLoadedClasses());
		if (token !== this._knownToken) return;
		if (countItems.length) this._wrpKnown.appendChild(this._getCountsLine(countItems, {isBold: true}));

		this._renderDynamicGrantChoosers(dynamicGrants);

		const renderGroup = (heading, spells, {isGranted = false} = {}) => {
			if (heading) {
				const hdr = document.createElement("div");
				hdr.className = "bold ve-small ve-mt-1";
				hdr.textContent = heading;
				this._wrpKnown.appendChild(hdr);
			}
			const byLevel = {};
			spells.forEach(spell => (byLevel[spell.level] = byLevel[spell.level] || []).push(spell));
			Object.keys(byLevel).map(Number).sort((a, b) => a - b).forEach(level => {
				const hdr = document.createElement("div");
				hdr.className = "ve-muted ve-small ve-mt-1";
				hdr.textContent = level === 0 ? "Cantrips" : Parser.spLevelToFull(level);
				this._wrpKnown.appendChild(hdr);
				byLevel[level]
					.sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1)
					.forEach(spell => this._wrpKnown.appendChild(this._getKnownSpellRow(spell, byKey, derivedSpell, {isGranted})));
			});
		};

		// Group by class only when the character actually spreads spells across multiple classes
		const distinctClasses = new Set(known.map(it => it.className).filter(Boolean));
		if (distinctClasses.size > 1) {
			[...distinctClasses].sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1)
				.forEach(className => renderGroup(className, known.filter(it => it.className === className)));
			const unattributed = known.filter(it => !it.className);
			if (unattributed.length) renderGroup(null, unattributed);
		} else if (known.length) {
			renderGroup(null, known);
		}

		if (grantedShown.length) renderGroup("Always Prepared (subclass)", grantedShown, {isGranted: true});
	}

	/** One known-spell row: the spell link (+ ritual marker), a compact cast summary, and a remove button (or a granted marker). */
	_getKnownSpellRow (spell, byKey, derivedSpell, {isGranted = false} = {}) {
		const row = document.createElement("div");
		row.className = "ve-small ve-mb-1 ve-flex-v-baseline";

		const spn = document.createElement("span");
		spn.className = "ve-mr-1";
		const ptRitual = spell.ritual ? ` <span class="ve-muted" title="Ritual">(R)</span>` : "";
		spn.innerHTML = Renderer.get().render(`{@spell ${spell.name}${spell.source?.toLowerCase() !== "phb" ? `|${spell.source}` : ""}}`) + ptRitual;
		row.appendChild(spn);

		const ent = byKey.get(`${spell.name.toLowerCase()}|${(spell.source || "").toLowerCase()}`);
		const summary = getSpellSummary(ent, derivedSpell);
		if (summary) {
			const spnSum = document.createElement("span");
			spnSum.className = "ve-muted ve-mr-1";
			spnSum.textContent = `— ${summary}`;
			row.appendChild(spnSum);
		}

		if (isGranted) {
			const badge = document.createElement("span");
			badge.className = "ve-muted ve-small ve-ml-auto ve-italic";
			// An innate grant says how it is paid for; everything else is simply always prepared
			badge.textContent = spell.castingNote || "always prepared";
			row.appendChild(badge);
			return row;
		}

		const btnRm = document.createElement("button");
		btnRm.type = "button";
		btnRm.className = "ve-btn ve-btn-xxs ve-btn-default no-print ve-ml-auto";
		btnRm.title = `Remove ${spell.name}`;
		btnRm.textContent = "×";
		btnRm.addEventListener("click", () => this._comp.removeKnownSpell(spell.id));
		row.appendChild(btnRm);
		return row;
	}

	/** Names of the character's classes that can cast spells. */
	async _pGetCasterClassNames () {
		const loaded = await this._pGetLoadedClasses();
		return loaded
			.filter(({cls, sc}) => [cls, sc].some(it => it?.casterProgression || it?.spellcastingAbility || it?.cantripProgression || it?.spellsKnownProgression))
			.map(({entry}) => entry.name);
	}

	async _pOnAddSpell () {
		await SearchUiUtil.pDoGlobalInit();
		SearchWidget.pDoGlobalInit();
		const doc = await SearchWidget.pGetUserSpellSearch();
		if (!doc) return;
		const ent = await DataLoader.pCacheAndGet(doc.page, doc.source, doc.hash, {isCopy: true});

		// Attribute the spell to a class: automatic for a single caster, prompted for multiclass casters
		const casterNames = await this._pGetCasterClassNames();
		let className = null;
		if (casterNames.length === 1) className = casterNames[0];
		else if (casterNames.length > 1) {
			className = await InputUiUtil.pGetUserEnum({
				values: casterNames,
				isResolveItem: true,
				title: "Which class learns this spell?",
				placeholder: "Select a class...",
			});
			if (className == null) return; // cancelled
		}

		// Validate against the attributed class's spell list (or all classes when unattributed);
		// loose name match, since 2014/2024 lists reference each other's classes by name
		if (ent) {
			const spellClasses = [
				...Renderer.spell.getCombinedClasses(ent, "fromClassList"),
				...Renderer.spell.getCombinedClasses(ent, "fromClassListVariant"),
			].map(it => it.name?.toLowerCase()).filter(Boolean);
			const namesToCheck = className ? [className] : this._comp._state.classes.map(it => it.name);
			const isOnList = namesToCheck.some(name => spellClasses.includes(name.toLowerCase()));
			if (!isOnList && spellClasses.length && namesToCheck.length) {
				JqueryUtil.doToast({type: "warning", content: `${doc.n} is not on the ${namesToCheck.join("/")} spell list${namesToCheck.length > 1 ? "s" : ""}.`});
			}
		}

		const isAdded = this._comp.addKnownSpell({name: doc.n, source: doc.source, level: ent?.level ?? 0, className, ritual: !!ent?.meta?.ritual, castTime: normaliseCastTime(ent?.time)});
		if (!isAdded) JqueryUtil.doToast({type: "info", content: `${doc.n} is already in the list.`});
	}
}
