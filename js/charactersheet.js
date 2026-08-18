import {CHAR_SHEET_ABILITIES, CHAR_SHEET_CONDITIONS, CHAR_SHEET_SKILLS} from "./charactersheet/charactersheet-consts.js";
import {deriveCharacterSheet, formatBreakdown, getWeaponAttack} from "./charactersheet/charactersheet-derive.js";
import {getInventoryItemMeta} from "./charactersheet/charactersheet-equipment.js";
import {getChosenFeatureEffects, getFeatureInitiativeBonus} from "./charactersheet/charactersheet-features.js";
import {pGetUserItemSearchFiltered} from "./charactersheet/charactersheet-sources.js";
import {CharacterSheetClassData} from "./charactersheet/charactersheet-classdata.js";
import {CharacterClassPanel} from "./charactersheet/charactersheet-classpanel.js";
import {CharacterOriginPanel} from "./charactersheet/charactersheet-originpanel.js";
import {CharacterInventoryPanel} from "./charactersheet/charactersheet-inventorypanel.js";
import {CharacterSpellsPanel} from "./charactersheet/charactersheet-spellspanel.js";
import {CharacterActionsPanel} from "./charactersheet/charactersheet-actionspanel.js";
import {CharacterPageBase} from "./charactersheet/charactersheet-pagebase.js";
import {CharacterCardsPanel} from "./charactersheet/charactersheet-cardspanel.js";
import {CharacterJournalPanel} from "./charactersheet/charactersheet-journalpanel.js";

/** Renders the attacks table from the model's `attacks` collection. */
class _AttacksRenderableCollection extends RenderableCollectionBase {
	constructor (comp, wrpRows) {
		super(comp, "attacks");
		this._wrpRows = wrpRows;
	}

	getNewRender (entity) {
		const tr = document.createElement("tr");
		tr.className = "cs__atk-row";
		tr.innerHTML = `
			<td><input type="text" class="ve-form-control ve-input-xs cs__atk-name" aria-label="Attack name" placeholder="e.g. Longsword"></td>
			<td class="ve-text-center">
				<div class="cs__atk-cell">
					<input type="number" class="ve-form-control ve-input-xs cs__ipt-num cs__ipt-num--xs cs__atk-bonus" aria-label="Attack bonus">
					<span class="cs__roll cs__atk-hit"></span>
				</div>
			</td>
			<td class="ve-text-center">
				<div class="cs__atk-cell">
					<input type="text" class="ve-form-control ve-input-xs cs__atk-dmg" aria-label="Damage and type" placeholder="e.g. 1d8+3 slashing">
					<span class="cs__roll cs__atk-dmgroll"></span>
				</div>
			</td>
			<td class="ve-text-center no-print">
				<button type="button" class="ve-btn ve-btn-xs ve-btn-danger cs__atk-rm" title="Remove"><span class="glyphicon glyphicon-trash"></span></button>
			</td>
		`;

		const meta = {
			wrpRow: tr,
			iptName: tr.querySelector(".cs__atk-name"),
			iptBonus: tr.querySelector(".cs__atk-bonus"),
			iptDmg: tr.querySelector(".cs__atk-dmg"),
			dispHit: tr.querySelector(".cs__atk-hit"),
			dispDmg: tr.querySelector(".cs__atk-dmgroll"),
		};

		meta.iptName.addEventListener("input", () => this._comp.updateAttack(entity.id, {name: meta.iptName.value}));
		meta.iptBonus.addEventListener("input", () => this._comp.updateAttack(entity.id, {atkBonus: Number(meta.iptBonus.value) || 0}));
		meta.iptDmg.addEventListener("input", () => this._comp.updateAttack(entity.id, {damage: meta.iptDmg.value}));
		tr.querySelector(".cs__atk-rm").addEventListener("click", () => this._comp.removeAttack(entity.id));

		this._wrpRows.appendChild(tr);
		this.doUpdateExistingRender(meta, entity);

		return meta;
	}

	doUpdateExistingRender (meta, entity) {
		this.constructor._setIptValue(meta.iptName, entity.name);
		this.constructor._setIptValue(meta.iptBonus, `${entity.atkBonus ?? 0}`);
		this.constructor._setIptValue(meta.iptDmg, entity.damage);
		this.constructor._renderRolls(meta, entity);
	}

	doDeleteExistingRender (meta) {
		meta.wrpRow.remove();
	}

	/** Avoid clobbering the input the user is currently typing in. */
	static _setIptValue (ipt, val) {
		if (document.activeElement === ipt) return;
		if (ipt.value !== val) ipt.value = val;
	}

