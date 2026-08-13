import {CharacterSheetClassData} from "./charactersheet-classdata.js";
import {
	checkFeatPrerequisites,
	getAsiCount,
	getCantripsKnown,
	getClassResources,
	getExpertiseSkillCount,
	getWeaponMasteryCount,
	getMulticlassRequirementsDisplay,
	getOptionalFeatureCounts,
	getPreparedSpellsChange,
	getPreparedSpellsDisplay,
	getSpellcastingMeta,
	getSpellsKnown,
	isMulticlassRequirementMet,
} from "./charactersheet-levelengine.js";
import {CHAR_SHEET_ABILITIES, CHAR_SHEET_SKILLS, EXPENDABLE_RESOURCES, PROF_STATE_EXPERTISE, PROF_STATE_PROFICIENT} from "./charactersheet-consts.js";
import {pPickAbilities, pResolveFeat} from "./charactersheet-featgrant.js";
import {getStateSourcePredicate} from "./charactersheet-sources.js";

/**
 * The "Class & Leveling" sheet panel: renders the derived feature timeline, subclass and
 * optional-feature choices, and spell slots for the model's structured classes.
 * Re-renders whenever the `classes` collection changes.
 */
export class CharacterClassPanel {
	constructor ({comp, wrp}) {
		this._comp = comp;
		this._wrp = wrp;
		this._renderToken = 0;
	}

	init () {
		this._comp._addHookBase("classes", () => this._pRender());
		// Expertise options depend on which skills are proficient, so refresh that section when skills change.
		CHAR_SHEET_SKILLS.forEach(({key}) => this._comp._addHookBase(`skill_${key}`, () => this._refreshExpertise()));
		// Weapon-mastery options depend on owned weapons and current picks.
		this._comp._addHookBase("inventory", () => this._refreshWeaponMastery());
		this._comp._addHookBase("weaponMasteries", () => this._refreshWeaponMastery());
		// Expended class resources (Rages, Ki, Wild Shape, ...) re-render the timeline's resource rows.
		this._comp._addHookBase("resourcesUsed", () => this._pRender());
		// Feats granted by a feature (Fighting Style, Epic Boon, ...) re-render the timeline.
		this._comp._addHookBase("featureFeats", () => this._pRender());
		this._comp._addHookBase("manualFeats", () => this._pRender());
		// The source filter narrows what the in-card choosers offer.
		this._comp._addHookBase("sourceFilter", () => this._pRender());
		this._pRender();
	}

	/* -------------------------------------------- Tag helpers -------------------------------------------- */

	static _getClassFeatureTag (feature) {
		const {className, classSource, level} = feature;
		const {name, source} = CharacterSheetClassData.getFeatureNameMeta(feature);
		if (!name) return null;
		const ptSource = source && source !== classSource ? `|${source}` : "";
		return `{@classFeature ${name}|${className}${classSource !== Parser.SRC_PHB ? `|${classSource}` : "|"}|${level}${ptSource}}`;
	}

	static _getSubclassFeatureTag (feature) {
		const {className, classSource, subclassShortName, subclassSource, level} = feature;
		const {name, source} = CharacterSheetClassData.getFeatureNameMeta(feature);
		if (!name) return null;
		const ptSource = source && source !== subclassSource ? `|${source}` : "";
		return `{@subclassFeature ${name}|${className}${classSource !== Parser.SRC_PHB ? `|${classSource}` : "|"}|${subclassShortName}${subclassSource !== Parser.SRC_PHB ? `|${subclassSource}` : "|"}|${level}${ptSource}}`;
	}

	static _getOptionalFeatureTag ({name, source}) {
		return `{@optfeature ${name}${source !== Parser.SRC_PHB ? `|${source}` : ""}}`;
	}

	/* -------------------------------------------- Render -------------------------------------------- */

	async _pRender () {
		const token = ++this._renderToken;
		const entries = this._comp._state.classes;

		if (!entries.length) {
			this._wrp.innerHTML = `<div class="ve-muted ve-small">Pick a class (or use Guided Setup) to see features, choices, and spell slots by level.</div>`;
			return;
		}

		// Load entities up front; bail if a newer render superseded this one
		const loaded = [];
		for (const entry of entries) {
			const cls = await CharacterSheetClassData.pGetClass({name: entry.name, source: entry.source}).catch(() => null);
			const sc = entry.subclass
				? await CharacterSheetClassData.pGetSubclass({className: entry.name, classSource: entry.source, shortName: entry.subclass.shortName, source: entry.subclass.source})
				: null;
			loaded.push({entry, cls, sc});
		}
		if (token !== this._renderToken) return;

		// An optional feature can itself grant something — Lessons of the First Ones gives an Origin
		// feat. `entry.optionalFeatures` holds only a name and a source, so the entities are looked
		// up once here and kept for the choosers to read.
		this._optionalFeatureData = new Map();
		try {
			(await CharacterSheetClassData.pGetAllOptionalFeatures())
				.forEach(it => this._optionalFeatureData.set(`${it.name}|${it.source}`, it));
		} catch (e) {
			this._optionalFeatureData = new Map();
		}
		if (token !== this._renderToken) return;

		this._loaded = loaded;
		this._wrp.innerHTML = "";
		this._expertiseBoxes = []; // rebuilt as the Expertise cards render
		this._renderOriginFeats();
		this._renderManualFeats();
		loaded.forEach(meta => this._renderClassSection(meta));
		this._renderSpellcasting(loaded);
		this._renderAddClass();
	}

	/** Origin feats granted by a 2024 background (character-level, above the class sections). */
	_renderOriginFeats () {
		const feats = this._comp._state.originFeats || [];
		if (!feats.length) return;

		const wrp = document.createElement("div");
		wrp.className = "ve-mb-2";
		const head = document.createElement("div");
		head.className = "bold ve-mb-1";
		head.textContent = "Origin Feats";
		wrp.appendChild(head);

		feats.forEach(feat => {
			const row = document.createElement("div");
			row.className = "ve-small ve-mb-1 ve-flex-v-center";
			const lbl = document.createElement("span");
			lbl.innerHTML = Renderer.get().render(`{@feat ${feat.name}|${feat.source}${feat.displayName && feat.displayName !== feat.name ? `|${feat.displayName}` : ""}}`);
			row.appendChild(lbl);
			const btnRm = document.createElement("button");
			btnRm.type = "button";
			btnRm.className = "ve-btn ve-btn-xxs ve-btn-danger ve-ml-2 no-print";
			btnRm.title = "Remove origin feat";
			btnRm.innerHTML = `<span class="glyphicon glyphicon-trash"></span>`;
			btnRm.addEventListener("click", () => this._comp.removeOriginFeat(feat.id));
			row.appendChild(btnRm);
			wrp.appendChild(row);
		});

		this._wrp.appendChild(wrp);
	}

