import {CHAR_SHEET_ABILITIES} from "./charactersheet-consts.js";
import {CharacterSheetClassData} from "./charactersheet-classdata.js";
import {
	CHOICE_TYPE_ABILITY,
	CHOICE_TYPE_LANGUAGE,
	CHOICE_TYPE_SKILL,
	CHOICE_TYPE_TOOL,
	getAbilityPackageDisplay,
	getChoiceSignature,
	getFixedAbilityBonuses,
	getGrantedFeatCategories,
	getGrantedFeats,
	getPendingChoices,
} from "./charactersheet-choices.js";
import {
	ABILITY_METHOD_MANUAL,
	ABILITY_METHOD_POINT_BUY,
	ABILITY_METHOD_STANDARD_ARRAY,
	POINT_BUY_BUDGET,
	POINT_BUY_MAX_SCORE,
	POINT_BUY_MIN_SCORE,
	STANDARD_ARRAY,
	getPointBuyTotalCost,
	isValidStandardArrayAssignment,
} from "./charactersheet-abilityscores.js";
import {EQUIPMENT_ALWAYS_KEY, getEquipmentChoiceGroups, getEquipmentOptionDisplay, getInventoryItemMeta} from "./charactersheet-equipment.js";
import {PROF_KIND_LANGUAGE, PROF_KIND_TOOL} from "./charactersheet-proficiencies.js";
import {pResolveFeat} from "./charactersheet-featgrant.js";

/**
 * Guided character creation: a step-sequence wizard
 * (Species → Class → Background → Ability Scores → Choices → Equipment → Review)
 * which accumulates a draft and applies it to the `CharacterModel` on finish.
 */
export class CharacterWizard {
	static _STEPS = [
		{id: "species", name: "Species"},
		{id: "class", name: "Class"},
		{id: "background", name: "Background"},
		{id: "abilities", name: "Ability Scores"},
		{id: "choices", name: "Choices"},
		{id: "equipment", name: "Equipment"},
		{id: "review", name: "Review"},
	];

	constructor ({comp}) {
		this._comp = comp;
		this._ixStep = 0;

		this._draft = {
			name: "",
			race: null, // {doc, ent}
			cls: null, // class entity
			level: 1,
			background: null, // {doc, ent}
			abilityMethod: null,
			abilityScores: Object.fromEntries(CHAR_SHEET_ABILITIES.map(([abv]) => [abv, null])),
			choices: [], // recomputed on entering the Choices step
			choiceSelections: new Map(), // choice signature → Set of selected option names
			abilitySelections: new Map(), // choice signature → {ixPackage, slots: [abv|null, ...]}
			isAddEquipment: true,
			isSetSuggestedHp: true,
			equipmentSelections: new Map(), // "sourceLabel|groupIx" → option key
		};

		this._eleBody = null;
		this._eleFooter = null;
		this._doClose = null;
	}

	static async pShow ({comp}) {
		const wizard = new CharacterWizard({comp});
		return wizard._pShow();
	}

	async _pShow () {
		const {eleModalInner, eleModalFooter, doClose, pGetResolved} = UiUtil.getShowModal({
			title: "Guided Character Creation",
			isHeaderBorder: true,
			hasFooter: true,
			isUncappedHeight: true,
			isMinHeight0: true,
		});

		this._eleBody = eleModalInner;
		this._eleFooter = eleModalFooter;
		this._doClose = doClose;

		this._renderStep();

		const [isDataEntered] = await pGetResolved();
		return !!isDataEntered;
	}

	/* -------------------------------------------- Navigation -------------------------------------------- */

	_renderStep () {
		const step = CharacterWizard._STEPS[this._ixStep];
		this._eleBody.innerHTML = "";
		this._eleBody.classList.add("ve-flex-col", "ve-px-1");

		const dispSteps = document.createElement("div");
		dispSteps.className = "ve-muted ve-small ve-mb-2 ve-no-shrink";
		dispSteps.textContent = `Step ${this._ixStep + 1} of ${CharacterWizard._STEPS.length}: ${step.name}`;
		this._eleBody.appendChild(dispSteps);

		const wrpStep = document.createElement("div");
		wrpStep.className = "ve-flex-col ve-min-h-0";
		this._eleBody.appendChild(wrpStep);

		this[`_render_${step.id}`](wrpStep);
		this._renderFooter();
	}

