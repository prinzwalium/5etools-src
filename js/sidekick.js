import {CHAR_SHEET_ABILITIES} from "./charactersheet/charactersheet-consts.js";
import {deriveCharacterSheet} from "./charactersheet/charactersheet-derive.js";
import {CharacterSheetClassData} from "./charactersheet/charactersheet-classdata.js";
import {CharacterClassPanel} from "./charactersheet/charactersheet-classpanel.js";
import {CharacterInventoryPanel} from "./charactersheet/charactersheet-inventorypanel.js";
import {CharacterSpellsPanel} from "./charactersheet/charactersheet-spellspanel.js";
import {CharacterPageBase} from "./charactersheet/charactersheet-pagebase.js";
import {
	ESK_MAX_LEVEL,
	ESK_SIDEKICK_TYPES,
	SIDEKICK_ESK_RULE_UID,
	SIDEKICK_RULE_UID,
	SIDEKICK_TRAIT_SECTIONS,
	findSidekickStatBlock,
	getEskFeaturesUpToLevel,
	getEskHpForLevel,
	getEskLevelRow,
	getEskLevelTables,
	getSidekickExpectedHp,
	getSidekickLevelTable,
	getSidekickRoles,
	getSidekickSeed,
} from "./charactersheet/charactersheet-sidekick.js";

/**
 * The Sidekick Builder.
 *
 * Two published rulesets, both read from the data rather than restated here:
 *  - the **Essentials Kit's** three sidekicks (Expert, Spellcaster, Warrior), each with a role for
 *    two of them, and a fixed table for levels 2–6 giving the exact hit points and features;
 *  - **Tasha's** sidekick *classes*, for a sidekick past 6th level.
 *
 * A sidekick is stored as an ordinary character (same store, same model, same panels) with
 * `isSidekick` set, so everything the character sheet already does — derivation, the feature
 * timeline, spell slots, autosave, save/load — works here unchanged. This page is a DM's tool, so
 * every seeded value stays editable; nothing is locked once a type or creature is applied.
 */
class SidekickPage extends CharacterPageBase {
	constructor () {
		super();
		this._sidekickClasses = [];
		this._eskTables = {};
		this._eskCreatures = [];
	}

	/** The store is shared with the character pages; each page shows only its own kind. */
	_isCharacterListed (state) { return !!state?.isSidekick; }

	/** A newly created character on this page is a sidekick. */
	_getNewCharacterState () { return {isSidekick: true}; }

	_buildDom () {
		this._buildAbilities();
		this._buildSaves();
		this._buildSkills();
		this._buildDeathSaves();
		this._buildConditions();
	}

	_bindDom () {
		this._bindClick("cs-pick-creature", () => this._pOnPickCreature());
		this._bindClick("cs-hp-damage", () => this._adjustHp(-1));
		this._bindClick("cs-hp-heal", () => this._adjustHp(1));
		this._bindClick("cs-short-rest", () => this._comp.shortRest());
		this._bindClick("cs-long-rest", () => this._comp.longRest());
		// the base binds the print button, prep included
		this._bindClick("cs-attack-add", () => this._comp.addAttack());
		this._bindClick("cs-sk-rules-toggle", () => this._onToggleRules());
		this._bindClick("cs-sk-trait-add", () => this._pOnAddTrait());

		this._pBuildClassSelect();
		document.getElementById("cs-sk-class").addEventListener("change", () => this._onChangeClass());

		this._buildTypeSelect();
		document.getElementById("cs-sk-type").addEventListener("change", () => this._pOnChangeType());
		document.getElementById("cs-sk-role").addEventListener("change", () => this._pOnChangeRole());
		this._pLoadEskData();

		this._attacksCollection = new _SidekickAttacks(this._comp, document.getElementById("cs-attacks-body"));
		this._comp._addHookBase("attacks", () => this._attacksCollection.render());

		this._classPanel = new CharacterClassPanel({comp: this._comp, wrp: document.getElementById("cs-class-panel")});
		this._classPanel.init();
		this._inventoryPanel = new CharacterInventoryPanel({comp: this._comp, wrp: document.getElementById("cs-inventory")});
		this._inventoryPanel.init();
		this._spellsPanel = new CharacterSpellsPanel({
			comp: this._comp,
			wrpSlots: document.getElementById("cs-spell-slots"),
			wrpKnown: document.getElementById("cs-spells-known"),
			wrpBody: document.getElementById("cs-spell-body"),
		});
		this._spellsPanel.init();

		this._comp._addHookBase("deathSuccess", () => this._renderDeathSaves());
		this._comp._addHookBase("deathFail", () => this._renderDeathSaves());
		this._comp._addHookBase("conditions", () => this._renderConditions());
		this._traitsCollection = new _SidekickTraits(this._comp, document.getElementById("cs-sk-traits"));
		this._comp._addHookBase("sidekickTraits", () => this._traitsCollection.render());

		this._comp._addHookBase("classes", () => {
			this._renderClassSelect();
			this._renderLevelTable();
			this._renderSubtitle();
		});
		this._comp._addHookBase("refCreature", () => this._renderSubtitle());
		this._comp._addHookBase("level", () => this._renderLevelTable());
		this._comp._addHookBase("sidekickType", () => {
			this._renderTypeSelect();
			this._renderLevelTable();
			this._renderSubtitle();
		});
		this._comp._addHookBase("sidekickRole", () => {
			this._renderTypeSelect();
			this._renderLevelTable();
			this._renderSubtitle();
		});
	}