	/**
	 * Feats granted outside the normal progression — DM awards for training or story reasons. Always
	 * shown (with an add button), since a character with none still needs somewhere to add one.
	 */
	_renderManualFeats () {
		const feats = this._comp._state.manualFeats || [];

		const wrp = document.createElement("div");
		wrp.className = `ve-mb-2${feats.length ? "" : " no-print"}`;
		// Title and action share a row; the caption sits below, so nothing collides in a narrow column
		const head = document.createElement("div");
		head.className = "cs__section-head ve-flex-v-center ve-flex-wrap";
		head.innerHTML = `<span class="bold">Other Feats</span>`;
		const btnAdd = document.createElement("button");
		btnAdd.type = "button";
		btnAdd.className = "ve-btn ve-btn-xxs ve-btn-primary ve-ml-auto no-print";
		btnAdd.innerHTML = `<span class="glyphicon glyphicon-plus"></span> Add Feat`;
		btnAdd.addEventListener("click", () => this._pOnAddManualFeat());
		head.appendChild(btnAdd);
		wrp.appendChild(head);
		wrp.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-small ve-mb-1">Granted outside your class progression.</div>`);

		if (!feats.length) {
			wrp.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-small">None. Use <b>Add Feat</b> for feats earned through training or the story &mdash; these do not use an Ability Score Improvement slot.</div>`);
		}

		feats.forEach(feat => {
			const row = document.createElement("div");
			row.className = "ve-small ve-mb-1 ve-flex-v-center";
			const lbl = document.createElement("span");
			lbl.className = "ve-mr-2";
			lbl.innerHTML = Renderer.get().render(`{@feat ${feat.name}${feat.source && feat.source !== Parser.SRC_PHB ? `|${feat.source}` : ""}}`);
			row.appendChild(lbl);

			const iptNote = document.createElement("input");
			iptNote.type = "text";
			iptNote.className = "ve-form-control ve-input-xs ve-mr-1";
			iptNote.style.maxWidth = "16em";
			iptNote.placeholder = "Why? (optional)";
			iptNote.value = feat.note || "";
			iptNote.addEventListener("change", () => this._comp.setManualFeatNote(feat.id, iptNote.value));
			row.appendChild(iptNote);

			const btnRm = document.createElement("button");
			btnRm.type = "button";
			btnRm.className = "ve-btn ve-btn-xxs ve-btn-danger no-print";
			btnRm.title = "Remove; ability score bonuses are reverted";
			btnRm.innerHTML = `<span class="glyphicon glyphicon-trash"></span>`;
			btnRm.addEventListener("click", () => this._comp.removeManualFeat(feat.id));
			row.appendChild(btnRm);

			wrp.appendChild(row);
		});

		this._wrp.appendChild(wrp);
	}

	async _pOnAddManualFeat () {
		const taken = new Set((this._comp._state.manualFeats || []).map(it => `${it.name}|${it.source}`));
		const pool = (await CharacterSheetClassData.pGetAllFeats()).filter(f => !taken.has(`${f.name}|${f.source}`));
		if (!pool.length) return;
		const feat = await InputUiUtil.pGetUserEnum({
			values: pool,
			isResolveItem: true,
			fnDisplay: f => `${f.name} (${Parser.sourceJsonToAbv(f.source)})`,
			title: "Add a feat",
			placeholder: "Select a feat...",
		});
		if (feat == null) return;
		// Granted by the DM, so prerequisites are deliberately not enforced here
		const bonuses = await pResolveFeat(this._comp, feat);
		if (bonuses == null) return;
		this._comp.addManualFeat({name: feat.name, source: feat.source, bonuses});
	}

	_renderClassSection ({entry, cls, sc}) {
		const wrp = document.createElement("div");
		wrp.className = "ve-mb-2";

		if (!cls) {
			// A class with no source at all is a character from somewhere else — an old save, another
			// tool, a hand-written file. Saying which book is missing is the point of this line, so
			// where there is no answer it says that rather than taking the panel down
			const why = entry.source ? `${entry.source.qq()} is not loaded` : "no source was recorded for it";
			wrp.innerHTML = `<div class="bold">${(entry.name || "Unknown class").qq()} ${entry.level ?? ""}</div><div class="ve-muted ve-small">Class data not available: ${why}.</div>`;
			this._wrp.appendChild(wrp);
			return;
		}

		// Header: name, level input, remove button
		const wrpHead = document.createElement("div");
		wrpHead.className = "ve-flex-v-center ve-mb-1";
		wrpHead.innerHTML = `
			<span class="bold">${cls.name.qq()} <span class="ve-muted ve-small">(${Parser.sourceJsonToAbv(cls.source).qq()})</span></span>
			<label class="ve-flex-v-center ve-ml-auto"><span class="ve-small ve-muted ve-mr-1">Level</span><input type="number" min="1" max="20" value="${entry.level}" class="ve-form-control ve-input-xs cs__ipt-num cs__ipt-num--xs"></label>
		`;
		const iptLevel = wrpHead.querySelector("input");
		iptLevel.addEventListener("change", () => {
			this._comp.setClassEntryLevel(entry.id, Number(iptLevel.value));
		});
		if (this._comp._state.classes.length > 1) {
			const btnRm = document.createElement("button");
			btnRm.type = "button";
			btnRm.className = "ve-btn ve-btn-xxs ve-btn-danger ve-ml-1 no-print";
			btnRm.title = "Remove class";
			btnRm.innerHTML = `<span class="glyphicon glyphicon-trash"></span>`;
			btnRm.addEventListener("click", () => this._comp.removeClassEntry(entry.id));
			wrpHead.appendChild(btnRm);
		}
		wrp.appendChild(wrpHead);

		this._renderResources({wrp, entry, cls, sc});
		this._renderFeatureTimeline({wrp, entry, cls, sc});

		this._wrp.appendChild(wrp);
	}