	_renderFooter () {
		this._eleFooter.innerHTML = "";
		const wrp = document.createElement("div");
		wrp.className = "ve-flex-v-center ve-w-100 ve-py-2 ve-px-1";

		const btnBack = document.createElement("button");
		btnBack.type = "button";
		btnBack.className = "ve-btn ve-btn-default";
		btnBack.textContent = "Back";
		btnBack.disabled = this._ixStep === 0;
		btnBack.addEventListener("click", () => {
			this._ixStep -= 1;
			this._renderStep();
		});

		const btnCancel = document.createElement("button");
		btnCancel.type = "button";
		btnCancel.className = "ve-btn ve-btn-default ve-ml-2";
		btnCancel.textContent = "Cancel";
		btnCancel.addEventListener("click", () => this._doClose(false));

		const dispValidation = document.createElement("div");
		dispValidation.className = "ve-muted ve-small ve-ml-auto ve-mr-2";
		dispValidation.id = "cs-wiz-validation";

		const isLast = this._ixStep === CharacterWizard._STEPS.length - 1;
		const btnNext = document.createElement("button");
		btnNext.type = "button";
		btnNext.className = `ve-btn ${isLast ? "ve-btn-primary" : "ve-btn-default"}`;
		btnNext.textContent = isLast ? "Finish" : "Next";
		btnNext.addEventListener("click", async () => {
			const msgInvalid = this._getStepValidationError();
			if (msgInvalid) {
				dispValidation.textContent = msgInvalid;
				return;
			}
			if (isLast) {
				btnNext.disabled = true;
				try {
					await this._pApplyDraft();
				} finally {
					btnNext.disabled = false;
				}
				this._doClose(true);
				return;
			}
			this._ixStep += 1;
			this._renderStep();
		});

		wrp.append(btnBack, btnCancel, dispValidation, btnNext);
		this._eleFooter.appendChild(wrp);
	}

	_getStepValidationError () {
		const step = CharacterWizard._STEPS[this._ixStep];
		if (step.id !== "abilities" || this._draft.abilityMethod == null) return null;

		if (this._draft.abilityMethod === ABILITY_METHOD_STANDARD_ARRAY) {
			if (!isValidStandardArrayAssignment(this._draft.abilityScores)) return "Assign each standard array value exactly once.";
			return null;
		}

		if (this._draft.abilityMethod === ABILITY_METHOD_POINT_BUY) {
			const cost = getPointBuyTotalCost(this._draft.abilityScores);
			if (cost == null) return `Scores must be between ${POINT_BUY_MIN_SCORE} and ${POINT_BUY_MAX_SCORE}.`;
			if (cost > POINT_BUY_BUDGET) return `Point buy total (${cost}) exceeds the ${POINT_BUY_BUDGET}-point budget.`;
			return null;
		}

		return null;
	}

	/* -------------------------------------------- Step: pickers -------------------------------------------- */

	_getPickedDisplay (picked, placeholder) {
		if (!picked) return `<i class="ve-muted">${placeholder}</i>`;
		return Renderer.get().render(picked.doc.tag);
	}

	_render_species (wrp) {
		wrp.innerHTML = `
			<p>Choose your character's species. This sets speed and fixed proficiencies; choices (skills, languages) are resolved in the Choices step.</p>
			<div class="ve-flex-v-center">
				<button type="button" class="ve-btn ve-btn-default" id="cs-wiz-pick-species">Choose Species...</button>
				<div class="ve-ml-2" id="cs-wiz-disp-species">${this._getPickedDisplay(this._draft.race, "Nothing selected (optional)")}</div>
			</div>
		`;
		wrp.querySelector("#cs-wiz-pick-species").addEventListener("click", async () => {
			const doc = await SearchWidget.pGetUserRaceSearch();
			if (!doc) return;
			const ent = await DataLoader.pCacheAndGet(doc.page, doc.source, doc.hash, {isCopy: true});
			this._draft.race = {doc, ent};
			wrp.querySelector("#cs-wiz-disp-species").innerHTML = this._getPickedDisplay(this._draft.race, "");
		});
	}

	async _render_class (wrp) {
		wrp.innerHTML = `
			<p>Choose your class and level. This sets hit dice, saving throw proficiencies, and spellcasting ability.</p>
			<div class="ve-flex-v-center ve-mb-2">
				<label class="ve-flex-v-center"><span class="ve-mr-2">Class</span><select class="ve-form-control ve-input-xs" id="cs-wiz-sel-class" style="max-width: 300px;"><option value="-1">Loading...</option></select></label>
				<label class="ve-flex-v-center ve-ml-3"><span class="ve-mr-2">Level</span><input type="number" min="1" max="20" class="ve-form-control ve-input-xs cs__ipt-num" id="cs-wiz-ipt-level" value="${this._draft.level}"></label>
			</div>
			<div class="ve-muted ve-small" id="cs-wiz-disp-class"></div>
		`;

		const sel = wrp.querySelector("#cs-wiz-sel-class");
		const iptLevel = wrp.querySelector("#cs-wiz-ipt-level");
		const disp = wrp.querySelector("#cs-wiz-disp-class");

		const renderClassInfo = () => {
			const cls = this._draft.cls;
			if (!cls) return disp.textContent = "";
			const parts = [`Hit die: d${cls.hd?.faces ?? "?"}`];
			if (cls.proficiency?.length) parts.push(`Saves: ${cls.proficiency.map(abv => Parser.attAbvToFull(abv)).join(", ")}`);
			if (cls.spellcastingAbility) parts.push(`Spellcasting: ${Parser.attAbvToFull(cls.spellcastingAbility)}`);
			disp.textContent = parts.join(" • ");
		};

		const classes = await CharacterSheetClassData.pGetAllClasses();
		sel.innerHTML = [
			`<option value="-1">Select a class...</option>`,
			...classes.map((cls, i) => `<option value="${i}">${`${cls.name} (${Parser.sourceJsonToAbv(cls.source)})`.qq()}</option>`),
		].join("");
		const ixCur = this._draft.cls ? classes.findIndex(it => it.name === this._draft.cls.name && it.source === this._draft.cls.source) : -1;
		sel.value = `${ixCur}`;
		renderClassInfo();

		sel.addEventListener("change", () => {
			const ix = Number(sel.value);
			this._draft.cls = ix >= 0 ? classes[ix] : null;
			renderClassInfo();
		});
		iptLevel.addEventListener("change", () => {
			this._draft.level = Math.min(20, Math.max(1, Number(iptLevel.value) || 1));
			iptLevel.value = `${this._draft.level}`;
		});
	}

