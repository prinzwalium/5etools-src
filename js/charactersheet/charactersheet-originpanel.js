import {CharacterSheetClassData} from "./charactersheet-classdata.js";
import {
	CHOICE_TYPE_ABILITY,
	getFixedAbilityBonuses,
	getGrantedFeatCategories,
	getGrantedFeats,
	getPendingChoices,
} from "./charactersheet-choices.js";
import {getEntityProficiencies} from "./charactersheet-proficiencies.js";
import {CHAR_SHEET_SKILLS, PROF_STATE_PROFICIENT} from "./charactersheet-consts.js";

/**
 * What a species or a background actually gives you — the same treatment the class panel gives a
 * class.
 *
 * The class has had a panel since the beginning: every feature by level, every choice it asks for,
 * and whether you have made it. Species and background had a *name in a text box* and nothing else,
 * so a background's skills, its tools and above all its Origin feat were invisible — you could not
 * tell whether they had been applied, and if they had not, nothing said so. That is what this fixes.
 *
 * Three sections, in the order somebody reads them:
 *
 *  - **Grants** — every proficiency, ability increase and feat, each ticked against what the
 *    character actually has. A tick is the whole point: it is the difference between "the book says
 *    you get this" and "you have it".
 *  - **Still to choose** — the choices the entity asks for and nobody has answered, each with the
 *    button that answers it. The page owns those flows already; this only calls them.
 *  - **Traits** — the entity's own text, as cards, the way class features are cards.
 */
export class CharacterOriginPanel {
	/**
	 * @param kind "species" | "background".
	 * @param page the page, for the pick/resolve flows it already owns.
	 */
	constructor ({comp, wrp, kind, page}) {
		this._comp = comp;
		this._wrp = wrp;
		this._kind = kind;
		this._page = page;
		this._renderToken = 0;
	}

	init () {
		const ref = this._kind === "species" ? "refSpecies" : "refBackground";
		this._comp._addHookBase(ref, () => this._pRender());
		// A tick beside a grant is only true while it is true
		this._comp._addHookBase("proficiencies", () => this._pRender());
		this._comp._addHookBase("originFeats", () => this._pRender());
		CHAR_SHEET_SKILLS.forEach(({key}) => this._comp._addHookBase(`skill_${key}`, () => this._pRender()));
		this._pRender();
	}

	get _ref () { return this._kind === "species" ? this._comp._state.refSpecies : this._comp._state.refBackground; }

	async _pRender () {
		if (!this._wrp) return;
		const token = ++this._renderToken;

		const ref = this._ref;
		if (!ref?.name) {
			const what = this._kind === "species" ? "species" : "background";
			this._wrp.innerHTML = `<div class="ve-muted ve-small">No ${what} picked yet. Choosing one here applies what it grants, rather than only naming it.</div>`;
			return;
		}

		const ent = this._kind === "species"
			? await CharacterSheetClassData.pGetSpecies({name: ref.name, source: ref.source}).catch(() => null)
			: await CharacterSheetClassData.pGetBackground({name: ref.name, source: ref.source}).catch(() => null);
		if (token !== this._renderToken) return;

		this._wrp.innerHTML = "";
		this._wrp.appendChild(this._getHeader(ref, ent));

		if (!ent) {
			this._wrp.insertAdjacentHTML("beforeend",
				`<div class="ve-muted ve-small">Its data is not loaded, so what it grants cannot be shown. The character keeps everything already applied.</div>`);
			return;
		}

		this._renderGrants(ent);
		this._renderOpenChoices(ent);
		this._renderTraits(ent);
	}

	_getHeader (ref, ent) {
		const wrp = document.createElement("div");
		wrp.className = "ve-flex-v-center ve-mb-1";

		const tag = this._kind === "species"
			? `{@race ${ref.name}${ref.source ? `|${ref.source}` : ""}}`
			: `{@background ${ref.name}${ref.source ? `|${ref.source}` : ""}}`;

		const name = document.createElement("span");
		name.className = "bold ve-mr-1";
		name.innerHTML = Renderer.get().render(tag);
		wrp.appendChild(name);

		if (ent?.size || ent?.speed) {
			const meta = document.createElement("span");
			meta.className = "ve-muted ve-small ve-mr-1";
			meta.textContent = [
				(ent.size || []).map(sz => Parser.sizeAbvToFull(sz)).join("/"),
				Parser.getSpeedString ? Parser.getSpeedString(ent) : null,
			].filter(Boolean).join(" · ");
			wrp.appendChild(meta);
		}

		const spacer = document.createElement("span");
		spacer.style.flex = "1";
		wrp.appendChild(spacer);

		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "ve-btn ve-btn-default ve-btn-xxs no-print";
		btn.textContent = "Change";
		btn.addEventListener("click", () => (this._kind === "species" ? this._page._onPickSpecies() : this._page._onPickBackground()));
		wrp.appendChild(btn);

		return wrp;
	}

	/* -------------------------------------------- Grants -------------------------------------------- */