	/** Data-driven class resources (Rages, Sneak Attack, Ki/Focus, Channel Divinity, Weapon Mastery count, ...). */
	_renderResources ({wrp, entry, cls, sc}) {
		const resources = [
			...getClassResources(cls, entry.level),
			...(sc ? getClassResources(sc, entry.level) : []),
		];
		if (!resources.length) return;

		const used = this._comp._state.resourcesUsed || {};
		const staticRes = [];
		resources.forEach(r => {
			const total = /^\d+$/.test(String(r.value).trim()) ? Number(r.value) : null;
			// Expendable use-resources (Rages, Ki, Wild Shape, Channel Divinity, ...) get a spend tracker
			if (total != null && EXPENDABLE_RESOURCES[r.label]) wrp.appendChild(this._getResourceTracker(r.label, total, Math.min(total, Number(used[r.label]) || 0)));
			else staticRes.push(r);
		});

		if (staticRes.length) {
			const row = document.createElement("div");
			row.className = "ve-small ve-mb-1";
			row.innerHTML = staticRes
				.map(r => `<span class="ve-muted">${r.label.qq()}:</span> <span class="bold">${r.value.qq()}</span>`)
				.join(`<span class="ve-muted"> &middot; </span>`);
			wrp.appendChild(row);
		}
	}

	/** A used/total dot tracker for an expendable class resource. */
	_getResourceTracker (label, total, used) {
		const row = document.createElement("div");
		row.className = "ve-small ve-mb-1 ve-flex-v-center";
		const lbl = document.createElement("span");
		lbl.className = "ve-muted ve-mr-2";
		lbl.textContent = `${label} (${total - used}/${total}):`;
		row.appendChild(lbl);
		for (let i = 0; i < total; ++i) {
			const cb = document.createElement("input");
			cb.type = "checkbox";
			cb.className = "ve-mr-1 no-print";
			cb.title = "Expend/restore a use";
			cb.checked = i < used;
			cb.addEventListener("change", () => this._comp.setResourceUsed(label, (i + 1 === used) ? i : i + 1));
			row.appendChild(cb);
		}
		return row;
	}

	/* -------------------------------------------- Choice boxes -------------------------------------------- */

	/** A highlighted box inside a feature card's body that holds that feature's inline chooser. */
	_makeChoiceBox (body) {
		const box = document.createElement("div");
		box.className = "cs__feat-choice";
		body.appendChild(box);
		return box;
	}

	/** A standalone choice box for choosers with no matching feature card (fallback below the timeline). */
	_makeFallbackBox (container) {
		const box = document.createElement("div");
		box.className = "cs__feat-choice cs__feat-choice--loose";
		container.appendChild(box);
		return box;
	}

	/* -------------------------------------------- Expertise -------------------------------------------- */

	/**
	 * Expertise picks come from one character-wide pool: a Rogue 1 / Bard 3 has four picks over the
	 * same skill list, not two separate pairs. So the chooser is rendered once — in the first
	 * Expertise feature card — against the combined total, and any later Expertise card points at it.
	 */
	_getExpertiseTotal () {
		return (this._loaded || []).reduce((acc, {entry, cls}) => acc + (cls ? getExpertiseSkillCount(cls, entry.level) : 0), 0);
	}

	/** Expertise chooser hosted inside an "Expertise" feature card. */
	_renderExpertiseChooser (box, {entry, cls}) {
		this._expertiseBoxes = this._expertiseBoxes || [];
		const meta = {box, entry, cls, isPrimary: !this._expertiseBoxes.length};
		this._expertiseBoxes.push(meta);
		// Fill now: the card is still being assembled, so the box is not in the document yet.
		this._fillExpertiseBox(meta);
	}

	/** Re-fill the Expertise chooser (called on skill-proficiency changes), preserving card state. */
	_refreshExpertise () {
		(this._expertiseBoxes || [])
			.filter(it => it.box.isConnected)
			.forEach(it => this._fillExpertiseBox(it));
	}

	_fillExpertiseBox (meta) {
		return meta.isPrimary ? this._fillExpertisePrimary(meta) : this._fillExpertiseSecondary(meta);
	}

	/** A non-first Expertise card: Expertise is shared, so point at the card that owns the chooser. */
	_fillExpertiseSecondary ({box}) {
		const primary = (this._expertiseBoxes || [])[0];
		const where = primary?.cls?.name ? ` on the ${primary.cls.name} card above` : " above";
		const total = this._getExpertiseTotal();
		const nChosen = CHAR_SHEET_SKILLS.filter(({key}) => Number(this._comp._state[`skill_${key}`]) === PROF_STATE_EXPERTISE).length;
		box.innerHTML = `<div class="ve-small"><span class="bold">Expertise</span> <span class="ve-muted">— shared across your classes (${nChosen}/${total} chosen); choose${where.qq()}.</span></div>`;
	}

	_fillExpertisePrimary ({box: wrp}) {
		const total = this._getExpertiseTotal();
		const proficient = CHAR_SHEET_SKILLS.filter(({key}) => (Number(this._comp._state[`skill_${key}`]) || 0) >= PROF_STATE_PROFICIENT);

		wrp.innerHTML = `<div class="cs__feat-choice-head ve-flex-v-center ve-flex-wrap"><span class="cs__feat-choice-lbl">Expertise</span> <span class="ve-muted ve-small cs__exp-count"></span></div>`;
		const dispCount = wrp.querySelector(".cs__exp-count");

		const renderCount = () => {
			const nChosen = CHAR_SHEET_SKILLS.filter(({key}) => Number(this._comp._state[`skill_${key}`]) === PROF_STATE_EXPERTISE).length;
			let clsName = "ve-muted";
			let txt = `${nChosen}/${total} chosen`;
			if (nChosen > total) {
				clsName = "ve-text-danger";
				txt = `${nChosen}/${total} chosen — more than your features grant`;
			} else if (nChosen < total) txt = `${nChosen}/${total} chosen — pick ${total - nChosen} more`;
			dispCount.className = `ve-small cs__exp-count ${clsName}`;
			dispCount.textContent = txt;
		};

		if (!proficient.length) {
			wrp.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-small">Gain skill proficiencies first, then mark up to ${total} as Expertise (double proficiency bonus).</div>`);
			renderCount();
			return;
		}

		const wrpOpts = document.createElement("div");
		wrpOpts.className = "cs__feat-choice-opts";
		proficient.forEach(({key, name}) => {
			const lbl = document.createElement("label");
			lbl.className = "ve-small";
			const cb = document.createElement("input");
			cb.type = "checkbox";
			cb.className = "ve-mr-1";
			cb.checked = Number(this._comp._state[`skill_${key}`]) === PROF_STATE_EXPERTISE;
			cb.addEventListener("change", () => {
				this._comp._state[`skill_${key}`] = cb.checked ? PROF_STATE_EXPERTISE : PROF_STATE_PROFICIENT;
			});
			const spn = document.createElement("span");
			spn.textContent = name;
			lbl.append(cb, spn);
			wrpOpts.appendChild(lbl);
		});
		wrp.appendChild(wrpOpts);
		wrp.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-small ve-mt-1">Rogues may instead apply Expertise to thieves' tools &mdash; note that under Proficiencies.</div>`);
		renderCount();
	}