	_render_background (wrp) {
		wrp.innerHTML = `
			<p>Choose your background. Fixed skill/tool/language proficiencies are applied directly; anything with a choice is resolved in the Choices step.</p>
			<div class="ve-flex-v-center">
				<button type="button" class="ve-btn ve-btn-default" id="cs-wiz-pick-background">Choose Background...</button>
				<div class="ve-ml-2" id="cs-wiz-disp-background">${this._getPickedDisplay(this._draft.background, "Nothing selected (optional)")}</div>
			</div>
		`;
		wrp.querySelector("#cs-wiz-pick-background").addEventListener("click", async () => {
			const doc = await SearchWidget.pGetUserBackgroundSearch();
			if (!doc) return;
			const ent = await DataLoader.pCacheAndGet(doc.page, doc.source, doc.hash, {isCopy: true});
			this._draft.background = {doc, ent};
			wrp.querySelector("#cs-wiz-disp-background").innerHTML = this._getPickedDisplay(this._draft.background, "");
		});
	}

	/* -------------------------------------------- Step: ability scores -------------------------------------------- */

	_render_abilities (wrp) {
		wrp.innerHTML = `
			<p>Choose how to determine ability scores. Fixed species/background ability bonuses, and any you resolve in the Choices step, are added on top when you finish.</p>
			<div class="ve-flex-v-center ve-mb-2">
				<label class="ve-flex-v-center"><span class="ve-mr-2">Method</span><select class="ve-form-control ve-input-xs" id="cs-wiz-sel-abil-method" style="max-width: 220px;">
					<option value="">Keep current scores</option>
					<option value="${ABILITY_METHOD_STANDARD_ARRAY}">Standard Array (15, 14, 13, 12, 10, 8)</option>
					<option value="${ABILITY_METHOD_POINT_BUY}">Point Buy (${POINT_BUY_BUDGET} points)</option>
					<option value="${ABILITY_METHOD_MANUAL}">Manual / Rolled</option>
				</select></label>
				<div class="ve-muted ve-small ve-ml-3" id="cs-wiz-disp-abil-status"></div>
			</div>
			<div id="cs-wiz-wrp-abil-inputs"></div>
		`;

		const sel = wrp.querySelector("#cs-wiz-sel-abil-method");
		const wrpInputs = wrp.querySelector("#cs-wiz-wrp-abil-inputs");
		const dispStatus = wrp.querySelector("#cs-wiz-disp-abil-status");
		sel.value = this._draft.abilityMethod ?? "";

		const renderStatus = () => {
			if (this._draft.abilityMethod === ABILITY_METHOD_POINT_BUY) {
				const cost = getPointBuyTotalCost(this._draft.abilityScores);
				dispStatus.textContent = cost == null ? `Scores must be ${POINT_BUY_MIN_SCORE}–${POINT_BUY_MAX_SCORE}` : `${cost} / ${POINT_BUY_BUDGET} points spent`;
				return;
			}
			if (this._draft.abilityMethod === ABILITY_METHOD_STANDARD_ARRAY) {
				const assigned = Object.values(this._draft.abilityScores).filter(v => v != null);
				dispStatus.textContent = `${assigned.length} / ${CHAR_SHEET_ABILITIES.length} assigned`;
				return;
			}
			dispStatus.textContent = "";
		};

		const renderInputs = () => {
			const method = this._draft.abilityMethod;
			wrpInputs.innerHTML = "";
			if (method == null) return renderStatus();

			const isStandardArray = method === ABILITY_METHOD_STANDARD_ARRAY;
			const min = method === ABILITY_METHOD_POINT_BUY ? POINT_BUY_MIN_SCORE : 1;
			const max = method === ABILITY_METHOD_POINT_BUY ? POINT_BUY_MAX_SCORE : 30;

			wrpInputs.innerHTML = `<div class="ve-flex ve-flex-wrap">${CHAR_SHEET_ABILITIES
				.map(([abv, name]) => `
					<label class="ve-flex-col ve-mr-3 ve-mb-2" style="width: 90px;">
						<span class="ve-small ve-muted">${name}</span>
						${isStandardArray
		? `<select class="ve-form-control ve-input-xs" data-cs-wiz-abv="${abv}"><option value="">&mdash;</option>${STANDARD_ARRAY.map(v => `<option value="${v}">${v}</option>`).join("")}</select>`
		: `<input type="number" min="${min}" max="${max}" class="ve-form-control ve-input-xs" data-cs-wiz-abv="${abv}">`}
					</label>
				`)
				.join("")}</div>`;

			wrpInputs.querySelectorAll("[data-cs-wiz-abv]").forEach(ele => {
				const abv = ele.getAttribute("data-cs-wiz-abv");
				const cur = this._draft.abilityScores[abv];
				if (cur != null) ele.value = `${cur}`;
				ele.addEventListener("change", () => {
					const raw = ele.value.trim();
					this._draft.abilityScores[abv] = raw === "" ? null : Number(raw);
					renderStatus();
				});
			});
			renderStatus();
		};

		sel.addEventListener("change", () => {
			this._draft.abilityMethod = sel.value || null;
			const method = this._draft.abilityMethod;
			// Seed sensible defaults per method
			CHAR_SHEET_ABILITIES.forEach(([abv]) => {
				this._draft.abilityScores[abv] = method === ABILITY_METHOD_POINT_BUY
					? POINT_BUY_MIN_SCORE
					: method === ABILITY_METHOD_MANUAL ? 10 : null;
			});
			renderInputs();
		});
		renderInputs();
	}