	_doRenderAll () {
		this._syncAllInputs();
		this._attacksCollection.render();
		this._traitsCollection.render();
		this._renderPickLinks();
		this._renderDeathSaves();
		this._renderConditions();
		this._renderProficiencies();
		this._renderDefenses();
		this._renderAbilityOffers();
		this._renderSubtitle();
		this._renderClassSelect();
		this._renderTypeSelect();
		this._renderLevelTable();
		this._renderDerived();
		this._lastLevel = this._comp.getLevelNumber();
	}

	/* -------------------------------------------- The Essentials Kit sidekicks -------------------------------------------- */

	/**
	 * Where the books restate the three sidekicks at higher levels. The Essentials Kit stats them at
	 * 1st level and its adventures reprint each one at 7th, 9th and 11th, so a DM past the tables has
	 * a printed block to seed from. A source that cannot be loaded is simply skipped.
	 */
	static _STATBLOCK_SOURCES = ["ESK", "SLW", "SDW", "DC"];

	static async _pLoadCreature (name, source) {
		const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_BESTIARY]({name, source});
		return DataLoader.pCacheAndGet(UrlUtil.PG_BESTIARY, source, hash, {isCopy: true}).catch(() => null);
	}

	/** The level tables, and the 1st-level stat blocks the type select seeds from. */
	async _pLoadEskData () {
		const [name, source] = SIDEKICK_ESK_RULE_UID.split("|");
		const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_VARIANTRULES]({name, source});
		const rule = await DataLoader.pCacheAndGet(UrlUtil.PG_VARIANTRULES, source, hash).catch(() => null);
		this._eskTables = getEskLevelTables(rule);

		const loaded = await Promise.all(ESK_SIDEKICK_TYPES.map(it => SidekickPage._pLoadCreature(it.name, it.source)));
		this._eskCreatures = loaded.filter(Boolean);

		this._renderTypeSelect();
		this._renderLevelTable();
	}

	/** Every printed block for one type, across the sources that reprint it, loaded once. */
	async _pGetStatBlocksForType (type) {
		const typeName = ESK_SIDEKICK_TYPES.find(it => it.key === type)?.name;
		if (!typeName) return this._eskCreatures;

		// The 1st-level block names the roles, and a reprint that is split by role is titled with it
		const base = this._eskCreatures.find(it => it.name === typeName && it.source === "ESK");
		const names = [typeName, ...getSidekickRoles(base || {}).roles.map(role => `${typeName} (${role.name})`)];

		const wanted = SidekickPage._STATBLOCK_SOURCES.flatMap(source => names.map(name => ({name, source})));
		const missing = wanted.filter(({name, source}) => !this._eskCreatures.some(it => it.name === name && it.source === source));
		if (missing.length) {
			const loaded = await Promise.all(missing.map(({name, source}) => SidekickPage._pLoadCreature(name, source)));
			this._eskCreatures = [...this._eskCreatures, ...loaded.filter(Boolean)];
		}

		return this._eskCreatures;
	}

	_buildTypeSelect () {
		const sel = document.getElementById("cs-sk-type");
		sel.innerHTML = `<option value="">&mdash; none &mdash;</option>${ESK_SIDEKICK_TYPES
			.map(it => `<option value="${it.key}" title="${it.blurb.qq()}">${it.name.qq()}</option>`)
			.join("")}`;
	}

	/** The role select only exists for a type that has roles, and its options come from the data. */
	_renderTypeSelect () {
		const sel = document.getElementById("cs-sk-type");
		if (sel) sel.value = this._comp._state.sidekickType || "";

		const roles = getSidekickRoles(this._getBaseCreature() || {}).roles;
		const field = document.getElementById("cs-sk-role-field");
		const selRole = document.getElementById("cs-sk-role");
		const hint = document.getElementById("cs-sk-role-hint");
		if (!field || !selRole) return;

		field.classList.toggle("ve-hidden", !roles.length);
		if (!roles.length) {
			if (hint) hint.textContent = "";
			return;
		}

		const cur = this._comp._state.sidekickRole;
		selRole.innerHTML = `<option value="">&mdash; choose &mdash;</option>${roles
			.map(it => `<option value="${it.key}">${it.name.qq()}</option>`)
			.join("")}`;
		selRole.value = roles.some(it => it.key === cur) ? cur : "";

		const lbl = document.getElementById("cs-sk-role-lbl");
		const traitName = getSidekickRoles(this._getBaseCreature() || {}).traitName;
		if (lbl) lbl.textContent = traitName || "Specialisation";

		const chosen = roles.find(it => it.key === cur);
		if (hint) hint.textContent = chosen ? chosen.text : `Choose: ${roles.map(it => `${it.name} — ${it.text}`).join("  ·  ")}`;
	}

	/** The stat block this sidekick is built on, whichever way it was picked. */
	_getBaseCreature () {
		const ref = this._comp._state.refCreature;
		if (ref) {
			const found = this._eskCreatures.find(it => it.name === ref.name && it.source === ref.source);
			if (found) return found;
		}
		const type = this._comp._state.sidekickType;
		if (!type) return null;
		return findSidekickStatBlock(this._eskCreatures, {type, role: this._comp._state.sidekickRole, level: 1});
	}

	async _pOnChangeType () {
		const type = document.getElementById("cs-sk-type").value || null;
		if (!type) { this._comp.setSidekickType(null); return; }

		await this._pGetStatBlocksForType(type);
		const ent = findSidekickStatBlock(this._eskCreatures, {type, level: 1});
		this._comp.setSidekickType(type);
		if (!ent) { this._renderTypeSelect(); return; }

		// Seed from the 1st-level block, then take the hit points the table gives its current level
		this._applyCreature(ent, {name: ent.name, source: ent.source, tag: `{@creature ${ent.name}|${ent.source}}`});
		this._applyEskHp();
		this._renderTypeSelect();
		this._renderLevelTable();
	}

	async _pOnChangeRole () {
		const role = document.getElementById("cs-sk-role").value || null;
		this._comp.setSidekickRole(role);

		const ent = this._getBaseCreature();
		if (ent) {
			// The role decides which of the block's entries apply — and, for a Spellcaster, how it casts
			this._comp.setSidekickTraitsFromCreature(ent, {role});
			const sc = (ent.spellcasting || []).find(it => new RegExp(`\\(${role}\\)`, "i").test(it.name || ""));
			if (sc?.ability) this._comp._state.spellAbility = sc.ability;
		}

		this._renderTypeSelect();
		this._renderLevelTable();
		this._renderDerived();
	}

	/** Set Max HP to what the Essentials Kit table gives this type at this level. */
	_applyEskHp () {
		const type = this._comp._state.sidekickType;
		if (!type) return false;
		const hp = getEskHpForLevel(this._eskTables, type, this._comp.getLevelNumber(), {baseCreature: this._getBaseCreature()});
		if (hp == null) return false;
		this._comp._state.hpMax = hp;
		this._comp._state.hpCur = hp;
		return true;
	}

	/* -------------------------------------------- The base creature -------------------------------------------- */

	async _pOnPickCreature () {
		// The creature search reads the global content index, which only pages with the omnisearch
		// build on load — so this page has to ask for it before the first pick.
		await SearchWidget.pDoGlobalInit();

		const doc = await SearchWidget.pGetUserCreatureSearch();
		if (!doc) return;

		const ent = await DataLoader.pCacheAndGet(doc.page, doc.source, doc.hash, {isCopy: true});
		if (!ent) return;

		// Keep the picked block to hand, so its roles and entries can be re-read without a refetch
		if (!this._eskCreatures.some(it => it.name === ent.name && it.source === ent.source)) this._eskCreatures.push(ent);

		this._applyCreature(ent, {name: doc.n, source: doc.source, tag: doc.tag});
		this._renderTypeSelect();
		this._renderLevelTable();
	}

	/** Seed the sheet from a stat block — the same path whether it was searched for or came from a type. */
	_applyCreature (ent, doc) {
		const seed = getSidekickSeed(ent, {proficiencyBonus: deriveCharacterSheet(this._comp._getState()).pb});
		this._comp.applySidekickCreature({doc, ent, seed});

		// The stat block's hit die is what the sidekick gains per level from here on. The model keeps
		// it, so a class chosen later picks it up too.
		const entry = this._comp._state.classes[0];
		if (entry && seed.hitDie) {
			entry.hdFaces = seed.hitDie;
			this._comp._triggerCollectionUpdate("classes");
		}
		if (seed.hitDie) this._comp._state.hdTotal = `${this._comp.getLevelNumber()}d${seed.hitDie}`;

		this._renderSubtitle();
	}

	/* -------------------------------------------- Traits & actions -------------------------------------------- */

	/** Add one trait, action, bonus action or reaction — the DM types it, or names one of their own. */
	async _pOnAddTrait () {
		const section = await InputUiUtil.pGetUserEnum({
			values: SIDEKICK_TRAIT_SECTIONS,
			title: "Add what?",
			default: 0,
			fnDisplay: it => it,
		});
		if (section == null) return;

		const name = await InputUiUtil.pGetUserString({title: "Name", default: ""});
		if (name == null) return;

		this._comp.addSidekickTrait({section: SIDEKICK_TRAIT_SECTIONS[section], name});
	}

	/** The stat-block line under the name: what it was, and what it has become. */
	_renderSubtitle () {
		const ele = document.getElementById("cs-sk-subtitle");
		if (!ele) return;

		const {refCreature: ref, sidekickType: type, sidekickRole: role} = this._comp._state;
		const cls = this._comp._state.classes[0];
		if (!ref && !cls && !type) {
			ele.innerHTML = `<span class="ve-muted">Pick a sidekick type or a base creature &mdash; or just type the numbers in by hand.</span>`;
			return;
		}

		const typeName = ESK_SIDEKICK_TYPES.find(it => it.key === type)?.name;
		const ptKind = cls
			? `${cls.name} ${cls.level}`
			: [typeName, role ? `(${role})` : null, `level ${this._comp.getLevelNumber()}`].filter(Boolean).join(" ");

		ele.innerHTML = [
			ref ? Renderer.get().render(ref.tag || ref.name) : "",
			ptKind ? `<span class="ve-muted">${ptKind.qq()}</span>` : "",
		].filter(Boolean).join(" <span class=\"ve-muted\">&mdash;</span> ");
	}

	/* -------------------------------------------- The sidekick class -------------------------------------------- */

	async _pBuildClassSelect () {
		this._sidekickClasses = await CharacterSheetClassData.pGetAllSidekickClasses().catch(() => []);
		const sel = document.getElementById("cs-sk-class");
		sel.innerHTML = `<option value="">&mdash;</option>${this._sidekickClasses
			.map((cls, ix) => `<option value="${ix}">${cls.name.qq()}</option>`)
			.join("")}`;
		this._renderClassSelect();
		this._renderLevelTable();
	}

	_renderClassSelect () {
		const cur = this._comp._state.classes[0];

		// The class-features panel is only meaningful for the Tasha's path
		const wrpPanel = document.getElementById("cs-sk-class-panel-wrp");
		if (wrpPanel) wrpPanel.classList.toggle("ve-hidden", !cur);

		const sel = document.getElementById("cs-sk-class");
		if (!sel || !this._sidekickClasses.length) return;
		const ix = cur ? this._sidekickClasses.findIndex(it => it.name === cur.name && it.source === cur.source) : -1;
		sel.value = ix >= 0 ? `${ix}` : "";
	}

	_onChangeClass () {
		const sel = document.getElementById("cs-sk-class");
		const cls = this._sidekickClasses[Number(sel.value)];
		if (!cls) return;
		this._comp.setSidekickClass(cls, {level: this._comp.getLevelNumber()});
	}

	/* -------------------------------------------- "How sidekicks level" -------------------------------------------- */

	_getCurrentClass () {
		const cur = this._comp._state.classes[0];
		return cur ? this._sidekickClasses.find(it => it.name === cur.name && it.source === cur.source) : null;
	}

	/**
	 * What this sidekick gains at each level, with the current level marked — the thing a DM wants
	 * to see when the party levels up. Read from the data either way: the Essentials Kit's table for
	 * one of its three sidekicks, otherwise the sidekick class's own features.
	 */
	_renderLevelTable () {
		const wrp = document.getElementById("cs-sk-level-table");
		if (!wrp) return;

		const type = this._comp._state.sidekickType;
		if (type && this._eskTables[type]) return this._renderEskLevelTable(wrp, type);

		const wrpNext = document.getElementById("cs-sk-level-next");
		if (wrpNext) wrpNext.innerHTML = "";

		const cls = this._getCurrentClass();
		if (!cls) {
			wrp.innerHTML = `<div class="ve-muted ve-small">Pick a sidekick type above to see its levels, or choose a Tasha's sidekick class.</div>`;
			return;
		}

		const level = this._comp.getLevelNumber();
		const rows = getSidekickLevelTable(cls);
		const hitDie = this._comp._state.sidekickHitDie || this._comp._state.classes[0]?.hdFaces;

		wrp.innerHTML = `
			<div class="ve-small ve-muted ve-mb-1">A sidekick levels up whenever the party's average level does. Each level it gains one Hit Die${hitDie ? ` (d${hitDie})` : ""} plus its Constitution modifier in hit points, and its proficiency bonus follows its level.</div>
			<table class="cs__sk-table w-100">
				<thead><tr><th>Lvl</th><th>PB</th><th>Gains</th></tr></thead>
				<tbody>
					${rows.map(row => `
						<tr class="${row.level === level ? "cs__sk-row--now" : ""}${row.level > level ? " cs__sk-row--future" : ""}">
							<td class="ve-text-center">${row.level}</td>
							<td class="ve-text-center">+${row.pb}</td>
							<td>${row.features.length ? row.features.map(it => it.qq()).join(", ") : "<span class=\"ve-muted\">&mdash;</span>"}</td>
						</tr>
					`).join("")}
				</tbody>
			</table>`;
	}

	/**
	 * The Essentials Kit table: an exact hit-point maximum and named features per level, levels 1–6.
	 * Level 1 is the stat block itself, so it is shown from the block rather than the table.
	 */
	_renderEskLevelTable (wrp, type) {
		const level = this._comp.getLevelNumber();
		const base = this._getBaseCreature();
		const rows = [
			{level: 1, hpMax: base?.hp?.average ?? null, hpFormula: base?.hp?.formula || "", features: [{name: "Stat block", text: ""}]},
			...this._eskTables[type],
		];

		wrp.innerHTML = `
			<table class="cs__sk-table w-100">
				<thead><tr><th>Lvl</th><th>HP</th><th>Gains</th></tr></thead>
				<tbody>
					${rows.map(row => `
						<tr class="${row.level === level ? "cs__sk-row--now" : ""}${row.level > level ? " cs__sk-row--future" : ""}">
							<td class="ve-text-center">${row.level}</td>
							<td class="ve-text-center" title="${row.hpFormula.qq()}">${row.hpMax ?? "&mdash;"}</td>
							<td>${row.features.map(it => (it.name || "").qq()).filter(Boolean).join(", ") || "<span class=\"ve-muted\">&mdash;</span>"}</td>
						</tr>
					`).join("")}
				</tbody>
			</table>
			<div class="ve-small ve-muted ve-mt-1">Levels 2&ndash;6 come from the Essentials Kit's table for this sidekick. Where a feature offers a choice between roles, take the one for its own role.</div>`;

		this._renderEskNextLevel(type, level);
	}

	/**
	 * The level-up box: what the sidekick is owed at its current level, and what the next level brings.
	 * Applied on a click rather than automatically, because by the time a sidekick levels its sheet is
	 * usually hand-tuned and silently overwriting that would be worse than asking.
	 */
	_renderEskNextLevel (type, level) {
		const wrp = document.getElementById("cs-sk-level-next");
		if (!wrp) return;
		wrp.innerHTML = "";

		const base = this._getBaseCreature();
		const owed = getEskFeaturesUpToLevel(this._eskTables, type, level)
			.filter(feature => !this._comp._state.sidekickTraits.some(it => it.name === feature.name && it.level === feature.level));
		const hpNow = getEskHpForLevel(this._eskTables, type, level, {baseCreature: base});
		// Short of the table's hit points means the level has not been taken yet. *Above* it is a
		// deliberate edit — a beefed-up sidekick — and gets no nagging.
		const isHpStale = hpNow != null && Number(this._comp._state.hpMax) < hpNow;

		const next = getEskLevelRow(this._eskTables, type, level + 1);

		const mkBtn = (text, cls, title, fn) => {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = `ve-btn ve-btn-xs ${cls}`;
			btn.innerHTML = text;
			btn.title = title;
			btn.addEventListener("click", fn);
			return btn;
		};

		if (next) {
			const box = document.createElement("div");
			box.className = "cs__sk-next";
			box.innerHTML = `
				<div class="cs__sk-next-hdr">Level ${next.level}</div>
				<div class="ve-small"><span class="ve-bold">${next.hpMax} HP</span> <span class="ve-muted">(${next.hpFormula.qq()})</span></div>
				<div class="ve-small">${next.features.map(it => `<span class="ve-bold">${it.name.qq()}.</span> ${Renderer.stripTags(it.text || "").qq()}`).join("<br>")}</div>`;

			const btn = mkBtn(
				`<span class="glyphicon glyphicon-arrow-up"></span> Level up to ${next.level}`,
				"ve-btn-primary ve-mt-1",
				"Set the level, take the table's hit points, and add its features to Traits & Actions",
				() => this._onEskLevelUp(next.level),
			);
			box.appendChild(btn);
			wrp.appendChild(box);
		} else if (level >= ESK_MAX_LEVEL) {
			const note = document.createElement("div");
			note.className = "ve-small ve-muted";
			note.innerHTML = `The Essentials Kit's table stops at ${ESK_MAX_LEVEL}th level. Past that, give it a Tasha's sidekick class &mdash; or seed a printed higher-level block below.`;
			wrp.appendChild(note);
			this._pAppendReseedButton(wrp, type, level);
		}

		if (owed.length || isHpStale) {
			const catchUp = document.createElement("div");
			catchUp.className = "cs__sk-catchup ve-mt-1";
			catchUp.innerHTML = `<div class="ve-small">At level ${level} this sidekick is still owed ${[
				owed.length ? `${owed.length} feature${owed.length === 1 ? "" : "s"}` : null,
				isHpStale ? `${hpNow} max HP` : null,
			].filter(Boolean).join(" and ")}.</div>`;
			catchUp.appendChild(mkBtn(
				`Catch up to level ${level}`,
				"ve-btn-default ve-mt-1",
				"Add the missing features and set the table's hit points for this level",
				() => this._onEskCatchUp(level),
			));
			wrp.appendChild(catchUp);
		}
	}

	/** Offer the printed stat block for this level, when a book has one. */
	async _pAppendReseedButton (wrp, type, level) {
		await this._pGetStatBlocksForType(type);
		const block = findSidekickStatBlock(this._eskCreatures, {type, role: this._comp._state.sidekickRole, level});
		if (!block || (block.level || 1) <= 1 || !wrp.isConnected) return;

		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "ve-btn ve-btn-xs ve-btn-default ve-mt-1";
		btn.innerHTML = `Seed from the level-${block.level} block <span class="ve-muted">(${Parser.sourceJsonToAbv(block.source)})</span>`;
		btn.title = "Replace the numbers with the printed stat block for that level; anything you added by hand is kept";
		btn.addEventListener("click", () => {
			this._applyCreature(block, {name: block.name, source: block.source, tag: `{@creature ${block.name}|${block.source}}`});
			this._renderTypeSelect();
			this._renderLevelTable();
			this._renderDerived();
		});
		wrp.appendChild(btn);
	}

	_onEskLevelUp (level) {
		this._comp._state.level = level;
		this._onEskCatchUp(level);
	}

	_onEskCatchUp (level) {
		const type = this._comp._state.sidekickType;
		this._comp.applyEskLevelFeatures(getEskFeaturesUpToLevel(this._eskTables, type, level));
		this._applyEskHp();
		this._syncAllInputs();
		this._renderLevelTable();
		this._renderDerived();
	}

	async _onToggleRules () {
		const wrp = document.getElementById("cs-sk-rules");
		if (!wrp) return;

		// Show the ruleset this sidekick is actually built on
		const uid = this._comp._state.sidekickType ? SIDEKICK_ESK_RULE_UID : SIDEKICK_RULE_UID;
		if (wrp.dataset.loadedUid !== uid) {
			const [name, source] = uid.split("|");
			const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_VARIANTRULES]({name, source});
			const ent = await DataLoader.pCacheAndGet(UrlUtil.PG_VARIANTRULES, source, hash).catch(() => null);
			wrp.innerHTML = ent
				? Renderer.get().setFirstSection(true).render({type: "entries", entries: ent.entries})
				: `<div class="ve-muted">Could not load the sidekick rules.</div>`;
			wrp.dataset.loadedUid = uid;
		}

		const isHidden = wrp.classList.toggle("ve-hidden");
		document.getElementById("cs-sk-rules-toggle").textContent = isHidden ? "Full rules" : "Hide rules";
	}

	/* -------------------------------------------- Derived rendering -------------------------------------------- */

	_renderDerived () {
		const derived = deriveCharacterSheet(this._comp._getState());

		const elePb = document.getElementById("cs-pb");
		if (elePb) elePb.textContent = CharacterPageBase.fmtBonus(derived.pb);

		this._renderAbilitiesSavesSkills(derived);
		this._renderExhaustionNote(derived);
		this._renderRoll("cs-initiative-roll", derived.initiative, "Initiative", derived.initiativeParts);

		// Hit points the rules would give, as a hint rather than a correction
		const eleHint = document.getElementById("cs-sk-hp-hint");
		if (eleHint) {
			const hitDie = this._comp._state.sidekickHitDie || this._comp._state.classes[0]?.hdFaces;
			const expected = getSidekickExpectedHp({
				baseHp: this._comp._state.refCreature ? this._comp._state.hpMax : null,
				hitDie,
				conMod: derived.abilities.con.mod,
				level: this._comp.getLevelNumber(),
			});
			eleHint.textContent = hitDie ? `Gains ~${Math.max(1, Math.floor(hitDie / 2) + 1 + derived.abilities.con.mod)} HP per level` : "";
			eleHint.title = expected != null ? `A d${hitDie} sidekick at this level would have about ${expected} HP` : "";
		}

		const eleDc = document.getElementById("cs-spell-dc");
		const eleAtk = document.getElementById("cs-spell-atk");
		if (eleDc && eleAtk) {
			if (derived.spell) {
				eleDc.textContent = `${derived.spell.dc}`;
				eleAtk.innerHTML = Renderer.get().render(`{@d20 ${derived.spell.atkMod}|${CharacterPageBase.fmtBonus(derived.spell.atkMod)}|Spell attack}`);
			} else {
				eleDc.textContent = "—";
				eleAtk.textContent = "—";
			}
			CharacterPageBase.setSpellBadgesVisible(!!derived.spell);
		}
	}
}