	static _renderRolls (meta, entity) {
		const name = (entity.name || "").trim();
		const bonus = Number(entity.atkBonus) || 0;
		const dmg = (entity.damage || "").trim();

		meta.dispHit.innerHTML = Renderer.get().render(`{@hit ${bonus}|${CharacterPageBase.fmtBonus(bonus)}|${name || "Attack"}}`);
		CharacterPageBase.setBreakdownTitle(meta.dispHit, `${name || "Attack"} to hit`, entity.atkParts, bonus, {citeKind: "attack"});

		if (dmg && /\d\s*d\s*\d/i.test(dmg)) {
			meta.dispDmg.innerHTML = Renderer.get().render(`{@dice ${dmg}|${dmg}|${name || "Damage"}}`);
			CharacterPageBase.setBreakdownTitle(meta.dispDmg, `${name || "Damage"} damage`, entity.damageParts);
			meta.dispDmg.classList.remove("ve-hidden");
		} else {
			meta.dispDmg.innerHTML = "";
			meta.dispDmg.classList.add("ve-hidden");
		}
	}
}

/** The play-and-build character sheet page (the current all-in-one sheet). */
class CharacterSheetPage extends CharacterPageBase {
	/* -------------------------------------------- DOM assembly -------------------------------------------- */

	_buildDom () {
		this._buildAbilities();
		this._buildSaves();
		this._buildSkills();
		this._buildDeathSaves();
		this._buildConditions();
	}

	_bindDom () {
		// Sheet-specific toolbar controls (the base binds save/load/print/reset + the switcher)
		this._bindClick("cs-btn-wizard", () => this._pOnWizard());
		this._bindClick("cs-attack-add", () => this._comp.addAttack());
		this._bindClick("cs-hp-damage", () => this._adjustHp(-1));
		this._bindClick("cs-hp-heal", () => this._adjustHp(1));
		this._bindClick("cs-short-rest", () => this._comp.shortRest());
		this._bindClick("cs-long-rest", () => this._comp.longRest());

		this._bindDataPickers();

		this._attacksCollection = new _AttacksRenderableCollection(this._comp, document.getElementById("cs-attacks-body"));
		this._comp._addHookBase("attacks", () => this._attacksCollection.render());

		// What a species and a background actually give you, ticked against what the character has
		this._originPanels = ["species", "background"].map(kind => new CharacterOriginPanel({
			comp: this._comp,
			wrp: document.getElementById(`cs-${kind}-panel`),
			kind,
			page: this,
		}));
		this._originPanels.forEach(panel => panel.init());

		this._classPanel = new CharacterClassPanel({comp: this._comp, wrp: document.getElementById("cs-class-panel")});
		this._classPanel.init();
		this._inventoryPanel = new CharacterInventoryPanel({comp: this._comp, wrp: document.getElementById("cs-inventory")});
		this._inventoryPanel.init();
		this._spellsPanel = new CharacterSpellsPanel({
			comp: this._comp,
			wrpSlots: document.getElementById("cs-spell-slots"),
			wrpKnown: document.getElementById("cs-spells-known"),
			wrpPanel: document.getElementById("cs-spell-panel"),
			wrpBody: document.getElementById("cs-spell-body"),
		});
		this._spellsPanel.init();
		this._actionsPanel = new CharacterActionsPanel({comp: this._comp, wrp: document.getElementById("cs-actions")});
		this._actionsPanel.init();
		// Built only when asked for: the deck needs the whole spell list loaded
		this._cardsPanel = new CharacterCardsPanel({comp: this._comp, wrp: document.getElementById("cs-cards")});
		this._journalPanel = new CharacterJournalPanel({comp: this._comp, wrp: document.getElementById("cs-journal")});
		this._journalPanel.init();
		this._bindClick("cs-btn-cards", () => this._cardsPanel.pPrint());

		this._comp._addHookBase("pickTags", () => this._renderPickLinks());
		this._comp._addHookBase("deathSuccess", () => this._renderDeathSaves());
		this._comp._addHookBase("deathFail", () => this._renderDeathSaves());
		this._comp._addHookBase("conditions", () => this._renderConditions());
		// AC is derived from equipped gear, so re-derive when the inventory (equip toggles) changes
		this._comp._addHookBase("inventory", () => this._renderDerived());
		// Some features add to derived stats (e.g. Rakish Audacity → initiative); reload on class changes
		this._comp._addHookBase("classes", () => this._pRefreshFeatureEffects());
		// Chosen feats/masteries feed AC, attack rows, and the combat notes
		["featureFeats", "originFeats", "manualFeats", "weaponMasteries"].forEach(prop => this._comp._addHookBase(prop, () => this._renderDerived()));
	}