	/* -------------------------------------------- Step: choice queue -------------------------------------------- */

	_render_choices (wrp) {
		this._draft.choices = getPendingChoices({
			race: this._draft.race?.ent,
			background: this._draft.background?.ent,
			cls: this._draft.cls,
		});

		// Drop stale selections (e.g. after going back and changing class)
		const sigs = new Set(this._draft.choices.map(it => getChoiceSignature(it)));
		[...this._draft.choiceSelections.keys()].filter(sig => !sigs.has(sig)).forEach(sig => this._draft.choiceSelections.delete(sig));

		if (!this._draft.choices.length) {
			wrp.innerHTML = `<p class="ve-muted">No choices to resolve${this._draft.race || this._draft.cls || this._draft.background ? "" : "&mdash;pick a species, class, or background first"}.</p>`;
			return;
		}

		wrp.innerHTML = `<p>Resolve the choices granted by your selections.</p>`;

		this._draft.choices.forEach(choice => {
			if (choice.type === CHOICE_TYPE_ABILITY) return this._renderAbilityChoice(wrp, choice);

			const sig = getChoiceSignature(choice);
			if (!this._draft.choiceSelections.has(sig)) this._draft.choiceSelections.set(sig, new Set());
			const selections = this._draft.choiceSelections.get(sig);
			selections.forEach(v => { if (!choice.from.includes(v)) selections.delete(v); });

			const wrpChoice = document.createElement("div");
			wrpChoice.className = "ve-mb-3";
			wrpChoice.innerHTML = `
				<div class="bold">${choice.label.qq()} <span class="ve-muted ve-small">(${choice.sourceName.qq()})</span></div>
				<div class="ve-muted ve-small cs-wiz-choice-status"></div>
				<div class="ve-flex ve-flex-wrap cs-wiz-choice-opts"></div>
			`;
			const dispStatus = wrpChoice.querySelector(".cs-wiz-choice-status");
			const wrpOpts = wrpChoice.querySelector(".cs-wiz-choice-opts");

			const renderStatus = () => dispStatus.textContent = `${selections.size} / ${choice.count} selected`;

			choice.from.forEach(opt => {
				const lbl = document.createElement("label");
				lbl.className = "ve-flex-v-center ve-mr-3";
				lbl.style.minWidth = "170px";
				const cb = document.createElement("input");
				cb.type = "checkbox";
				cb.className = "ve-mr-1";
				cb.checked = selections.has(opt);
				cb.addEventListener("change", () => {
					if (cb.checked) {
						if (selections.size >= choice.count) {
							cb.checked = false;
							return;
						}
						selections.add(opt);
					} else selections.delete(opt);
					renderStatus();
				});
				const spn = document.createElement("span");
				spn.textContent = opt;
				lbl.append(cb, spn);
				wrpOpts.appendChild(lbl);
			});

			renderStatus();
			wrp.appendChild(wrpChoice);
		});
	}

	/* -------------------------------------------- Ability score choices -------------------------------------------- */

	static _getPackageSlots (pkg) {
		if (pkg.choose) return [...new Array(pkg.choose.count)].map(() => ({amount: pkg.choose.amount, from: pkg.choose.from}));
		if (pkg.weighted) return pkg.weighted.weights.map(weight => ({amount: weight, from: pkg.weighted.from}));
		return [];
	}

