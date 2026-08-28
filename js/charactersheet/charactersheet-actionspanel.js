import {CharacterSheetClassData} from "./charactersheet-classdata.js";
import {CharacterClassPanel} from "./charactersheet-classpanel.js";
import {getUnarmedStrike} from "./charactersheet-derive.js";
import {buildActionEconomy} from "./charactersheet-actions.js";
import {getClassResources, getResourceCostLabel, getSpellcastingMeta, matchResourceLabel} from "./charactersheet-levelengine.js";
import {getFeatureActionBucket, getFeatureCost} from "./charactersheet-features.js";
import {EXPENDABLE_RESOURCES} from "./charactersheet-consts.js";
import {AVAIL_BLOCKED, AVAIL_WARN, annotateEconomy, getItemEntries, getTurnState} from "./charactersheet-availability.js";

/**
 * The Play-mode "Actions" panel: what the character can do each turn, grouped into Actions, Bonus
 * Actions and Reactions — from wielded weapons + the Unarmed Strike, known spells bucketed by
 * casting time, equipped items with charges, and a curated map of common features.
 *
 * Each entry is then checked against live state, so the panel says what is *possible* rather than
 * what merely exists: a spell with no slot left, a wand at zero charges, an empty quiver, a
 * concentration that would be dropped, or a condition that stops the character acting at all.
 */
export class CharacterActionsPanel {
	constructor ({comp, wrp}) {
		this._comp = comp;
		this._wrp = wrp;
		this._renderToken = 0;
	}

	init () {
		// Anything that changes what is available re-renders the panel
		[
			"attacks", "spellsKnown", "classes", "inventory",
			"slotsUsed", "resourcesUsed", "conditions", "concentration", "exhaustion",
		].forEach(prop => this._comp._addHookBase(prop, () => this._pRender()));
		this._pRender();
	}

	/**
	 * Character features for the structured classes, up to each class's level, with what each one
	 * costs and when it is taken.
	 *
	 * Both read from the feature itself. `consumes` says the cost, and the sentence that opens most
	 * of them says the timing — which is how a Way of Mercy monk's Hand of Harm and a Twilight
	 * cleric's Channel Divinity reach this panel at all, neither being in the curated map.
	 *
	 * @param resourceLabels the labels the character actually holds a pool under, so a cost can be
	 *   matched to one; a feature naming a pool this character has no table for keeps its cost as
	 *   text and is never reported as blocked.
	 */
	async _pGetFeatures (resourceLabels = []) {
		const feats = await CharacterSheetClassData.pGetCharacterFeatures(this._comp._state.classes);
		return feats.map(({name, feature, isSubclassFeature}) => {
			const rawCost = getFeatureCost(feature);
			const label = rawCost ? matchResourceLabel(rawCost.resource, resourceLabels) : null;
			return {
				name,
				tag: isSubclassFeature ? CharacterClassPanel._getSubclassFeatureTag(feature) : CharacterClassPanel._getClassFeatureTag(feature),
				bucket: getFeatureActionBucket(feature),
				cost: rawCost ? {...rawCost, label} : null,
				sub: rawCost ? `Costs ${getResourceCostLabel(rawCost)}` : null,
			};
		});
	}

	/** Spell slots and the expendable class resources, from the same data the other panels read. */
	async _pGetLimits () {
		const loaded = await CharacterSheetClassData.pGetLoadedClasses(this._comp._state.classes).catch(() => []);

		const meta = getSpellcastingMeta(loaded.map(({entry, cls, sc}) => ({cls, sc, level: entry.level})));

		const used = this._comp._state.resourcesUsed || {};
		const resources = {};
		loaded.forEach(({entry, cls, sc}) => {
			[...getClassResources(cls, entry.level), ...(sc ? getClassResources(sc, entry.level) : [])]
				.forEach(r => {
					if (!EXPENDABLE_RESOURCES[r.label] || !/^\d+$/.test(String(r.value).trim())) return;
					resources[r.label] = {total: Number(r.value), used: Number(used[r.label]) || 0};
				});
		});

		return {slots: meta.slots || [], pact: meta.pact || null, resources};
	}