	_renderGrants (ent) {
		const rows = [];

		Object.entries(getFixedAbilityBonuses(ent.ability) || {}).forEach(([abv, n]) => {
			rows.push({
				label: `${n >= 0 ? "+" : ""}${n} ${Parser.attAbvToFull(abv)}`,
				isHave: (this._comp._state.abilityBonusLog || []).some(it => (it.bonuses || {})[abv]),
			});
		});

		// Structured skills come back as proficiency entries; the sheet keeps them as skill states
		(ent.skillProficiencies || []).forEach(grp => {
			Object.entries(grp).forEach(([k, v]) => {
				if (v !== true) return;
				const skill = CHAR_SHEET_SKILLS.find(it => it.key.toLowerCase() === k.toLowerCase() || it.name.toLowerCase() === k.toLowerCase());
				if (!skill) return;
				rows.push({
					label: `${skill.name} (skill)`,
					isHave: (Number(this._comp._state[`skill_${skill.key}`]) || 0) >= PROF_STATE_PROFICIENT,
				});
			});
		});

		const have = new Set((this._comp._state.proficiencies || []).map(it => `${it.kind}|${it.name}`.toLowerCase()));
		getEntityProficiencies(ent).forEach(prof => {
			rows.push({label: `${prof.name} (${prof.kind})`, isHave: have.has(`${prof.kind}|${prof.name}`.toLowerCase())});
		});

		const takenFeats = new Set((this._comp._state.originFeats || []).map(it => `${it.name}|${it.source}`.toLowerCase()));
		getGrantedFeats(ent.feats).forEach(feat => {
			rows.push({
				label: `${feat.displayName || feat.name} (origin feat)`,
				isHave: takenFeats.has(`${feat.name}|${feat.source}`.toLowerCase()),
			});
		});

		// "An Origin feat of your choice" — the 2024 Human's Versatile. Counted rather than named,
		// since which one it is was up to whoever chose
		const nTaken = (this._comp._state.originFeats || []).length;
		getGrantedFeatCategories(ent.feats).forEach((grant, ix) => {
			rows.push({label: `Origin feat of your choice`, isHave: nTaken > ix});
		});

		if (!rows.length) return;

		const wrp = document.createElement("div");
		wrp.className = "ve-mb-1";
		wrp.insertAdjacentHTML("beforeend", `<div class="cs__lbl">Grants</div>`);

		rows.forEach(row => {
			const ele = document.createElement("div");
			ele.className = `ve-small ${row.isHave ? "" : "ve-muted"}`;
			// A tick is the difference between "the book says you get this" and "you have it"
			ele.textContent = `${row.isHave ? "✓" : "○"} ${row.label}`;
			if (!row.isHave) ele.title = "Not applied to this character";
			wrp.appendChild(ele);
		});

		this._wrp.appendChild(wrp);
	}

	/* -------------------------------------------- Open choices -------------------------------------------- */

	_renderOpenChoices (ent) {
		const wrp = document.createElement("div");
		wrp.className = "ve-mb-1";

		const rows = [];
		const takenFeats = new Set((this._comp._state.originFeats || []).map(it => `${it.name}|${it.source}`.toLowerCase()));
		const nTaken = takenFeats.size;

		const choices = getPendingChoices(this._kind === "species" ? {race: ent} : {background: ent});
		if (choices.filter(c => c.type !== CHOICE_TYPE_ABILITY).length) {
			rows.push({
				text: choices.filter(c => c.type !== CHOICE_TYPE_ABILITY).map(c => c.label).join(", "),
				btn: "Choose",
				// The page's own key for a species is `race`, following the data
				pFn: () => this._page._pResolveProficiencyChoices({ent, kind: this._kind === "species" ? "race" : "background"}),
			});
		}
		if (choices.some(c => c.type === CHOICE_TYPE_ABILITY) || Object.keys(getFixedAbilityBonuses(ent.ability) || {}).length) {
			rows.push({text: "Ability score increases", btn: "Apply", pFn: () => this._page._pOfferAbilityBonuses(ent, ent.name)});
		}

		const missingFeats = getGrantedFeats(ent.feats).filter(it => !takenFeats.has(`${it.name}|${it.source}`.toLowerCase()));
		const nChoiceFeats = getGrantedFeatCategories(ent.feats).reduce((acc, it) => acc + it.count, 0);
		const isOwedChoice = nChoiceFeats > Math.max(0, nTaken - getGrantedFeats(ent.feats).length);

		if (missingFeats.length || isOwedChoice) {
			const what = missingFeats.length
				? `Origin feat: ${missingFeats.map(it => it.displayName || it.name).join(", ")}`
				: "Origin feat of your choice";
			rows.push({text: what, btn: "Take it", pFn: () => this._page._pGrantOriginFeats(ent)});
		}

		if (!rows.length) return;

		wrp.insertAdjacentHTML("beforeend", `<div class="cs__lbl">Still to choose</div>`);
		rows.forEach(row => {
			const ele = document.createElement("div");
			ele.className = "ve-flex-v-center ve-small ve-mb-1";
			const lbl = document.createElement("span");
			lbl.className = "ve-mr-1";
			lbl.style.flex = "1";
			lbl.textContent = row.text;
			ele.appendChild(lbl);

			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "ve-btn ve-btn-primary ve-btn-xxs no-print";
			btn.textContent = row.btn;
			btn.addEventListener("click", async () => {
				try {
					await row.pFn();
				} catch (e) {
					JqueryUtil.doToast({type: "danger", content: `${e?.message || e}`});
				}
				this._pRender();
			});
			ele.appendChild(btn);
			wrp.appendChild(ele);
		});

		this._wrp.appendChild(wrp);
	}

	/* -------------------------------------------- Traits -------------------------------------------- */

	_renderTraits (ent) {
		const entries = (ent.entries || []).filter(it => it && typeof it === "object" && it.name);
		if (!entries.length) return;

		const wrp = document.createElement("div");
		wrp.className = "cs__feat-list";

		entries.forEach(entry => {
			const card = document.createElement("details");
			card.className = "cs__feat-card";

			const summary = document.createElement("summary");
			summary.innerHTML = `<span class="cs__feat-name">${entry.name.qq()}</span>`;
			card.appendChild(summary);

			const body = document.createElement("div");
			body.className = "cs__feat-body";
			body.innerHTML = Renderer.get().setFirstSection(true).render({type: "entries", entries: entry.entries || []}, 2);
			card.appendChild(body);

			wrp.appendChild(card);
		});

		this._wrp.appendChild(wrp);
	}
}