/**
 * Traits and actions, one editable row each: a section, a name, and the text. Seeded from a stat
 * block or granted by a level, but every row behaves the same once it is there — the DM can retitle
 * it, rewrite it or throw it away.
 */
class _SidekickTraits extends RenderableCollectionBase {
	constructor (comp, wrpRows) {
		super(comp, "sidekickTraits");
		this._wrpRows = wrpRows;
	}

	getNewRender (trait) {
		const wrp = document.createElement("div");
		wrp.className = "cs__sk-trait";

		const top = document.createElement("div");
		top.className = "cs__sk-trait-top";

		const selSection = document.createElement("select");
		selSection.className = "ve-form-control ve-input-xs cs__sk-trait-section no-print";
		selSection.innerHTML = SIDEKICK_TRAIT_SECTIONS.map(it => `<option value="${it}">${it}</option>`).join("");
		selSection.value = trait.section || "Trait";
		selSection.addEventListener("change", () => this._comp.updateSidekickTrait(trait.id, {section: selSection.value}));

		const iptName = document.createElement("input");
		iptName.type = "text";
		iptName.className = "ve-form-control ve-input-xs cs__sk-trait-name";
		iptName.placeholder = "Name";
		iptName.value = trait.name || "";
		iptName.addEventListener("change", () => this._comp.updateSidekickTrait(trait.id, {name: iptName.value}));

		// What put the row here, so a DM can tell a stat block's own trait from one a level granted
		const tagSource = document.createElement("span");
		tagSource.className = "cs__sk-trait-tag ve-muted no-print";

		const btnDel = document.createElement("button");
		btnDel.type = "button";
		btnDel.className = "ve-btn ve-btn-xxs ve-btn-danger no-print";
		btnDel.innerHTML = `<span class="glyphicon glyphicon-trash"></span>`;
		btnDel.title = "Remove this entry";
		btnDel.addEventListener("click", () => this._comp.removeSidekickTrait(trait.id));

		top.append(selSection, iptName, tagSource, btnDel);

		const iptText = document.createElement("textarea");
		iptText.className = "ve-form-control cs__textarea cs__sk-trait-text";
		iptText.rows = 2;
		iptText.placeholder = "What it does...";
		iptText.value = trait.text || "";
		iptText.addEventListener("change", () => this._comp.updateSidekickTrait(trait.id, {text: iptText.value}));

		// A textarea's overflow does not print, so the print prep mirrors it into this
		const printText = document.createElement("div");
		printText.className = "cs__print-text";

		wrp.append(top, iptText, printText);
		this._wrpRows.appendChild(wrp);

		const meta = {wrpRow: wrp, selSection, iptName, iptText, tagSource, printText};
		this.doUpdateExistingRender(meta, trait);
		return meta;
	}