	_renderAbilityChoice (wrp, choice) {
		const sig = getChoiceSignature(choice);
		if (!this._draft.abilitySelections.has(sig)) this._draft.abilitySelections.set(sig, {ixPackage: 0, slots: []});
		const sel = this._draft.abilitySelections.get(sig);

		const wrpChoice = document.createElement("div");
		wrpChoice.className = "ve-mb-3";
		wrpChoice.innerHTML = `
			<div class="bold">Ability scores <span class="ve-muted ve-small">(${choice.sourceName.qq()})</span></div>
			<div class="cs-wiz-abil-packages"></div>
			<div class="cs-wiz-abil-slots ve-flex ve-flex-wrap"></div>
			<div class="ve-muted ve-small cs-wiz-abil-status"></div>
		`;
		const wrpPackages = wrpChoice.querySelector(".cs-wiz-abil-packages");
		const wrpSlots = wrpChoice.querySelector(".cs-wiz-abil-slots");
		const dispStatus = wrpChoice.querySelector(".cs-wiz-abil-status");

		const renderStatus = () => {
			const pkg = choice.packages[sel.ixPackage];
			const slots = CharacterWizard._getPackageSlots(pkg);
			const set = sel.slots.filter(Boolean);
			const ptWarn = new Set(set).size !== set.length ? " — same ability chosen more than once (allowed, but unusual)" : "";
			if (set.length < slots.length) dispStatus.textContent = `${set.length} / ${slots.length} assigned (incomplete choices are not applied)${ptWarn}`;
			else dispStatus.textContent = `${set.length} / ${slots.length} assigned${ptWarn}`;
		};

		const renderSlots = () => {
			const pkg = choice.packages[sel.ixPackage];
			const slots = CharacterWizard._getPackageSlots(pkg);
			if (sel.slots.length !== slots.length) sel.slots = slots.map(() => null);
			wrpSlots.innerHTML = "";

			const ptFixed = Object.keys(pkg.fixed).length
				? `<div class="ve-small ve-muted ve-mr-3 ve-self-center">Fixed: ${Object.entries(pkg.fixed).map(([abv, n]) => `+${n} ${abv.toUpperCase()}`).join(", ").qq()}</div>`
				: "";
			if (ptFixed) wrpSlots.insertAdjacentHTML("beforeend", ptFixed);

			slots.forEach((slot, ix) => {
				const lbl = document.createElement("label");
				lbl.className = "ve-flex-v-center ve-mr-3 ve-mb-1";
				lbl.innerHTML = `<span class="ve-small ve-mr-1">+${slot.amount} to</span>`;
				const selEle = document.createElement("select");
				selEle.className = "ve-form-control ve-input-xs";
				selEle.style.width = "130px";
				selEle.innerHTML = [`<option value="">&mdash;</option>`, ...slot.from.map(abv => `<option value="${abv}">${Parser.attAbvToFull(abv)}</option>`)].join("");
				selEle.value = sel.slots[ix] || "";
				selEle.addEventListener("change", () => {
					sel.slots[ix] = selEle.value || null;
					renderStatus();
				});
				lbl.appendChild(selEle);
				wrpSlots.appendChild(lbl);
			});
			renderStatus();
		};

		if (choice.packages.length > 1) {
			choice.packages.forEach((pkg, ix) => {
				const lbl = document.createElement("label");
				lbl.className = "ve-flex-v-center ve-small";
				const radio = document.createElement("input");
				radio.type = "radio";
				radio.name = `cs-wiz-abil-pkg-${sig.replace(/\W/g, "")}`;
				radio.className = "ve-mr-1";
				radio.checked = sel.ixPackage === ix;
				radio.addEventListener("change", () => {
					sel.ixPackage = ix;
					sel.slots = [];
					renderSlots();
				});
				const spn = document.createElement("span");
				spn.textContent = getAbilityPackageDisplay(pkg);
				lbl.append(radio, spn);
				wrpPackages.appendChild(lbl);
			});
		}

		renderSlots();
		wrp.appendChild(wrpChoice);
	}

	/** Resolved bonuses for one ability choice, or null while incomplete/invalid. */
	_getResolvedAbilityBonuses (choice) {
		const sel = this._draft.abilitySelections.get(getChoiceSignature(choice));
		if (!sel) return null;
		const pkg = choice.packages[sel.ixPackage];
		if (!pkg) return null;
		const slots = CharacterWizard._getPackageSlots(pkg);
		const set = sel.slots.filter(Boolean);
		// Require every slot filled, but allow the same ability more than once (relaxed to a warning in the UI).
		if (set.length !== slots.length) return null;

		const bonuses = {};
		// Single-package fixed bonuses are applied separately via getFixedAbilityBonuses
		if (choice.packages.length > 1) Object.entries(pkg.fixed).forEach(([abv, n]) => bonuses[abv] = (bonuses[abv] || 0) + n);
		slots.forEach((slot, ix) => {
			const abv = sel.slots[ix];
			bonuses[abv] = (bonuses[abv] || 0) + slot.amount;
		});
		return bonuses;
	}

	/** All ability bonuses the wizard will apply on finish: fixed species/background + resolved choices. */
	_getCombinedAbilityBonuses () {
		const bonuses = {};
		const add = map => Object.entries(map || {}).forEach(([abv, n]) => bonuses[abv] = (bonuses[abv] || 0) + n);
		if (this._draft.race?.ent) add(getFixedAbilityBonuses(this._draft.race.ent.ability));
		if (this._draft.background?.ent) add(getFixedAbilityBonuses(this._draft.background.ent.ability));
		this._draft.choices
			.filter(it => it.type === CHOICE_TYPE_ABILITY)
			.forEach(choice => add(this._getResolvedAbilityBonuses(choice)));
		return bonuses;
	}

	/**
	 * The same bonuses as `_getCombinedAbilityBonuses`, but kept apart by what granted each.
	 *
	 * The sheet stores final scores, so the only record of *why* a score is what it is is the
	 * ability-bonus log — and a panel that wants to tick "+2 Strength, from your background" needs
	 * the background's name in it.
	 */
	_getAbilityBonusesBySource () {
		const bySource = new Map();
		const add = (source, map) => {
			if (!source || !Object.keys(map || {}).length) return;
			const cur = bySource.get(source) || {};
			Object.entries(map).forEach(([abv, n]) => cur[abv] = (cur[abv] || 0) + n);
			bySource.set(source, cur);
		};

		if (this._draft.race?.ent) add(this._draft.race.ent.name, getFixedAbilityBonuses(this._draft.race.ent.ability));
		if (this._draft.background?.ent) add(this._draft.background.ent.name, getFixedAbilityBonuses(this._draft.background.ent.ability));

		this._draft.choices
			.filter(it => it.type === CHOICE_TYPE_ABILITY)
			.forEach(choice => add(CharacterWizard._getEntityName(choice.sourceName), this._getResolvedAbilityBonuses(choice)));

		return [...bySource.entries()].map(([source, bonuses]) => ({source, bonuses}));
	}