	/** Load the character's feature names (async) so derived stats can include curated feature effects. */
	async _pRefreshFeatureEffects () {
		this._featureNames = await CharacterSheetClassData.pGetCharacterFeatureNames(this._comp._state.classes).catch(() => []);
		this._renderDerived();
	}

	_onStoreLoaded () {
		if (!this._comp._state.attacks.length) this._comp.addAttack();
	}

	_doRenderAll () {
		this._syncAllInputs();
		this._attacksCollection.render();
		this._renderPickLinks();
		this._renderDeathSaves();
		this._renderConditions();
		this._renderProficiencies();
		this._renderDefenses();
		this._renderAbilityOffers();
		this._pRefreshSpeciesData();
		this._renderDerived();
		this._pRefreshFeatureEffects();
		this._lastLevel = this._comp.getLevelNumber();
	}

	/* -------------------------------------------- Data pickers -------------------------------------------- */

	_bindDataPickers () {
		this._bindBuildPickers();
		this._bindClick("cs-attack-add-weapon", () => this._onPickWeapon());
		// The spell picker is bound by the spells panel
	}

	async _onPickWeapon () {
		const doc = await pGetUserItemSearchFiltered(this._comp._getState());
		if (!doc) return;
		const ent = await DataLoader.pCacheAndGet(doc.page, doc.source, doc.hash, {isCopy: true});
		this._comp.addAttack(getWeaponAttack(this._comp._getState(), {...getInventoryItemMeta(ent), name: doc.n}));
	}

	/* -------------------------------------------- Derived rendering -------------------------------------------- */

	_renderArmorClass (armorClass) {
		const eleComputed = document.getElementById("cs-ac-computed");
		if (!eleComputed) return;
		eleComputed.textContent = `${armorClass.ac}`;
		if (armorClass.note === "manual") {
			eleComputed.title = "Manual AC";
			CharacterPageBase.setBreakdownTitle(eleComputed, "Armor Class", null);
		} else {
			CharacterPageBase.setBreakdownTitle(eleComputed, "Armor Class", armorClass.parts, armorClass.ac,
				{isTotalValue: true, citeKind: "ac"});
		}
		// In manual mode the number is editable; otherwise it is computed from equipped gear.
		const isManual = (this._comp._state.acMode || "auto") === "manual";
		const eleManual = document.getElementById("cs-ac");
		if (eleManual) eleManual.classList.toggle("ve-hidden", !isManual);
		eleComputed.classList.toggle("ve-hidden", isManual);
	}

	/**
	 * What the character's build choices mean in play: the fighting-style/feature effects that are
	 * conditional or player-decided (the numeric ones are already folded into AC and the attack rows),
	 * and the weapon masteries they know, as hoverable rules links.
	 */
	_renderCombatNotes () {
		const ele = document.getElementById("cs-combat-notes");
		if (!ele) return;

		const state = this._comp._getState();
		const parts = [];

		const notes = getChosenFeatureEffects(state).notes;
		if (notes.length) {
			parts.push(`<div><span class="ve-muted">Style:</span> ${notes
				.map(n => `<span title="${n.desc.qq()}"><b>${n.name.qq()}</b> <span class="ve-muted">(${n.desc.qq()})</span></span>`)
				.join(`<span class="ve-muted"> &middot; </span>`)}</div>`);
		}

		const masteries = state.weaponMasteries || [];
		if (masteries.length) {
			// The mastery property a weapon confers is on the item; link each for its rules text.
			const byWeapon = masteries.map(name => {
				const item = (state.inventory || []).find(it => it.name === name);
				const props = (item?.mastery || []).map(m => Renderer.get().render(`{@itemMastery ${m}}`)).join(", ");
				return `<b>${name.qq()}</b>${props ? ` <span class="ve-muted">(${props})</span>` : ""}`;
			});
			parts.push(`<div><span class="ve-muted">Mastery:</span> ${byWeapon.join(`<span class="ve-muted"> &middot; </span>`)}</div>`);
		}

		// Every feat the character has taken, from any route, as hoverable links
		const feats = [
			...(state.originFeats || []).map(f => ({name: f.name, source: f.source})),
			...(state.featureFeats || []).map(f => ({name: f.name, source: f.source})),
			...(state.manualFeats || []).map(f => ({name: f.name, source: f.source})),
			...(state.classes || []).flatMap(c => (c.asiFeatChoices || []).filter(it => it.type === "feat")),
		];
		const seenFeats = new Set();
		const featLinks = feats
			.filter(f => f?.name && !seenFeats.has(f.name.toLowerCase()) && seenFeats.add(f.name.toLowerCase()))
			.map(f => Renderer.get().render(`{@feat ${f.name}${f.source && f.source !== Parser.SRC_PHB ? `|${f.source}` : ""}}`));
		if (featLinks.length) {
			parts.push(`<div><span class="ve-muted">Feats:</span> ${featLinks.join(`<span class="ve-muted"> &middot; </span>`)}</div>`);
		}

		ele.innerHTML = parts.join("");
	}