	/**
	 * Which known spells need concentration. Read from the spell data rather than stored, so a
	 * character built before this existed is judged the same way as a new one.
	 */
	async _pGetConcentrationNames () {
		const known = this._comp._state.spellsKnown || [];
		if (!known.length) return new Set();

		const all = await CharacterSheetClassData.pGetAllSpells().catch(() => []);
		const byKey = new Map(all.map(sp => [`${sp.name.toLowerCase()}|${sp.source.toLowerCase()}`, sp]));

		const out = new Set();
		known.forEach(sp => {
			const ent = byKey.get(`${String(sp.name).toLowerCase()}|${String(sp.source).toLowerCase()}`);
			if (ent?.duration?.some(d => d?.concentration)) out.add(sp.name);
		});
		return out;
	}

	async _pRender () {
		const token = ++this._renderToken;
		// The limits first: a feature's cost is only a cost if the character holds that pool, and
		// which pools they hold is what `_pGetLimits` works out
		const [limits, concentrationNames] = await Promise.all([
			this._pGetLimits(),
			this._pGetConcentrationNames(),
		]);
		if (token !== this._renderToken) return;
		const features = await this._pGetFeatures(Object.keys(limits.resources));
		if (token !== this._renderToken) return;

		const state = this._comp._getState();
		const economy = buildActionEconomy({
			attacks: state.attacks || [],
			unarmed: getUnarmedStrike(state),
			spells: (state.spellsKnown || []).map(sp => ({...sp, isConcentration: concentrationNames.has(sp.name)})),
			features,
		});
		// An equipped wand is a thing you can do on your turn, so it belongs in the list
		economy.action = [...economy.action, ...getItemEntries(state)];

		const turn = getTurnState(state);
		const annotated = annotateEconomy(economy, {
			state,
			turn,
			slots: limits.slots,
			pact: limits.pact,
			slotsUsed: state.slotsUsed || {},
			resources: limits.resources,
		});

		this._wrp.innerHTML = "";
		this._renderNotes(turn);
		this._renderGroup("Actions", annotated.action);
		this._renderGroup("Bonus Actions", annotated.bonus);
		this._renderGroup("Reactions", annotated.reaction);
	}

	/** What is true of the whole turn: a condition that stops it, exhaustion, being prone. */
	_renderNotes (turn) {
		if (!turn.notes.length) return;
		const wrp = document.createElement("div");
		wrp.className = `cs__turn-notes${turn.isNoActions ? " cs__turn-notes--stop" : ""}`;
		turn.notes.forEach(note => {
			const row = document.createElement("div");
			row.className = "ve-small";
			row.textContent = note;
			wrp.appendChild(row);
		});
		this._wrp.appendChild(wrp);
	}

	_renderGroup (title, items) {
		const wrp = document.createElement("div");
		wrp.className = "ve-mb-2";
		const hdr = document.createElement("div");
		hdr.className = "bold ve-small";
		hdr.textContent = title;
		wrp.appendChild(hdr);

		if (!items.length) {
			wrp.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-small ve-italic">&mdash;</div>`);
			this._wrp.appendChild(wrp);
			return;
		}

		items.forEach(it => {
			const row = document.createElement("div");
			row.className = "ve-small ve-flex-v-baseline cs__act-row";
			if (it.status === AVAIL_BLOCKED) row.classList.add("cs__act-row--blocked");
			if (it.status === AVAIL_WARN) row.classList.add("cs__act-row--warn");

			let label;
			if (it.kind === "spell") label = Renderer.get().render(`{@spell ${it.label}${it.source && it.source.toLowerCase() !== "phb" ? `|${it.source}` : ""}}`);
			else if (it.kind === "item") label = Renderer.get().render(`{@item ${it.label}${it.source && it.source.toLowerCase() !== "phb" ? `|${it.source}` : ""}}`);
			else if (it.kind === "feature" && it.tag) label = Renderer.get().render(it.tag);
			else label = `<span>${it.label.qq()}</span>`;

			const ptSub = it.sub ? ` <span class="ve-muted">(${it.sub.qq()})</span>` : "";
			const ptReason = it.reason ? ` <span class="cs__act-reason">${it.reason.qq()}</span>` : "";
			row.innerHTML = `${label}${ptSub}${ptReason}`;
			wrp.appendChild(row);
		});
		this._wrp.appendChild(wrp);
	}
}