	/** "Background: Sailor" → "Sailor". A choice names its source for a person; a log names the entity. */
	static _getEntityName (sourceName) { return String(sourceName || "").replace(/^(Species|Background|Class):\s*/, ""); }

	/* -------------------------------------------- Step: equipment -------------------------------------------- */

	/** Class + background starting equipment as parsed choice groups. */
	_getEquipmentSources () {
		const out = [];
		if (this._draft.cls?.startingEquipment?.defaultData?.length) {
			out.push({
				srcLabel: `Class: ${this._draft.cls.name}`,
				groups: getEquipmentChoiceGroups(this._draft.cls.startingEquipment.defaultData),
				goldAlternative: this._draft.cls.startingEquipment.goldAlternative || null,
			});
		}
		if (this._draft.background?.ent?.startingEquipment?.length) {
			out.push({
				srcLabel: `Background: ${this._draft.background.ent.name}`,
				groups: getEquipmentChoiceGroups(this._draft.background.ent.startingEquipment),
				goldAlternative: null,
			});
		}
		return out;
	}

	_getSelectedEquipmentOption ({srcLabel, ixGroup, group}) {
		const key = this._draft.equipmentSelections.get(`${srcLabel}|${ixGroup}`);
		return group.options.find(opt => opt.key === key) || group.options[0];
	}

	_render_equipment (wrp) {
		const sources = this._getEquipmentSources();

		if (!sources.length) {
			wrp.innerHTML = `<p class="ve-muted">No starting equipment data&mdash;pick a class or background first, or use the Add Item search on the sheet.</p>`;
			return;
		}

		wrp.innerHTML = `
			<p>Choose your starting equipment. Concrete items go into the sheet's inventory on finish; category picks (e.g. "a martial weapon") and special items become equipment notes.</p>
			<label class="ve-flex-v-center ve-mb-2"><input type="checkbox" id="cs-wiz-cb-equipment" class="ve-mr-1" ${this._draft.isAddEquipment ? "checked" : ""}> Add starting equipment on finish</label>
			<div id="cs-wiz-wrp-equipment"></div>
		`;
		wrp.querySelector("#cs-wiz-cb-equipment").addEventListener("change", evt => this._draft.isAddEquipment = evt.currentTarget.checked);
		const wrpGroups = wrp.querySelector("#cs-wiz-wrp-equipment");

		sources.forEach(({srcLabel, groups, goldAlternative}) => {
			const hdr = document.createElement("div");
			hdr.className = "bold ve-mt-2";
			hdr.textContent = srcLabel;
			wrpGroups.appendChild(hdr);

			groups.forEach((group, ixGroup) => {
				const selKey = `${srcLabel}|${ixGroup}`;
				const div = document.createElement("div");
				div.className = "ve-mb-1";

				if (!group.isChoice) {
					div.innerHTML = `<span class="ve-small">• ${getEquipmentOptionDisplay(group.options[0]).qq()}</span>`;
					wrpGroups.appendChild(div);
					return;
				}

				const selected = this._getSelectedEquipmentOption({srcLabel, ixGroup, group});
				group.options.forEach(opt => {
					const lbl = document.createElement("label");
					lbl.className = "ve-flex-v-center ve-small";
					const radio = document.createElement("input");
					radio.type = "radio";
					radio.name = `cs-wiz-equip-${srcLabel.replace(/\W/g, "")}-${ixGroup}`;
					radio.className = "ve-mr-1";
					radio.checked = opt.key === selected.key;
					radio.addEventListener("change", () => this._draft.equipmentSelections.set(selKey, opt.key));
					const spn = document.createElement("span");
					spn.textContent = `(${opt.key.toLowerCase()}) ${getEquipmentOptionDisplay(opt)}`;
					lbl.append(radio, spn);
					div.appendChild(lbl);
				});
				wrpGroups.appendChild(div);
			});

			if (goldAlternative) {
				const div = document.createElement("div");
				div.className = "ve-muted ve-small";
				div.innerHTML = `Alternatively: ${Renderer.get().render(goldAlternative)} starting gold (roll and enter manually)`;
				wrpGroups.appendChild(div);
			}
		});
	}

	/**
	 * The feats the chosen background grants, applied for real: the ability increase, the fixed
	 * grants, and any skill or Expertise the feat itself asks you to choose.
	 *
	 * Silent when there are none, which is every pre-2024 background.
	 */
	async _pApplyBackgroundFeats (comp) {
		for (const ent of [this._draft.background?.ent, this._draft.race?.ent]) await this._pApplyEntityFeats(comp, ent);
	}