	/* -------------------------------------------- Weapon Mastery (2024) -------------------------------------------- */

	/** Every printing of every weapon with a mastery property (cached unfiltered, so the source filter can change). */
	_pGetMasteryWeaponsRaw () {
		return this._pMasteryWeapons ||= (async () => {
			const all = await Renderer.item.pBuildList();
			return all
				// Base weapon *types* only (Longsword, Shortbow, ...) — not the thousands of magic variants.
				.filter(it => it.mastery?.length && it.weapon && it._isBaseItem)
				.map(it => ({name: it.name, source: it.source, mastery: it.mastery.map(m => String(m).split("|")[0])}));
		})();
	}

	/**
	 * Weapons with a mastery property, restricted to the character's allowed sources. Mastery is by
	 * weapon *type*, not ownership. Filtering happens before the de-duplication by name, so a weapon
	 * still appears when a printing other than the first one is allowed.
	 */
	async _pGetMasteryWeapons () {
		const fnAllowed = getStateSourcePredicate(this._comp._getState());
		const seen = new Set();
		return (await this._pGetMasteryWeaponsRaw())
			.filter(it => !fnAllowed || fnAllowed(it.source))
			.filter(it => { const k = it.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
			.sort((a, b) => SortUtil.ascSortLower(a.name, b.name));
	}

	/** Weapon-mastery chooser for one class, hosted inside its "Weapon Mastery" feature card. */
	_renderWeaponMasteryChooser (box, {entry, cls}) {
		this._wrpMastery = box;
		this._wmCtx = {entry, cls};
		this._fillWeaponMastery();
	}

	_refreshWeaponMastery () {
		if (this._wrpMastery?.isConnected && this._wmCtx) this._fillWeaponMastery();
	}

	_fillWeaponMastery () {
		const wrp = this._wrpMastery;
		if (!wrp || !this._wmCtx) return;
		const {cls, entry} = this._wmCtx;
		const total = getWeaponMasteryCount(cls, entry.level);
		const chosen = this._comp._state.weaponMasteries || [];

		wrp.innerHTML = `<div class="cs__feat-choice-head ve-flex-v-center ve-flex-wrap"><span class="cs__feat-choice-lbl">Weapon Mastery</span> <span class="ve-small cs__wm-count"></span></div>`;
		const dispCount = wrp.querySelector(".cs__wm-count");
		const n = chosen.length;
		dispCount.className = `ve-small cs__wm-count ${n > total ? "ve-text-danger" : "ve-muted"}`;
		dispCount.textContent = n > total ? `${n}/${total} chosen — more than your class grants` : (n < total ? `${n}/${total} chosen — pick ${total - n} more` : `${n}/${total} chosen`);

		if (chosen.length) {
			const wrpChosen = document.createElement("div");
			wrpChosen.className = "cs__feat-choice-opts";
			chosen.forEach(name => {
				const spn = document.createElement("span");
				spn.className = "ve-flex-v-center ve-small";
				spn.innerHTML = `<span class="bold">${name.qq()}</span>`;
				const btnRm = document.createElement("button");
				btnRm.type = "button";
				btnRm.className = "ve-btn ve-btn-xxs ve-btn-default no-print ve-ml-1";
				btnRm.title = `Remove ${name}`;
				btnRm.textContent = "×";
				btnRm.addEventListener("click", () => this._comp.toggleWeaponMastery(name));
				spn.appendChild(btnRm);
				wrpChosen.appendChild(spn);
			});
			wrp.appendChild(wrpChosen);
		}

		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "ve-btn ve-btn-xxs ve-btn-primary no-print";
		btn.textContent = "Choose weapon…";
		btn.addEventListener("click", () => this._pOnChooseWeaponMastery());
		wrp.appendChild(btn);
		wrp.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-small ve-mt-1">Pick the weapon types whose mastery property you can use — you need not own them.</div>`);
	}

	async _pOnChooseWeaponMastery () {
		const chosen = this._comp._state.weaponMasteries || [];
		const weapons = (await this._pGetMasteryWeapons()).filter(w => !chosen.includes(w.name));
		if (!weapons.length) {
			// Most often the source filter excludes every mastery weapon (they are all 2024 content)
			const isFiltered = !!getStateSourcePredicate(this._comp._getState());
			JqueryUtil.doToast({
				type: "warning",
				content: isFiltered
					? "No weapons with a mastery property are available from this character's sources. Widen its source filter to pick one."
					: "No weapons with a mastery property are available.",
			});
			return;
		}
		const picked = await InputUiUtil.pGetUserEnum({
			values: weapons,
			isResolveItem: true,
			fnDisplay: w => `${w.name} — ${w.mastery.join(", ")}`,
			title: "Choose a weapon you have mastery with",
			placeholder: "Select a weapon...",
		});
		if (picked == null) return;
		this._comp.toggleWeaponMastery(picked.name);
	}

	/* -------------------------------------------- Subclass -------------------------------------------- */

	static _getSubclassGainLevel (cls) {
		const ix = (cls.classFeatures || []).findIndex(lvlFeatures => (lvlFeatures || []).some(f => f.gainSubclassFeature));
		return ix < 0 ? null : ix + 1;
	}

	/** Subclass pick/change chooser, hosted inside the feature card that unlocks the subclass. */
	_renderSubclassChooser (box, {entry, cls}) {
		const title = cls.subclassTitle || "Subclass";

		if (entry.subclass) {
			box.innerHTML = `<span class="ve-muted">${title.qq()}:</span> <span class="bold">${entry.subclass.name.qq()}</span> <span class="ve-muted">(${Parser.sourceJsonToAbv(entry.subclass.source).qq()})</span> `;
			const btnChange = document.createElement("button");
			btnChange.type = "button";
			btnChange.className = "ve-btn ve-btn-xxs ve-btn-default no-print";
			btnChange.textContent = "Change";
			btnChange.addEventListener("click", () => this._pOnChooseSubclass({entry, cls}));
			box.appendChild(btnChange);
		} else {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "ve-btn ve-btn-xs ve-btn-primary no-print";
			btn.textContent = `Choose ${title}...`;
			btn.addEventListener("click", () => this._pOnChooseSubclass({entry, cls}));
			box.appendChild(btn);
		}
	}

	async _pOnChooseSubclass ({entry, cls}) {
		const subclasses = await CharacterSheetClassData.pGetSubclassesForClass({className: cls.name, classSource: cls.source});
		if (!subclasses.length) return;
		const sc = await InputUiUtil.pGetUserEnum({
			values: subclasses,
			isResolveItem: true,
			fnDisplay: it => `${it.name} (${Parser.sourceJsonToAbv(it.source)})`,
			title: `Select ${cls.subclassTitle || "Subclass"}`,
			placeholder: "Select...",
		});
		if (sc == null) return;
		this._comp.setSubclassForClass(entry.id, sc);
	}

	/* -------------------------------------------- Optional features -------------------------------------------- */

	/** One optional-feature progression chooser (Fighting Style, Maneuvers, Invocations, ...) for its feature card. */
	_renderOptionalFeatureChooser (box, {entry, prog}) {
		const chosenForProg = (entry.optionalFeatures || []).filter(it => it.progressionName === prog.name);

		const wrpLabel = document.createElement("span");
		const remaining = prog.count - chosenForProg.length;
		wrpLabel.className = remaining > 0 ? "ve-text-danger bold" : "ve-muted";
		wrpLabel.textContent = `${prog.name} (${chosenForProg.length}/${prog.count}): `;
		box.appendChild(wrpLabel);

		chosenForProg.forEach(feat => {
			const spn = document.createElement("span");
			spn.className = "ve-mr-1";
			spn.innerHTML = Renderer.get().render(CharacterClassPanel._getOptionalFeatureTag(feat));
			const btnRm = document.createElement("button");
			btnRm.type = "button";
			btnRm.className = "ve-btn ve-btn-xxs ve-btn-default no-print";
			btnRm.title = `Remove ${feat.name}`;
			btnRm.textContent = "×";
			btnRm.addEventListener("click", () => this._comp.removeOptionalFeatureForClass(entry.id, feat));
			spn.appendChild(btnRm);
			box.appendChild(spn);
		});

		if (chosenForProg.length < prog.count) {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "ve-btn ve-btn-xxs ve-btn-primary no-print";
			btn.textContent = `Choose...`;
			btn.addEventListener("click", () => this._pOnChooseOptionalFeature({entry, prog}));
			box.appendChild(btn);
		}

		// What a taken option grants is the option's business — an invocation that hands you an
		// Origin feat asks for it here, under the invocation, rather than from the list it came from
		chosenForProg.forEach(feat => this._renderOptionalFeatureGrants(box.parentElement || box, {entry, feat}));
	}

	/** Feats granted by an optional feature the character has actually taken. */
	_renderOptionalFeatureGrants (host, {entry, feat}) {
		const ent = this._optionalFeatureData?.get(`${feat.name}|${feat.source}`);
		if (!ent) return;

		CharacterSheetClassData.getFeatureFeatGrants(ent).forEach(grant => {
			const box = document.createElement("div");
			box.className = "cs__feat-choice cs__feat-choice--nested";
			box.insertAdjacentHTML("beforeend", `<span class="ve-muted ve-small ve-mr-1">${feat.name.qq()} grants:</span>`);
			this._renderFeatureFeatChooser(box, {entry, featureKey: `optfeature:${feat.name}|${feat.source}`, grant});
			host.appendChild(box);
		});
	}

	async _pOnChooseOptionalFeature ({entry, prog}) {
		const pool = (await CharacterSheetClassData.pGetOptionalFeaturesByTypes(prog.featureTypes))
			.filter(it => !(entry.optionalFeatures || []).some(ch => ch.name === it.name && ch.source === it.source));
		if (!pool.length) return;
		const feat = await InputUiUtil.pGetUserEnum({
			values: pool,
			isResolveItem: true,
			fnDisplay: it => `${it.name} (${Parser.sourceJsonToAbv(it.source)})`,
			title: `Select ${prog.name}`,
			placeholder: "Select...",
		});
		if (feat == null) return;
		this._comp.addOptionalFeatureForClass(entry.id, {name: feat.name, source: feat.source, progressionName: prog.name});
	}

	/* -------------------------------------------- Feature-granted feats (Fighting Style, ...) -------------------------------------------- */

	static _FEAT_CATEGORY_LABELS = {FS: "Fighting Style", EB: "Epic Boon", G: "General Feat", O: "Origin Feat"};

	static _featMatchesCategory (feat, category) {
		// Case-folded on both sides: the data's filters say `category=o` and a feat says `"O"`, and
		// comparing them literally is what left "Choose Feat…" doing nothing at all
		const c = String(feat.category || "").toUpperCase();
		const want = String(category || "").toUpperCase();
		return c === want || c.split(":")[0] === want;
	}

	/** Chooser for a feat a feature grants by category (2024 Fighting Style, Epic Boon, ...), hosted in its card. */
	_renderFeatureFeatChooser (box, {entry, featureKey, grant}) {
		const label = CharacterClassPanel._FEAT_CATEGORY_LABELS[grant.category] || "Feat";
		const count = grant.count || 1;
		const chosen = (this._comp._state.featureFeats || []).filter(it => it.entryId === entry.id && it.featureKey === featureKey && it.category === grant.category);

		const lbl = document.createElement("span");
		lbl.className = chosen.length < count ? "ve-text-danger bold" : "ve-muted";
		lbl.textContent = `${label} (${chosen.length}/${count}): `;
		box.appendChild(lbl);

		chosen.forEach(f => {
			const spn = document.createElement("span");
			spn.className = "ve-mr-1";
			spn.innerHTML = Renderer.get().render(`{@feat ${f.name}${f.source !== Parser.SRC_PHB ? `|${f.source}` : ""}}`);
			const btnRm = document.createElement("button");
			btnRm.type = "button";
			btnRm.className = "ve-btn ve-btn-xxs ve-btn-default no-print ve-ml-1";
			btnRm.title = `Remove ${f.name}`;
			btnRm.textContent = "×";
			btnRm.addEventListener("click", () => this._comp.removeFeatureFeat(f.id));
			spn.appendChild(btnRm);
			box.appendChild(spn);
		});

		if (chosen.length < count) {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "ve-btn ve-btn-xxs ve-btn-primary no-print";
			btn.textContent = `Choose ${label}...`;
			btn.addEventListener("click", () => this._pOnChooseFeatureFeat({entry, featureKey, grant}));
			box.appendChild(btn);
		}
	}

	async _pOnChooseFeatureFeat ({entry, featureKey, grant}) {
		const label = CharacterClassPanel._FEAT_CATEGORY_LABELS[grant.category] || "Feat";
		const chosenUids = new Set((this._comp._state.featureFeats || [])
			.filter(it => it.entryId === entry.id && it.featureKey === featureKey)
			.map(it => `${it.name}|${it.source}`));
		const pool = (await CharacterSheetClassData.pGetAllFeats())
			.filter(f => CharacterClassPanel._featMatchesCategory(f, grant.category))
			// `repeatable` feats may be taken again; the rest may not
			.filter(f => f.repeatable || !chosenUids.has(`${f.name}|${f.source}`));

		// A button that does nothing reads as a broken page. Say which of the two it is: nothing of
		// this kind exists in the loaded books, or you have taken them all
		if (!pool.length) {
			JqueryUtil.doToast({
				type: "warning",
				content: chosenUids.size
					? `No ${label.toLowerCase()} left to choose — you have taken them all.`
					: `No ${label.toLowerCase()} found in the books this character allows.`,
			});
			return;
		}
		const feat = await InputUiUtil.pGetUserEnum({
			values: pool,
			isResolveItem: true,
			fnDisplay: f => `${f.name} (${Parser.sourceJsonToAbv(f.source)})`,
			title: `Select ${label}`,
			placeholder: "Select...",
		});
		if (feat == null) return;
		const bonuses = await pResolveFeat(this._comp, feat);
		if (bonuses == null) return;
		this._comp.addFeatureFeat({entryId: entry.id, featureKey, category: grant.category, name: feat.name, source: feat.source, bonuses});
	}

	/* -------------------------------------------- ASI / feats -------------------------------------------- */

	/** One ASI-or-feat slot, hosted inside an "Ability Score Improvement" feature card. */
	_renderAsiSlot (box, {entry, slotIndex}) {
		const choice = (entry.asiFeatChoices || [])[slotIndex];

		const lbl = document.createElement("span");
		lbl.className = `cs__feat-choice-lbl${choice ? "" : " cs__feat-choice-lbl--todo"}`;
		lbl.textContent = choice ? "Ability Score Improvement or Feat" : "Choose an Ability Score Improvement or Feat";
		box.appendChild(lbl);

		if (choice) {
			const spn = document.createElement("span");
			spn.className = "ve-flex-v-center";
			if (choice.type === "feat") {
				spn.innerHTML = Renderer.get().render(`{@feat ${choice.name}${choice.source !== Parser.SRC_PHB ? `|${choice.source}` : ""}}`);
			} else {
				spn.textContent = Object.entries(choice.bonuses || {}).map(([abv, n]) => `+${n} ${abv.toUpperCase()}`).join(" ");
			}
			const btnRm = document.createElement("button");
			btnRm.type = "button";
			btnRm.className = "ve-btn ve-btn-xxs ve-btn-default no-print ve-ml-1";
			btnRm.title = "Remove; ability score bonuses are reverted (other applied effects are kept)";
			btnRm.textContent = "×";
			btnRm.addEventListener("click", () => this._comp.removeAsiFeatChoice(entry.id, choice.id));
			spn.appendChild(btnRm);
			box.appendChild(spn);
		} else {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "ve-btn ve-btn-xxs ve-btn-primary no-print";
			btn.textContent = "Choose ASI or Feat";
			btn.addEventListener("click", () => this._pOnChooseAsiFeat({entry}));
			box.appendChild(btn);
		}
	}

	async _pOnChooseAsiFeat ({entry}) {
		const mode = await InputUiUtil.pGetUserEnum({
			values: ["Ability Score Improvement", "Feat"],
			isResolveItem: true,
			title: "Ability Score Improvement or Feat?",
			placeholder: "Select...",
		});
		if (mode == null) return;

		if (mode === "Ability Score Improvement") return this._pOnChooseAsi({entry});
		return this._pOnChooseFeat({entry});
	}

	async _pOnChooseAsi ({entry}) {
		const allAbvs = CHAR_SHEET_ABILITIES.map(([abv]) => abv);
		const spread = await InputUiUtil.pGetUserEnum({
			values: ["+2 to one ability", "+1 to two abilities"],
			isResolveItem: true,
			title: "Ability Score Improvement",
			placeholder: "Select...",
		});
		if (spread == null) return;

		const isSingle = spread === "+2 to one ability";
		const picked = await pPickAbilities({count: isSingle ? 1 : 2, from: allAbvs, title: "Increase which ability?"});
		if (!picked) return;

		const bonuses = {};
		picked.forEach(abv => bonuses[abv] = (bonuses[abv] || 0) + (isSingle ? 2 : 1));
		this._comp.addAsiFeatChoice(entry.id, {type: "asi", bonuses});
	}

	/** Character context for checking feat (and multiclass) prerequisites. */
	_getFeatPrereqContext () {
		const state = this._comp._state;
		const abilityScores = Object.fromEntries(CHAR_SHEET_ABILITIES.map(([abv]) => [abv, Number(state[`abil_${abv}`]) || 10]));

		// Expand species name into matchable words so a base-race prereq ("elf") matches "Wood Elf"
		const raceNames = [];
		const speciesName = state.refSpecies?.name || state.speciesText;
		if (speciesName) {
			raceNames.push(speciesName);
			String(speciesName).replace(/\(.*?\)/g, " ").split(/[\s-]+/).forEach(w => { if (w) raceNames.push(w); });
		}

		const featNames = [];
		(state.classes || []).forEach(cls => (cls.asiFeatChoices || []).forEach(ch => { if (ch.type === "feat") featNames.push(ch.name); }));

		return {
			abilityScores,
			totalLevel: this._comp.getLevelNumber(),
			classes: (state.classes || []).map(c => ({name: c.name, level: c.level})),
			raceNames,
			backgroundName: state.refBackground?.name || state.backgroundText,
			featNames,
			isSpellcaster: !!state.spellAbility || (state.spellsKnown || []).length > 0,
		};
	}

	async _pOnChooseFeat ({entry}) {
		const feats = await CharacterSheetClassData.pGetAllFeats();
		const feat = await InputUiUtil.pGetUserEnum({
			values: feats,
			isResolveItem: true,
			fnDisplay: it => `${it.name} (${Parser.sourceJsonToAbv(it.source)})`,
			title: "Select Feat",
			placeholder: "Select a feat...",
		});
		if (feat == null) return;

		// Warn (do not block) when the character definitely does not meet the feat's prerequisites
		if (feat.prerequisite?.length) {
			const {status} = checkFeatPrerequisites(feat.prerequisite, this._getFeatPrereqContext());
			if (status === "unmet") {
				const ptPrereq = Renderer.utils.prerequisite.getHtml(feat.prerequisite, {isTextOnly: true, isSkipPrefix: true});
				const isContinue = await InputUiUtil.pGetUserBoolean({
					title: "Feat Prerequisites Not Met",
					htmlDescription: `<div>${feat.name.qq()} requires: ${(ptPrereq || "(see feat)").qq()}.<br>Take it anyway?</div>`,
					textYes: "Take Anyway",
					textNo: "Cancel",
				});
				if (!isContinue) return;
			}
		}

		const bonuses = await pResolveFeat(this._comp, feat);
		if (bonuses == null) return;
		this._comp.addAsiFeatChoice(entry.id, {type: "feat", name: feat.name, source: feat.source, bonuses});
	}

	/* -------------------------------------------- Feature timeline -------------------------------------------- */

	/** Per-class-section chooser context: which inline choices attach to which feature cards. */
	_getSectionChoosers ({entry, cls, sc}) {
		const optionalProgs = new Map();
		[...getOptionalFeatureCounts(cls, entry.level), ...(sc ? getOptionalFeatureCounts(sc, entry.level) : [])]
			.forEach(prog => { if (!optionalProgs.has(prog.name)) optionalProgs.set(prog.name, prog); });
		return {
			gainLevel: CharacterClassPanel._getSubclassGainLevel(cls),
			expertiseTotal: getExpertiseSkillCount(cls, entry.level),
			wmTotal: getWeaponMasteryCount(cls, entry.level),
			asiTotal: getAsiCount(cls, entry.level),
			optionalProgs,
		};
	}

	_renderFeatureTimeline ({wrp, entry, cls, sc}) {
		const timeline = CharacterSheetClassData.getFeatureTimeline(cls, {subclass: sc, level: entry.level});
		if (!timeline.length) return;

		const ctx = this._getSectionChoosers({entry, cls, sc});

		const outer = document.createElement("details");
		outer.open = true;
		outer.innerHTML = `<summary class="ve-small ve-muted clickable">Features by level</summary>`;

		const list = document.createElement("div");
		list.className = "cs__feat-list";

		const done = {expertise: false, wm: false, opt: new Set()};
		let asiOrdinal = 0;

		timeline.forEach(meta => {
			const {feature, isSubclassFeature} = meta;
			const {name} = CharacterSheetClassData.getFeatureNameMeta(feature);

			// Skip the generic "you gain a Subclass feature" marker features above the subclass-gain
			// level — they add nothing beyond the actual granted subclass feature, which is its own card.
			// (The subclass picker lives on the gain-level card.)
			if (!isSubclassFeature && feature.gainSubclassFeature && ctx.gainLevel != null && meta.level > ctx.gainLevel) return;

			const card = this._getFeatureCard(meta);
			if (!card) return;
			const body = card.querySelector(".cs__feat-body");
			let unmet = false;

			if (!isSubclassFeature && feature.gainSubclassFeature && ctx.gainLevel != null) {
				this._renderSubclassChooser(this._makeChoiceBox(body), {entry, cls});
				unmet = unmet || (!entry.subclass && entry.level >= ctx.gainLevel);
			}
			if (name === "Ability Score Improvement" && ctx.asiTotal) {
				const slotIndex = asiOrdinal++;
				this._renderAsiSlot(this._makeChoiceBox(body), {entry, slotIndex});
				unmet = unmet || !((entry.asiFeatChoices || [])[slotIndex]);
			}
			if (name === "Expertise" && ctx.expertiseTotal && !done.expertise) {
				this._renderExpertiseChooser(this._makeChoiceBox(body), {entry, cls});
				done.expertise = true;
				// Expertise is one character-wide pool, so measure against the combined total
				const nExp = CHAR_SHEET_SKILLS.filter(({key}) => Number(this._comp._state[`skill_${key}`]) === PROF_STATE_EXPERTISE).length;
				unmet = unmet || nExp < this._getExpertiseTotal();
			}
			if (name === "Weapon Mastery" && ctx.wmTotal && !done.wm) {
				this._renderWeaponMasteryChooser(this._makeChoiceBox(body), {entry, cls});
				done.wm = true;
				unmet = unmet || (this._comp._state.weaponMasteries || []).length < ctx.wmTotal;
			}
			const prog = ctx.optionalProgs.get(name);
			if (prog && !done.opt.has(name)) {
				this._renderOptionalFeatureChooser(this._makeChoiceBox(body), {entry, prog});
				done.opt.add(name);
				unmet = unmet || (entry.optionalFeatures || []).filter(f => f.progressionName === prog.name).length < prog.count;
			}
			// Feats a feature grants by category (2024 Fighting Style, Epic Boon, ...)
			CharacterSheetClassData.getFeatureFeatGrants(feature).forEach(grant => {
				const featureKey = `${name}@${meta.level}`;
				this._renderFeatureFeatChooser(this._makeChoiceBox(body), {entry, featureKey, grant});
				const chosenN = (this._comp._state.featureFeats || []).filter(it => it.entryId === entry.id && it.featureKey === featureKey && it.category === grant.category).length;
				unmet = unmet || chosenN < (grant.count || 1);
			});

			// Cards stay closed by default; a marker flags those that hold choices (amber = still to pick).
			if (body.querySelector(".cs__feat-choice")) this._addChoiceMark(card, unmet);
			list.appendChild(card);
		});

		outer.appendChild(list);

		// Fallbacks: choosers with no matching feature card still need somewhere to live.
		const fallback = document.createElement("div");
		fallback.className = "ve-mt-1";
		if (ctx.gainLevel != null && !entry.subclass && entry.level < ctx.gainLevel) {
			const title = cls.subclassTitle || "Subclass";
			fallback.insertAdjacentHTML("beforeend", `<div class="ve-small ve-muted">${title.qq()} unlocks at level ${ctx.gainLevel}.</div>`);
		}
		if (ctx.expertiseTotal && !done.expertise) this._renderExpertiseChooser(this._makeFallbackBox(fallback), {entry, cls});
		if (ctx.wmTotal && !done.wm) this._renderWeaponMasteryChooser(this._makeFallbackBox(fallback), {entry, cls});
		ctx.optionalProgs.forEach((prog, nm) => { if (!done.opt.has(nm)) this._renderOptionalFeatureChooser(this._makeFallbackBox(fallback), {entry, prog}); });
		for (let i = asiOrdinal; i < ctx.asiTotal; ++i) this._renderAsiSlot(this._makeFallbackBox(fallback), {entry, slotIndex: i});
		if (fallback.childNodes.length) outer.appendChild(fallback);

		wrp.appendChild(outer);
	}

	/** One expandable feature card: level badge, name (hover link), subclass badge, and rendered rules text. */
	_getFeatureCard ({level, feature, isSubclassFeature}) {
		const {name} = CharacterSheetClassData.getFeatureNameMeta(feature);
		if (!name) return null;

		const tag = isSubclassFeature
			? CharacterClassPanel._getSubclassFeatureTag(feature)
			: CharacterClassPanel._getClassFeatureTag(feature);

		const card = document.createElement("details");
		card.className = "cs__feat-card";

		const summary = document.createElement("summary");
		const nameHtml = tag ? Renderer.get().render(tag) : name.qq();
		summary.innerHTML = `
			<span class="cs__feat-lvl">L${level}</span>
			<span class="cs__feat-name">${nameHtml}</span>
			${isSubclassFeature ? `<span class="cs__feat-badge">Subclass</span>` : ""}
		`;
		card.appendChild(summary);

		const body = document.createElement("div");
		body.className = "cs__feat-body";
		const entries = this._getFeatureBodyEntries(feature);
		body.innerHTML = entries.length
			? Renderer.get().render({type: "entries", entries})
			: `<span class="ve-muted ve-small">No rules text.</span>`;
		card.appendChild(body);

		return card;
	}

	/** The rules entries to show in a card body, drilling through the dereferencer's header-wrapper nesting. */
	_getFeatureBodyEntries (feature) {
		let cur = feature;
		while (cur && cur.name == null && Array.isArray(cur.entries) && cur.entries.length === 1 && typeof cur.entries[0] === "object") cur = cur.entries[0];
		return (cur?.entries || feature.entries || []).filter(Boolean);
	}

	/** Flag a card that holds choices: amber pencil while a choice is unmet, muted once all are made. */
	_addChoiceMark (card, unmet) {
		const mark = document.createElement("span");
		mark.className = `cs__feat-mark ${unmet ? "cs__feat-mark--unmet" : "cs__feat-mark--done"}`;
		mark.title = unmet ? "Options to choose" : "Options chosen";
		mark.innerHTML = `<span class="glyphicon glyphicon-pencil"></span>`;
		card.querySelector("summary").appendChild(mark);
	}

	/* -------------------------------------------- Spellcasting -------------------------------------------- */

	_renderSpellcasting (loaded) {
		const meta = getSpellcastingMeta(loaded.map(({entry, cls, sc}) => ({cls, sc, level: entry.level})));
		if (!meta.slots && !meta.pact) return;

		const wrp = document.createElement("div");
		wrp.className = "ve-small ve-mt-2 ve-mb-1";

		const parts = [];
		if (meta.slots?.some(Boolean)) {
			const slotParts = meta.slots
				.map((cnt, i) => cnt ? `${Parser.spLevelToFull(i + 1)}: ${cnt}` : null)
				.filter(Boolean);
			parts.push(`<div><span class="bold">Spell Slots</span> <span class="ve-muted">(caster level ${meta.casterLevel})</span>: ${slotParts.join(" · ")}</div>`);
		}
		if (meta.pact) {
			parts.push(`<div><span class="bold">Pact Magic</span>: ${meta.pact.count} × ${Parser.spLevelToFull(meta.pact.level)}-level</div>`);
		}

		loaded.forEach(({entry, cls, sc}) => {
			const casterEnt = cls?.casterProgression ? cls : (sc?.casterProgression ? sc : (cls?.spellsKnownProgression || cls?.cantripProgression ? cls : null));
			if (!casterEnt) return;
			const bits = [];
			const cantrips = getCantripsKnown(casterEnt, entry.level);
			const known = getSpellsKnown(casterEnt, entry.level);
			const prepared = getPreparedSpellsDisplay(cls, entry.level) || (sc ? getPreparedSpellsDisplay(sc, entry.level) : null);
			if (cantrips != null) bits.push(`${cantrips} cantrips`);
			if (known != null) bits.push(`${known} spells known`);
			else if (prepared) bits.push(`prepares ${prepared}`);
			// What a level-up lets you swap, which is a 2024 rule and easy to forget
			const swap = getPreparedSpellsChange(cls, entry.level) ?? (sc ? getPreparedSpellsChange(sc, entry.level) : null);
			if (swap) bits.push(`${swap} may be swapped on a level-up`);
			if (bits.length) parts.push(`<div class="ve-muted">${cls.name.qq()}: ${bits.join(", ")}</div>`);
		});

		wrp.innerHTML = parts.join("");
		this._wrp.appendChild(wrp);
	}

	/* -------------------------------------------- Multiclass -------------------------------------------- */

	_renderAddClass () {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "ve-btn ve-btn-xs ve-btn-default no-print";
		btn.innerHTML = `<span class="glyphicon glyphicon-plus"></span> Add Class (Multiclass)`;
		btn.addEventListener("click", () => this._pOnAddClass());
		this._wrp.appendChild(btn);
	}

	async _pOnAddClass () {
		const existing = this._comp._state.classes;
		const classes = (await CharacterSheetClassData.pGetAllClasses())
			.filter(cls => !existing.some(it => it.name === cls.name && it.source === cls.source));
		if (!classes.length) return;

		const cls = await InputUiUtil.pGetUserEnum({
			values: classes,
			isResolveItem: true,
			fnDisplay: it => `${it.name} (${Parser.sourceJsonToAbv(it.source)})`,
			title: "Add Class",
			placeholder: "Select a class...",
		});
		if (cls == null) return;

		// PHB multiclassing prerequisites; warn rather than block (tables allow house rules)
		const abilityScores = Object.fromEntries(CHAR_SHEET_ABILITIES.map(([abv]) => [abv, Number(this._comp._state[`abil_${abv}`]) || 10]));
		const reqs = cls.multiclassing?.requirements;
		if (reqs && !isMulticlassRequirementMet(reqs, abilityScores)) {
			const isContinue = await InputUiUtil.pGetUserBoolean({
				title: "Multiclass Prerequisites Not Met",
				htmlDescription: `<div>${cls.name.qq()} requires: ${getMulticlassRequirementsDisplay(reqs).qq()}.<br>Add it anyway?</div>`,
				textYes: "Add Anyway",
				textNo: "Cancel",
			});
			if (!isContinue) return;
		}

		this._comp.addClassEntry(cls, 1);
	}
}