	doUpdateExistingRender (renderedMeta, trait) {
		const {selSection, iptName, iptText, tagSource, printText} = renderedMeta;

		if (document.activeElement !== selSection) selSection.value = trait.section || "Trait";
		if (document.activeElement !== iptName) iptName.value = trait.name || "";
		if (document.activeElement !== iptText) iptText.value = trait.text || "";
		printText.textContent = trait.text || "";

		tagSource.textContent = trait.source === "level" ? `lvl ${trait.level ?? ""}`.trim() : "";
		tagSource.title = trait.source === "level" ? "Granted by a level" : "";
	}

	doDeleteExistingRender (renderedMeta) {
		renderedMeta.wrpRow.remove();
	}
}

/** The attacks table — the same three editable columns the character sheet uses. */
class _SidekickAttacks extends RenderableCollectionBase {
	constructor (comp, wrpRows) {
		super(comp, "attacks");
		this._wrpRows = wrpRows;
	}

	getNewRender (atk) {
		const row = document.createElement("tr");
		const mk = (type, prop, cls, placeholder) => {
			const ipt = document.createElement("input");
			ipt.type = type;
			ipt.className = `ve-form-control ve-input-xs ${cls}`;
			if (placeholder) ipt.placeholder = placeholder;
			ipt.value = atk[prop] ?? "";
			ipt.addEventListener("change", () => {
				this._comp.updateAttack(atk.id, {[prop]: type === "number" ? Number(ipt.value) || 0 : ipt.value});
			});
			const td = document.createElement("td");
			td.appendChild(ipt);
			return {td, ipt};
		};

		const name = mk("text", "name", "", "e.g. Spear");
		const bonus = mk("number", "atkBonus", "cs__ipt-num cs__ipt-num--xs");
		const dmg = mk("text", "damage", "cs__atk-dmg", "e.g. 1d6+1 piercing");

		const tdRoll = document.createElement("td");
		tdRoll.className = "ve-text-center";
		const tdDel = document.createElement("td");
		tdDel.className = "ve-text-center no-print";
		const btnDel = document.createElement("button");
		btnDel.type = "button";
		btnDel.className = "ve-btn ve-btn-xxs ve-btn-danger";
		btnDel.innerHTML = `<span class="glyphicon glyphicon-trash"></span>`;
		btnDel.addEventListener("click", () => this._comp.removeAttack(atk.id));
		tdDel.appendChild(btnDel);

		row.append(name.td, bonus.td, dmg.td, tdDel);
		this._wrpRows.appendChild(row);
		return {wrpRow: row, iptName: name.ipt, iptAtk: bonus.ipt, iptDmg: dmg.ipt};
	}

	doUpdateExistingRender (renderedMeta, atk) {
		if (document.activeElement !== renderedMeta.iptName) renderedMeta.iptName.value = atk.name ?? "";
		if (document.activeElement !== renderedMeta.iptAtk) renderedMeta.iptAtk.value = atk.atkBonus ?? 0;
		if (document.activeElement !== renderedMeta.iptDmg) renderedMeta.iptDmg.value = atk.damage ?? "";
	}

	doDeleteExistingRender (renderedMeta) {
		renderedMeta.wrpRow.remove();
	}
}

window.addEventListener("load", () => {
	const page = new SidekickPage();
	// Exposed so the browser tests can ask the page about itself (e.g. whether sync is connected)
	window.__csPage = page;
	page.pInit();
});