	async _pApplyEntityFeats (comp, ent) {
		for (const {name, source, displayName} of getGrantedFeats(ent?.feats)) {
			const feat = await CharacterSheetClassData.pGetFeat({name, source}).catch(() => null);
			if (!feat) continue;

			const bonuses = await pResolveFeat(comp, feat);
			if (bonuses == null) continue;
			comp.addOriginFeat({name: feat.name, source: feat.source, displayName: displayName || feat.name, bonuses, from: ent.name});
		}

		// "An Origin feat of your choice" (the 2024 Human's Versatile) is a pick, not a confirmation
		for (const grant of getGrantedFeatCategories(ent?.feats)) {
			for (let i = 0; i < grant.count; ++i) {
				const pool = (await CharacterSheetClassData.pGetAllFeats())
					.filter(f => String(f.category || "").toUpperCase().split(":")[0] === grant.category)
					.filter(f => !(comp._state.originFeats || []).some(it => it.name === f.name && it.source === f.source));
				if (!pool.length) break;

				const feat = await InputUiUtil.pGetUserEnum({
					values: pool,
					isResolveItem: true,
					fnDisplay: f => `${f.name} (${Parser.sourceJsonToAbv(f.source)})`,
					title: `${ent.name}: choose an Origin feat`,
					placeholder: "Select...",
				});
				if (feat == null) break;

				const bonuses = await pResolveFeat(comp, feat);
				if (bonuses == null) break;
				comp.addOriginFeat({name: feat.name, source: feat.source, displayName: feat.name, bonuses, from: ent.name});
			}
		}
	}

	async _pApplyEquipment () {
		const notes = [];
		let cpGained = 0;

		for (const {srcLabel, groups} of this._getEquipmentSources()) {
			for (let ixGroup = 0; ixGroup < groups.length; ++ixGroup) {
				const group = groups[ixGroup];
				const opt = group.isChoice
					? this._getSelectedEquipmentOption({srcLabel, ixGroup, group})
					: group.options.find(it => it.key === EQUIPMENT_ALWAYS_KEY) || group.options[0];

				for (const entry of opt.entries) {
					if (entry.kind === "item") {
						const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_ITEMS]({name: entry.name, source: entry.source});
						const ent = await DataLoader.pCacheAndGet(UrlUtil.PG_ITEMS, entry.source, hash, {isCopy: true}).catch(() => null);
						this._comp.addInventoryItem({
							name: ent?.name ?? entry.name,
							source: ent?.source ?? entry.source,
							quantity: entry.quantity,
							weightLb: ent?.weight ?? null,
							...getInventoryItemMeta(ent),
						});
					} else if (entry.kind === "coins") {
						cpGained += entry.value;
					} else {
						notes.push(`• ${entry.quantity > 1 ? `${entry.quantity}× ` : ""}${entry.display}${entry.kind === "placeholder" ? " (choose)" : ""}`);
					}
				}
			}
		}