	_renderDerived () {
		const derived = deriveCharacterSheet(this._comp._getState());

		document.getElementById("cs-pb").textContent = CharacterPageBase.fmtBonus(derived.pb);

		this._renderAbilitiesSavesSkills(derived);
		this._renderExhaustionNote(derived);

		this._renderArmorClass(derived.armorClass);

		const eleUnarmed = document.getElementById("cs-unarmed");
		if (eleUnarmed) {
			const u = derived.unarmedStrike;
			const hitRoll = Renderer.get().render(`{@d20 ${u.atkBonus}|${CharacterPageBase.fmtBonus(u.atkBonus)}|Unarmed Strike}`);
			eleUnarmed.innerHTML = `<span class="ve-muted">Unarmed Strike:</span> ${hitRoll} <span class="ve-muted">to hit,</span> ${u.damage.qq()}`;
			CharacterPageBase.setBreakdownTitle(eleUnarmed, "Unarmed Strike", u.atkParts, u.atkBonus, {citeKind: "attack"});
		}

		this._renderCombatNotes();

		// Max HP is typed, so explain what the rules would give and flag a mismatch
		const eleHpMax = document.getElementById("cs-hp-max");
		if (eleHpMax && derived.hpExpected.parts.length) {
			const typed = Number(this._comp._state.hpMax) || 0;
			const exp = derived.hpExpected;
			const ptDiff = typed && typed !== exp.total ? ` \u2014 yours is ${typed}` : "";
			eleHpMax.title = `Expected Max HP: ${formatBreakdown(exp.parts, exp.total, {isTotalValue: true})}${ptDiff}`;
		}

		const abilMods = Object.fromEntries(CHAR_SHEET_ABILITIES.map(([abv]) => [abv, derived.abilities[abv].mod]));
		const initiative = derived.initiative + getFeatureInitiativeBonus(this._featureNames, {abilities: abilMods, pb: derived.pb});
		const eleInit = document.getElementById("cs-initiative-roll");
		eleInit.innerHTML = Renderer.get().render(`{@initiative ${initiative}|${CharacterPageBase.fmtBonus(initiative)}}`);
		// Feature-driven initiative (Rakish Audacity, Jack of All Trades) is added on top of the derived parts
		const initParts = [...derived.initiativeParts];
		const featureInit = initiative - derived.initiative;
		if (featureInit) initParts.push({label: "Features", value: featureInit});
		CharacterPageBase.setBreakdownTitle(eleInit, "Initiative", initParts, initiative, {citeKind: "initiative"});

		const eleDc = document.getElementById("cs-spell-dc");
		const eleAtk = document.getElementById("cs-spell-atk");
		if (derived.spell) {
			eleDc.textContent = `${derived.spell.dc}`;
			CharacterPageBase.setBreakdownTitle(eleDc, "Spell save DC", derived.spell.dcParts, derived.spell.dc, {isTotalValue: true, citeKind: "spellDc"});
			eleAtk.innerHTML = Renderer.get().render(`{@d20 ${derived.spell.atkMod}|${CharacterPageBase.fmtBonus(derived.spell.atkMod)}|Spell attack}`);
			CharacterPageBase.setBreakdownTitle(eleAtk, "Spell attack", derived.spell.atkParts, derived.spell.atkMod, {citeKind: "spellAttack"});
		} else {
			eleDc.textContent = "—";
			eleAtk.textContent = "—";
		}
		CharacterPageBase.setSpellBadgesVisible(!!derived.spell);
	}
}

window.addEventListener("load", () => {
	const page = new CharacterSheetPage();
	// Exposed so the browser tests can ask the page about itself (e.g. whether sync is connected)
	window.__csPage = page;
	page.pInit();
});