		if (notes.length) this._comp.appendToTextProp("equipmentText", notes.join("\n"));
		if (cpGained) this._comp._state.gp = (Number(this._comp._state.gp) || 0) + Math.floor(cpGained / 100);
	}

	/* -------------------------------------------- Step: review -------------------------------------------- */

	_getSuggestedHpMax () {
		const faces = this._draft.cls?.hd?.faces;
		if (!faces) return null;
		const conBase = this._draft.abilityMethod != null && this._draft.abilityScores.con != null
			? this._draft.abilityScores.con
			: (Number(this._comp._state.abil_con) || 10);
		const conScore = conBase + (this._getCombinedAbilityBonuses().con || 0);
		const conMod = Parser.getAbilityModNumber(conScore);
		const level = this._draft.level;
		return (faces + conMod) + (level - 1) * (Math.floor(faces / 2) + 1 + conMod);
	}

	_render_review (wrp) {
		const rows = [];
		const addRow = (lbl, val) => rows.push(`<tr><td class="bold ve-text-right pr-2" style="width: 160px;">${lbl}</td><td>${val}</td></tr>`);

		addRow("Species", this._draft.race ? this._draft.race.doc.n.qq() : "<i class='ve-muted'>not set</i>");
		addRow("Class", this._draft.cls ? `${this._draft.cls.name.qq()} ${this._draft.level}` : "<i class='ve-muted'>not set</i>");
		addRow("Background", this._draft.background ? this._draft.background.doc.n.qq() : "<i class='ve-muted'>not set</i>");

		if (this._draft.abilityMethod != null) {
			addRow("Ability Scores", CHAR_SHEET_ABILITIES.map(([abv]) => `${abv.toUpperCase()} ${this._draft.abilityScores[abv] ?? "?"}`).join(", "));
		} else addRow("Ability Scores", "<i class='ve-muted'>unchanged</i>");

		const bonuses = this._getCombinedAbilityBonuses();
		if (Object.keys(bonuses).length) {
			addRow("Ability Bonuses", Object.entries(bonuses).map(([abv, n]) => `${n >= 0 ? "+" : ""}${n} ${abv.toUpperCase()}`).join(", "));
		}

		const selectionSummaries = this._draft.choices
			.map(choice => {
				const selections = this._draft.choiceSelections.get(getChoiceSignature(choice));
				if (!selections?.size) return null;
				return `${choice.sourceName.qq()}: ${[...selections].join(", ").qq()}`;
			})
			.filter(Boolean);
		if (selectionSummaries.length) addRow("Choices", selectionSummaries.join("<br>"));

		// Named here because finishing will ask about it — a feat that arrives unannounced, with its
		// own questions, is a surprise in the middle of the last click
		const featEnts = [this._draft.background?.ent, this._draft.race?.ent];
		const featNames = featEnts.flatMap(ent => getGrantedFeats(ent?.feats).map(it => (it.displayName || it.name).qq()));
		const nChoiceFeats = featEnts.reduce((acc, ent) => acc + getGrantedFeatCategories(ent?.feats).reduce((a, it) => a + it.count, 0), 0);
		const featParts = [...featNames, ...Array.from({length: nChoiceFeats}, () => "one of your choice")];
		if (featParts.length) addRow("Origin Feat", featParts.join(", "));

		const suggestedHp = this._getSuggestedHpMax();

		wrp.innerHTML = `
			<p>Review your character. Finishing applies everything below to the sheet.</p>
			<label class="ve-flex-v-center ve-mb-2"><span class="ve-mr-2">Character Name</span><input type="text" class="ve-form-control ve-input-xs" id="cs-wiz-ipt-name" style="max-width: 260px;" value="${(this._draft.name || this._comp._state.name || "").qq()}"></label>
			<table class="w-100"><tbody>${rows.join("")}</tbody></table>
			${suggestedHp != null ? `<label class="ve-flex-v-center ve-mt-2"><input type="checkbox" id="cs-wiz-cb-hp" class="ve-mr-1" ${this._draft.isSetSuggestedHp ? "checked" : ""}> Set max HP to <b class="ve-mx-1">${suggestedHp}</b> (average per level, Constitution included)</label>` : ""}
		`;

		wrp.querySelector("#cs-wiz-ipt-name").addEventListener("change", evt => this._draft.name = evt.currentTarget.value);
		const cbHp = wrp.querySelector("#cs-wiz-cb-hp");
		if (cbHp) cbHp.addEventListener("change", () => this._draft.isSetSuggestedHp = cbHp.checked);
	}

	/* -------------------------------------------- Apply -------------------------------------------- */

	async _pApplyDraft () {
		const comp = this._comp;

		if (this._draft.name.trim()) comp._state.name = this._draft.name.trim();

		if (this._draft.race) comp.applyPickedRace(this._draft.race);

		if (this._draft.cls) {
			comp._state.level = this._draft.level;
			comp.applyPickedClass(this._draft.cls, this._draft.level);
		}

		if (this._draft.background) comp.applyPickedBackground({...this._draft.background, isFixedOnly: true});

		if (this._draft.abilityMethod != null) {
			CHAR_SHEET_ABILITIES.forEach(([abv]) => {
				const score = this._draft.abilityScores[abv];
				if (score != null) comp._state[`abil_${abv}`] = score;
			});
		}

		// Attributed to whatever granted them, not lumped under "Species & Background": the panels tick
		// a grant by looking for its source, and a lump matches nothing
		this._getAbilityBonusesBySource().forEach(({source, bonuses}) => comp.applyAbilityBonuses(bonuses, {source}));

		// An ability choice answered here must not be asked again by the panels
		this._draft.choices
			.filter(it => it.type === CHOICE_TYPE_ABILITY)
			.filter(choice => Object.keys(this._getResolvedAbilityBonuses(choice) || {}).length)
			.forEach(choice => comp.recordChoice({
				sig: getChoiceSignature(choice),
				sourceName: choice.sourceName,
				type: choice.type,
				picks: Object.entries(this._getResolvedAbilityBonuses(choice)).map(([abv, n]) => `${n >= 0 ? "+" : ""}${n} ${abv.toUpperCase()}`),
			}));

		// Resolve queued choices — and *record* them. A skill keeps no note of where it came from, so
		// without the log nothing afterwards can tell an answered choice from an unasked one, which is
		// what left the Species panel asking for a skill the guide had already chosen.
		this._draft.choices.forEach(choice => {
			const selections = this._draft.choiceSelections.get(getChoiceSignature(choice));
			if (!selections?.size) return;

			if (choice.type === CHOICE_TYPE_SKILL) selections.forEach(name => comp.setSkillProfByName(name, 1));
			else if (choice.type === CHOICE_TYPE_LANGUAGE) selections.forEach(name => comp.addProficiency({kind: PROF_KIND_LANGUAGE, name, source: choice.sourceName}));
			else if (choice.type === CHOICE_TYPE_TOOL) selections.forEach(name => comp.addProficiency({kind: PROF_KIND_TOOL, name, source: choice.sourceName}));

			comp.recordChoice({
				sig: getChoiceSignature(choice),
				sourceName: choice.sourceName,
				type: choice.type,
				picks: [...selections],
			});
		});

		// A 2024 background grants an Origin feat, and it is part of the character rather than a note
		// about it: without this the wizard wrote "Feat: Tavern Brawler" into a text box and stopped,
		// so nothing counted it, nothing showed it, and its own choices were never asked
		await this._pApplyBackgroundFeats(comp);

		if (this._draft.isAddEquipment) await this._pApplyEquipment();

		if (this._draft.isSetSuggestedHp) {
			const hp = this._getSuggestedHpMax();
			if (hp != null) {
				comp._state.hpMax = hp;
				comp._state.hpCur = hp;
			}
		}
	}
}
