import {CHAR_SHEET_ABILITIES, CHAR_SHEET_CONDITIONS, CHAR_SHEET_SKILLS, EXHAUSTION_MAX_LEVEL, PROF_STATE_PROFICIENT} from "./charactersheet-consts.js";
import {CharacterModel} from "./charactersheet-model.js";
import {getCharacterLabel, getMigratedStore, getNewStore} from "./charactersheet-charstore.js";
import {getLevelUpHp} from "./charactersheet-levelengine.js";
import {deriveCharacterSheet, formatBreakdown, getConcentrationSaveDc} from "./charactersheet-derive.js";
import {CharacterSheetClassData} from "./charactersheet-classdata.js";
import {CharacterWizard} from "./charactersheet-wizard.js";
import {CHOICE_TYPE_ABILITY, CHOICE_TYPE_LANGUAGE, CHOICE_TYPE_SKILL, CHOICE_TYPE_SKILL_TOOL_LANGUAGE, CHOICE_TYPE_TOOL, getAbilityChoices, getAbilityPackageDisplay, getChoiceSignature, getChoiceWithoutHeld, getFixedAbilityBonuses, getFixedProficiencyNames, getGrantedFeatCategories, getGrantedFeats, getHeldProficiencyNames, getPendingChoices, getResistChoices, mergeHeldProficiencyNames} from "./charactersheet-choices.js";
import {pPickAbilities, pPickList, pResolveEntitySpellGrants, pResolveFeat} from "./charactersheet-featgrant.js";
import {PROF_KIND_LANGUAGE, PROF_KIND_TOOL, PROF_KINDS, groupProficienciesByKind} from "./charactersheet-proficiencies.js";
import {DEFENSE_KINDS, DEFENSE_KIND_RESIST, DEFENSE_KIND_SENSE, getAllDefenses, groupDefensesByKind} from "./charactersheet-defenses.js";
import {getTraitChoiceResist, getTraitChoices} from "./charactersheet-traitchoices.js";
import {SOURCE_MODES, SOURCE_MODE_CUSTOM, getSourceFilterLabel, getSourceFilterPredicate, getOutOfFilterSources, isSourceAllowed, isSourceFilterInactive} from "./charactersheet-sources.js";
import {getBreakdownCitation, getPartCitations, isSameCitation, resolveCitation} from "./charactersheet-citations.js";
import {EV_DAMAGE, EV_DEATH_SAVE, EV_DOWN, EV_HEAL, EV_LEVEL} from "./charactersheet-journal.js";
import {PORTRAIT_MIME, PORTRAIT_QUALITY, getPortraitTargetSize, isPortraitTooLarge} from "./charactersheet-portrait.js";
import {getCharacterSummary, getSummaryLines} from "./charactersheet-summary.js";
import {getHpBonusPerLevel} from "./charactersheet-features.js";
import {getLevelUpPreview} from "./charactersheet-levelpreview.js";
import {deleteSyncMeta, getKeptBothName, getMissingAdapterMethods, getSyncBasePath, getSyncCapabilities, getSyncClientUrl, getSyncMeta, getSyncStatus, getUnsyncedRows, hasGmWriteSupport, hasSidekickControlSupport, isAdapterValid, isSameOrigin, isSyncConflict, planSync, setSyncMeta} from "./charactersheet-sync.js";

/**
 * Shared foundation for the two character pages (the play-focused sheet and the build-focused
 * builder). Owns the character model, the multi-character store + switcher, autosave/persistence,
 * file save/load, and the (null-safe) input-binding helpers. Page-specific DOM assembly and
 * rendering are provided by subclasses via the `_buildDom`/`_bindDom`/`_doRenderAll` hooks.
 *
 * Element wiring is null-safe: each page includes only the fields it needs, and the base skips
 * anything absent — so the two pages can have entirely independent layouts.
 */
export class CharacterPageBase {
	// Page-agnostic so both pages share one set of characters; migrated from the old per-page key.
	static _SHARED_STORAGE_KEY = "charactersheet-characters";
	static _LEGACY_STORAGE_KEY = "charactersheet-state";
	static _FILE_TYPE = "charactersheet";

	// Bindings shared by both pages; null-safe binding skips any element a given page omits.
	static _IPT_STR_BINDINGS = [
		["cs-name", "name"],
		["cs-ac-mode", "acMode"],
		["cs-hp-policy", "hpPolicy"],
		["cs-concentration", "concentration"],
		["cs-classlevel", "classText"],
		["cs-background", "backgroundText"],
		["cs-playername", "playerName"],
		["cs-species", "speciesText"],
		["cs-alignment", "alignment"],
		["cs-speed", "speed"],
		["cs-hd-total", "hdTotal"],
		["cs-hd-cur", "hdCur"],
		["cs-spell-ability", "spellAbility"],
		["cs-spells", "spellsText"],
		["cs-features", "featuresText"],
		["cs-equipment", "equipmentText"],
		["cs-proficiencies", "proficienciesText"],
		["cs-personality", "personalityText"],
	];

	static _IPT_NUM_BINDINGS = [
		["cs-xp", "xp"],
		["cs-level", "level"],
		["cs-ac", "ac"],
		["cs-init-misc", "initMisc"],
		["cs-hp-max", "hpMax"],
		["cs-hp-cur", "hpCur"],
		["cs-hp-temp", "hpTemp"],
		["cs-exhaustion", "exhaustion"],
		["cs-cp", "cp"],
		["cs-sp", "sp"],
		["cs-ep", "ep"],
		["cs-gp", "gp"],
		["cs-pp", "pp"],
	];

	constructor () {
		this._comp = new CharacterModel();
		this._isLoading = false;
		this._lastDeathSaves = {deathSuccess: 0, deathFail: 0};
		this._saveTimer = null;
		this._store = null; // {storeVersion, currentId, characters: {id: envelope}, syncMeta, syncAuto}

		// Characters edited since their last upload, and the timers that will send them
		this._syncPending = new Set();
		this._isSyncFlushing = false;
		this._syncDebounce = null;
		this._syncMaxWait = null;
		this._fnsSyncInput = []; // unconditional input-sync functions, for bulk state loads
		this._lastLevel = 1;
		this._suppressLevelPrompt = 0;
		this._traitChoiceDefs = []; // the picked species' "choose one" traits
		this._traitChoiceSource = null;
	}

	static fmtBonus (n) { return `${n >= 0 ? "+" : "−"}${Math.abs(n)}`; }

	/** Breakdown parts, keyed by the element showing them; see `setBreakdownTitle`. */
	static _BREAKDOWN_PARTS = new WeakMap();
	/** Where the page stood when the breakdown popover opened; see `_bindBreakdownPopovers`. */
	static _breakdownScrollY = 0;

	/* -------------------------------------------- Lifecycle -------------------------------------------- */

	/**
	 * Load homebrew (and prerelease content, and the exclusion list) before the page builds itself.
	 *
	 * `charactersheet-classdata.js` has always asked the `DataLoader` for brew alongside site content,
	 * and `SearchWidget` indexes brew for the species/background/item pickers — but none of it can
	 * return anything until `BrewUtil2.pInit()` has run, and nothing on these three pages ever ran it.
	 * So the builder appeared to ignore homebrew entirely when in fact it was only ever missing this.
	 *
	 * A brew that fails to load must not take the sheet down with it: a character is more important
	 * than the content it could have picked from, so a failure is reported and the page carries on.
	 */
	async pInit () {
		try {
			await Promise.all([PrereleaseUtil.pInit(), BrewUtil2.pInit()]);
			await ExcludeUtil.pInitialise();
		} catch (e) {
			JqueryUtil.doToast({type: "danger", content: `Homebrew could not be loaded${e?.message ? `: ${e.message}` : ""}. The rest of the sheet still works.`});
		}
		await this._pLoadSyncAdapter();
		this.init();
		// After `init`, so the badge lands on an assembled toolbar whichever way the load went
		this._renderSyncBadge();
	}

	/**
	 * Look for an account system on the configured path and, if one answers, keep its adapter.
	 *
	 * Everything about this is optional. No account app deployed, a 404, a script that throws, an
	 * adapter missing half its methods — each leaves `_syncAdapter` null and the pages exactly as
	 * they are without it. That is the supported static deployment, not a degraded one.
	 *
	 * See `charactersheet-sync.js` for the contract; the implementation lives in its own repository.
	 */
	async _pLoadSyncAdapter () {
		this._syncAdapter = null;
		this._syncStatus = getSyncStatus({});

		const basePath = getSyncBasePath();
		const url = getSyncClientUrl(basePath);
		if (!url) return;

		try {
			await new Promise((resolve, reject) => {
				const script = document.createElement("script");
				script.src = url;
				script.async = true;
				script.onload = resolve;
				// Nothing deployed there is the ordinary case, so this is not worth a toast
				script.onerror = () => reject(new Error("no account system is deployed there"));
				document.head.appendChild(script);
			});
		} catch (e) {
			return;
		}

		const adapter = window.CharacterSyncAdapter;
		if (!adapter) return;

		if (!isAdapterValid(adapter)) {
			// Half an adapter would take over storage and then fail partway, which is worse than none
			this._syncStatus = getSyncStatus({basePath, isLoaded: true, missingMethods: getMissingAdapterMethods(adapter)});
			return;
		}

		if (!isSameOrigin(basePath)) {
			JqueryUtil.doToast({type: "warning", content: `The account system is on another origin (${basePath}), so the session cookie may not be sent.`});
		}

		this._syncAdapter = adapter;
		this._syncBasePath = basePath;
		await this._pRefreshSyncStatus();
		this._bindSyncFlushOnLeave();
	}

	/**
	 * Send what is waiting when the page is being left, rather than four seconds later.
	 *
	 * `visibilitychange` is the one that actually fires when a phone is locked or a tab is switched
	 * away from; `pagehide` covers the tab closing. Neither can be awaited, so this is best effort —
	 * which is why the queue survives in the store either way.
	 */
	_bindSyncFlushOnLeave () {
		const flush = () => { if (document.visibilityState === "hidden") this._pFlushSyncQueue(); };
		document.addEventListener("visibilitychange", flush);
		window.addEventListener("pagehide", () => this._pFlushSyncQueue());
	}

	/**
	 * Ask the account system who we are, and work out what to show.
	 *
	 * A failure here is a connection problem, not a page problem: it becomes the badge's text, so it
	 * can be read on purpose rather than found in the console.
	 */
	async _pRefreshSyncStatus () {
		const basePath = this._syncBasePath;
		const adapter = this._syncAdapter;
		if (!adapter) return;

		let user = null;
		let error = null;
		try {
			user = await adapter.pWhoAmI();
		} catch (e) {
			error = e;
		}

		this._syncStatus = getSyncStatus({
			basePath,
			isLoaded: true,
			user,
			error,
			capabilities: getSyncCapabilities(adapter),
			pending: this._syncPending.size,
			isSaving: this._isSyncFlushing,
		});
		this._renderSyncBadge();
	}

	/* -------------------------------------------- Automatic push -------------------------------------------- */

	/**
	 * Characters already online follow you without being told to.
	 *
	 * Manual push is a good safety net and a poor default: play a session on the laptop, never open
	 * the panel, and the phone has last week's character. So an edit to a character the server
	 * already knows about schedules an upload, debounced so that typing a name is one save rather
	 * than nine.
	 *
	 * Two deliberate limits:
	 *
	 *  - **Only characters already online.** Signing in must never silently upload everything in a
	 *    browser; the first upload stays an explicit act.
	 *  - **Push only.** Pulling over what is on screen is always a decision, never a background one.
	 */
	static _SYNC_DEBOUNCE_MS = 4000;
	static _SYNC_MAX_WAIT_MS = 30000;

	get _isAutoPushOn () { return this._store?.syncAuto !== false; }

	_isAutoPushEligible (id) {
		return this._isAutoPushOn
			&& !this._isLoading
			&& !!this._syncAdapter
			&& this._syncStatus?.kind === "signedIn"
			&& getSyncCapabilities(this._syncAdapter).characters
			// Never a character the server has not seen: that upload is the person's to make
			&& !!getSyncMeta(this._store, id);
	}

	_queueSyncPush (id) {
		if (!id || !this._isAutoPushEligible(id)) return;

		this._syncPending.add(id);
		this._renderSyncBadge();

		if (this._syncDebounce) clearTimeout(this._syncDebounce);
		this._syncDebounce = setTimeout(() => this._pFlushSyncQueue(), CharacterPageBase._SYNC_DEBOUNCE_MS);

		// A long editing session would otherwise keep pushing the debounce out and never save at all
		if (!this._syncMaxWait) {
			this._syncMaxWait = setTimeout(() => this._pFlushSyncQueue(), CharacterPageBase._SYNC_MAX_WAIT_MS);
		}
	}

	_clearSyncTimers () {
		if (this._syncDebounce) clearTimeout(this._syncDebounce);
		if (this._syncMaxWait) clearTimeout(this._syncMaxWait);
		this._syncDebounce = null;
		this._syncMaxWait = null;
	}

	/**
	 * Send everything waiting, one character at a time.
	 *
	 * Serial on purpose: a conflict opens a modal, and two of those at once would be unusable. A
	 * failure leaves the character queued rather than dropping it — being offline for a minute must
	 * not cost the session.
	 */
	async _pFlushSyncQueue () {
		this._clearSyncTimers();
		if (this._isSyncFlushing || !this._syncPending.size) return;

		this._isSyncFlushing = true;
		this._renderSyncBadge();
		try {
			for (const id of [...this._syncPending]) {
				if (!this._isAutoPushEligible(id)) { this._syncPending.delete(id); continue; }
				await this._pPushCharacter(id, {isQuiet: true});
			}
		} finally {
			this._isSyncFlushing = false;
			this._renderSyncBadge();
			// Anything that failed is still queued; try again after the ordinary quiet period
			if (this._syncPending.size) this._syncDebounce = setTimeout(() => this._pFlushSyncQueue(), CharacterPageBase._SYNC_DEBOUNCE_MS);
		}
	}

	/**
	 * A badge in the toolbar saying whether the account system is there, and who it thinks you are.
	 *
	 * Built here rather than in the three page templates so the pages cannot drift, and so that
	 * adding it needs no change to generated HTML. Nothing is rendered when there is no account
	 * system: that is this repo's ordinary state, not a fault to report.
	 */
	_renderSyncBadge () {
		// Re-derive the label from the same facts, so "Unsaved (2)" needs no round trip to appear
		if (this._syncStatus?.kind === "signedIn") {
			this._syncStatus = {...this._syncStatus, ...this._getWorkLabel()};
		}
		const status = this._syncStatus;
		const toolbar = document.querySelector(".cs__toolbar");
		if (!toolbar) return;

		let btn = document.getElementById("cs-sync-badge");
		if (status?.kind === "off" || !status) {
			btn?.remove();
			return;
		}

		if (!btn) {
			btn = document.createElement("button");
			btn.id = "cs-sync-badge";
			btn.type = "button";
			btn.className = "cs__sync-badge no-print";
			btn.addEventListener("click", () => this._doShowSyncDetail());
			// Before whatever is pushed to the right-hand end, so the badge sits with the buttons
			const rhs = toolbar.querySelector(".ve-ml-auto");
			if (rhs) toolbar.insertBefore(btn, rhs);
			else toolbar.appendChild(btn);
		}

		btn.className = `cs__sync-badge cs__sync-badge--${status.tone} no-print`;
		btn.title = `${status.title} — click for details`;
		btn.innerHTML = `<span class="cs__sync-dot"></span>${status.label.qq()}`;
	}

	/** The whole truth about the connection, including whatever went wrong — and the push/pull panel. */
	_doShowSyncDetail () {
		const status = this._syncStatus;
		if (!status) return;

		const {eleModalInner, doClose} = UiUtil.getShowModal({title: status.title, isMinHeight0: true});

		const rows = status.lines
			.map(({label, value}) => `<div class="ve-flex ve-mb-1"><span class="bold" style="min-width: 9em; flex-shrink: 0;">${label.qq()}</span><span>${String(value).qq()}</span></div>`)
			.join("");
		eleModalInner.insertAdjacentHTML("beforeend", `<div class="ve-mb-2">${rows}</div>`);

		if (status.canSignIn && typeof this._syncAdapter?.getLoginUrl === "function") {
			eleModalInner.insertAdjacentHTML("beforeend", `<a class="ve-btn ve-btn-primary ve-btn-sm ve-self-flex-start" href="${this._syncAdapter.getLoginUrl().qq()}">Sign in</a>`);
		}

		if (status.kind === "signedIn" && getSyncCapabilities(this._syncAdapter).characters) {
			eleModalInner.appendChild(this._getAutoPushToggle());

			const wrpChars = document.createElement("div");
			wrpChars.className = "ve-flex-col ve-mb-2";
			eleModalInner.appendChild(wrpChars);
			this._pRenderSyncCharacters(wrpChars);

			if (getSyncCapabilities(this._syncAdapter).campaigns) {
				const wrpTables = document.createElement("div");
				wrpTables.className = "ve-flex-col ve-mb-2";
				eleModalInner.appendChild(wrpTables);
				this._pRenderTables(wrpTables);
			}
		}

		if (status.canSignOut && typeof this._syncAdapter?.getLogoutUrl === "function") {
			const btn = document.createElement("button");
			btn.className = "ve-btn ve-btn-default ve-btn-sm ve-self-flex-start";
			btn.type = "button";
			btn.textContent = "Sign out";
			btn.addEventListener("click", async () => {
				await fetch(this._syncAdapter.getLogoutUrl(), {method: "POST", credentials: "same-origin"}).catch(() => {});
				doClose();
				await this._pRefreshSyncStatus();
			});
			eleModalInner.appendChild(btn);
		}
	}

	/** Automatic uploads are something this page does on your behalf, so they can be switched off. */
	_getAutoPushToggle () {
		const wrp = document.createElement("label");
		wrp.className = "ve-flex-v-center ve-mb-2";

		const cb = document.createElement("input");
		cb.type = "checkbox";
		cb.className = "ve-mr-1";
		cb.checked = this._isAutoPushOn;
		cb.addEventListener("change", () => {
			this._store.syncAuto = cb.checked;
			this._persistNow();
			if (cb.checked) this._pFlushSyncQueue();
			else this._clearSyncTimers();
			this._renderSyncBadge();
		});

		wrp.appendChild(cb);
		wrp.insertAdjacentHTML("beforeend", `<span>Save changes online automatically <span class="ve-muted ve-small">(characters already online; downloads always stay manual)</span></span>`);
		return wrp;
	}

	/* -------------------------------------------- Push and pull -------------------------------------------- */

	/**
	 * Both directions, by hand.
	 *
	 * Nothing uploads or downloads on its own. Working out which side is "newer" would mean trusting
	 * clocks across two devices and a server, and being wrong once means overwriting somebody's
	 * evening — so the page shows what is where and a person chooses. That is also why there is no
	 * merge: a character is one document, and the only honest options are mine, theirs, or both.
	 */
	async _pRenderSyncCharacters (wrp) {
		wrp.innerHTML = `<div class="ve-muted ve-small">Loading…</div>`;

		let remote;
		try {
			remote = await this._syncAdapter.pList();
		} catch (e) {
			wrp.innerHTML = `<div class="ve-muted ve-small">Could not list your online characters: ${(e?.message || String(e)).qq()}</div>`;
			return;
		}

		// The current character is only written to the store on persist, so read it live
		this._persistNow();
		const rows = planSync({
			localCharacters: this._store.characters,
			remote,
			syncMeta: this._store.syncMeta,
			fnLabel: envelope => getCharacterLabel(envelope),
		});

		wrp.innerHTML = "";
		wrp.insertAdjacentHTML("beforeend", `<div class="bold ve-mb-1">Characters</div>`);

		const unsynced = getUnsyncedRows(rows);
		if (unsynced.length) {
			const btnAll = document.createElement("button");
			btnAll.className = "ve-btn ve-btn-primary ve-btn-xs ve-self-flex-start ve-mb-2";
			btnAll.type = "button";
			btnAll.textContent = `Upload ${unsynced.length} character${unsynced.length === 1 ? "" : "s"} not yet online`;
			btnAll.addEventListener("click", async () => {
				for (const row of unsynced) await this._pPushCharacter(row.id);
				this._pRenderSyncCharacters(wrp);
			});
			wrp.appendChild(btnAll);
		}

		rows.forEach(row => wrp.appendChild(this._getSyncRow(row, wrp)));

		if (!rows.length) wrp.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-small">Nothing here or online yet.</div>`);
	}

	_getSyncRow (row, wrp) {
		const ele = document.createElement("div");
		ele.className = "ve-flex-v-center ve-mb-1";

		const WHERE = {
			both: {text: "in both", tone: "ve-muted"},
			local: {text: "this browser only", tone: "ve-muted"},
			online: {text: "online only", tone: "ve-muted"},
		}[row.where];

		// A sidekick the table was handed: theirs to play, and not theirs to give away
		const shared = row.isMine === false ? `<span class="ve-muted ve-small ve-ml-1">· shared with you</span>` : "";

		ele.insertAdjacentHTML("beforeend",
			`<span style="flex: 1; min-width: 0;"><span class="bold">${row.name.qq()}</span>`
			+ `<span class="${WHERE.tone} ve-small ve-ml-1">${WHERE.text}</span>${shared}</span>`);

		const addBtn = (text, title, fn) => {
			const btn = document.createElement("button");
			btn.className = "ve-btn ve-btn-default ve-btn-xs ve-ml-1";
			btn.type = "button";
			btn.textContent = text;
			btn.title = title;
			btn.addEventListener("click", async () => {
				btn.disabled = true;
				try { await fn(); } finally { this._pRenderSyncCharacters(wrp); }
			});
			ele.appendChild(btn);
		};

		if (row.where !== "online") addBtn("Push", "Upload this browser's copy", () => this._pPushCharacter(row.id));
		if (row.where !== "local") addBtn("Pull", "Download the online copy into this browser", () => this._pPullCharacter(row.id));
		if (row.where === "both" && getSyncCapabilities(this._syncAdapter).history) {
			addBtn("History", "Earlier saved versions of this character", () => this._pShowHistory(row.id, row.name));
		}
		if (row.where === "both" && row.isMine !== false && getSyncCapabilities(this._syncAdapter).sharing) {
			addBtn("Share", "A read-only link you can send to a DM", () => this._pShowShare(row.id, row.name));
		}

		return ele;
	}

	/* -------------------------------------------- Sharing -------------------------------------------- */

	/**
	 * A read-only link to this character, for somebody who is not at the table.
	 *
	 * The campaign rules already cover a GM you play with; this is the other case — a person with no
	 * account, or one you simply want to send a sheet to. It is the owner's to hand out and the
	 * owner's to take back, which is the difference between a share and a copy, so revoking is given
	 * the same weight as creating.
	 */
	async _pShowShare (id, name) {
		const {eleModalInner} = UiUtil.getShowModal({title: `Share — ${name}`, isMinHeight0: true});
		const render = async () => {
			eleModalInner.innerHTML = `<div class="ve-muted ve-small">Loading…</div>`;

			let share;
			try {
				({share} = await this._syncAdapter.pGetShare(id));
			} catch (e) {
				eleModalInner.innerHTML = `<div class="ve-muted ve-small">Could not check for a link: ${(e?.message || String(e)).qq()}</div>`;
				return;
			}

			eleModalInner.innerHTML = share
				? `<div class="ve-mb-2">Anybody with this link can read <b>${name.qq()}</b>. They cannot change it, and they do not need an account.</div>
					<input type="text" class="ve-form-control ve-mb-2" readonly value="${share.url.qq()}" aria-label="Share link">
					${share.expiresAt ? `<div class="ve-muted ve-small ve-mb-2">Expires ${new Date(share.expiresAt).toLocaleString().qq()}.</div>` : ""}`
				: `<div class="ve-mb-2">This character is not shared. Creating a link lets anybody who has it read the sheet — without an account, and without seeing your session journal.</div>`;

			const wrpBtns = document.createElement("div");
			wrpBtns.className = "ve-flex";
			eleModalInner.appendChild(wrpBtns);

			const addBtn = (text, cls, pFn) => {
				const btn = document.createElement("button");
				btn.className = `ve-btn ${cls} ve-btn-xs ve-mr-1`;
				btn.type = "button";
				btn.textContent = text;
				btn.addEventListener("click", async () => {
					try {
						await pFn();
					} catch (e) {
						JqueryUtil.doToast({type: "danger", content: `${e?.message || e}`});
					}
					render();
				});
				wrpBtns.appendChild(btn);
			};

			if (share) {
				addBtn("Copy", "ve-btn-primary", async () => {
					await navigator.clipboard?.writeText(share.url);
					JqueryUtil.doToast({type: "success", content: "Link copied."});
				});
				// Taking it back is as prominent as handing it out, on purpose
				addBtn("Stop sharing", "ve-btn-danger", () => this._syncAdapter.pRevokeShare(id));
			} else {
				addBtn("Create a link", "ve-btn-primary", () => this._syncAdapter.pCreateShare(id, {}));
			}
		};

		render();
	}

	/* -------------------------------------------- History -------------------------------------------- */

	/**
	 * What this character looked like before.
	 *
	 * The list is timestamps, because that is all the server can honestly label a snapshot with —
	 * it does not read inside an envelope. Picking one fetches it and shows what it *was*, computed
	 * here from the same rules the sheet uses, so a restore is a decision made after looking rather
	 * than a guess at a date.
	 */
	async _pShowHistory (id, name) {
		const {eleModalInner} = UiUtil.getShowModal({title: `History — ${name}`, isMinHeight0: true});
		eleModalInner.innerHTML = `<div class="ve-muted ve-small">Loading…</div>`;

		let listing;
		try {
			listing = await this._syncAdapter.pListVersions(id);
		} catch (e) {
			eleModalInner.innerHTML = `<div class="ve-muted ve-small">Could not load the history: ${(e?.message || String(e)).qq()}</div>`;
			return;
		}

		eleModalInner.innerHTML = "";
		if (!listing.versions?.length) {
			eleModalInner.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-small">Nothing saved online yet.</div>`);
			return;
		}

		const wrpPreview = document.createElement("div");
		wrpPreview.className = "ve-muted ve-small ve-mt-2";

		listing.versions.forEach(entry => {
			const line = document.createElement("div");
			line.className = "ve-flex-v-center ve-mb-1";
			const when = new Date(entry.createdAt).toLocaleString();
			const tagCurrent = entry.version === listing.current ? ` <span class="ve-muted ve-small">current</span>` : "";
			// Named only when somebody else saved it — a lent character's history is where the
			// player sees what their GM did, and their own saves need no attribution
			const tagBy = entry.by ? ` <span class="ve-muted ve-small">saved by ${entry.by.qq()}</span>` : "";
			line.insertAdjacentHTML("beforeend", `<span style="flex: 1; min-width: 0;">${when.qq()}${tagBy}${tagCurrent}</span>`);

			const btnLook = document.createElement("button");
			btnLook.className = "ve-btn ve-btn-default ve-btn-xs ve-ml-1";
			btnLook.type = "button";
			btnLook.textContent = "Look";
			btnLook.addEventListener("click", () => this._pPreviewVersion(id, entry.version, wrpPreview));
			line.appendChild(btnLook);

			if (entry.version !== listing.current) {
				const btnRestore = document.createElement("button");
				btnRestore.className = "ve-btn ve-btn-default ve-btn-xs ve-ml-1";
				btnRestore.type = "button";
				btnRestore.textContent = "Restore";
				btnRestore.addEventListener("click", () => this._pRestoreVersion(id, entry.version, when));
				line.appendChild(btnRestore);
			}

			eleModalInner.appendChild(line);
		});

		eleModalInner.appendChild(wrpPreview);
	}

	async _pPreviewVersion (id, version, wrp) {
		wrp.textContent = "Loading…";
		try {
			const {envelope} = await this._syncAdapter.pLoadVersion(id, version);
			const summary = getCharacterSummary(envelope?.state || {});
			wrp.innerHTML = getSummaryLines(summary)
				.slice(0, 8)
				.map(({label, value}) => `<div class="ve-flex"><span class="bold" style="min-width: 11em; flex-shrink: 0;">${label.qq()}</span><span>${String(value).qq()}</span></div>`)
				.join("");
		} catch (e) {
			wrp.textContent = `Could not open that version: ${e?.message || e}`;
		}
	}

	/**
	 * Restoring writes the old contents *forward*, so it is itself undoable — and then the browser
	 * pulls, because the point of restoring is to be looking at the restored character.
	 */
	async _pRestoreVersion (id, version, when) {
		if (!await InputUiUtil.pGetUserBoolean({
			title: "Restore",
			htmlDescription: `<div>Go back to the version saved <b>${when.qq()}</b>?<br>The current version is kept in the history, so this can be undone.</div>`,
			textYes: "Restore",
			textNo: "Cancel",
		})) return;

		try {
			await this._syncAdapter.pRestoreVersion(id, version);
			await this._pPullCharacter(id);
		} catch (e) {
			JqueryUtil.doToast({type: "danger", content: `Could not restore: ${e?.message || e}`});
		}
	}

	/* -------------------------------------------- Tables -------------------------------------------- */

	/**
	 * Campaigns, from the player's side and the GM's.
	 *
	 * A table is where a GM can see the party's characters — read-only, always. The current
	 * character's table is a plain dropdown here rather than a field on the sheet, because which
	 * table a character sits at is an account-system fact, not part of the character.
	 */
	async _pRenderTables (wrp) {
		wrp.innerHTML = `<div class="bold ve-mb-1">Tables</div><div class="ve-muted ve-small">Loading…</div>`;

		let campaigns;
		try {
			campaigns = await this._syncAdapter.pListCampaigns();
		} catch (e) {
			wrp.innerHTML = `<div class="bold ve-mb-1">Tables</div><div class="ve-muted ve-small">Could not list your tables: ${(e?.message || String(e)).qq()}</div>`;
			return;
		}

		// The server's own view of this character — who owns it, and whether its table may play it.
		// Asked for fresh rather than remembered locally, because somebody else may have changed it
		let entry = null;
		try {
			entry = (await this._syncAdapter.pList()).find(it => it.id === this._store.currentId) || null;
		} catch (e) {
			entry = null;
		}

		wrp.innerHTML = `<div class="bold ve-mb-1">Tables</div>`;
		wrp.appendChild(this._getCurrentTablePicker(campaigns, wrp, entry));

		const eleControl = this._getSidekickControlRow(entry, wrp) || this._getGmWriteRow(entry, wrp);
		if (eleControl) wrp.appendChild(eleControl);

		campaigns.forEach(campaign => wrp.appendChild(this._getTableRow(campaign, wrp)));
		if (!campaigns.length) wrp.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-small ve-mb-1">You are not at any table yet.</div>`);

		const wrpBtns = document.createElement("div");
		wrpBtns.className = "ve-flex ve-mt-1";
		wrpBtns.appendChild(this._getTableActionBtn("New table", async () => {
			const name = await InputUiUtil.pGetUserString({title: "Name the table"});
			if (name?.trim()) await this._syncAdapter.pCreateCampaign(name.trim());
		}, wrp));
		wrpBtns.appendChild(this._getTableActionBtn("Join with a code", async () => {
			const code = await InputUiUtil.pGetUserString({title: "Paste the invite code"});
			if (code?.trim()) await this._syncAdapter.pJoinCampaign(code.trim());
		}, wrp));
		wrp.appendChild(wrpBtns);
	}

	_getTableActionBtn (text, pFn, wrp) {
		const btn = document.createElement("button");
		btn.className = "ve-btn ve-btn-default ve-btn-xs ve-mr-1";
		btn.type = "button";
		btn.textContent = text;
		btn.addEventListener("click", async () => {
			try {
				await pFn();
			} catch (e) {
				JqueryUtil.doToast({type: "danger", content: `${e?.message || e}`});
			}
			this._pRenderTables(wrp);
		});
		return btn;
	}

	/**
	 * Which table the character being edited belongs to — the owner's decision, and only theirs.
	 *
	 * The server's own answer wins over what this browser remembers doing: a character pulled onto a
	 * second device was put at its table somewhere else, and the local note knows nothing about it.
	 */
	_getCurrentTablePicker (campaigns, wrp, entry) {
		const id = this._store.currentId;
		const ele = document.createElement("label");
		ele.className = "ve-flex-v-center ve-mb-2";
		ele.insertAdjacentHTML("beforeend", `<span class="ve-mr-1">This character's table</span>`);

		const sel = document.createElement("select");
		sel.className = "ve-form-control ve-input-xs";
		sel.style.width = "auto";
		sel.innerHTML = [`<option value="">(no table)</option>`, ...campaigns.map(c => `<option value="${c.id.qq()}">${c.name.qq()}</option>`)].join("");
		sel.value = entry?.campaignId || getSyncMeta(this._store, id)?.campaignId || "";

		if (!getSyncMeta(this._store, id)) {
			sel.disabled = true;
			sel.title = "Upload this character first";
		}

		sel.addEventListener("change", async () => {
			try {
				await this._syncAdapter.pSetCharacterCampaign(id, sel.value || null);
				setSyncMeta(this._store, id, {...getSyncMeta(this._store, id), campaignId: sel.value || null});
				this._persistNow();
			} catch (e) {
				JqueryUtil.doToast({type: "danger", content: `Could not move this character: ${e?.message || e}`});
			}
			this._pRenderTables(wrp);
		});

		ele.appendChild(sel);
		return ele;
	}

	/**
	 * Handing a sidekick to its table, which is the one thing at a table that is not read-only.
	 *
	 * A GM builds a sidekick and the players usually command it, the GM taking it over only for
	 * narrative moments — so a shared sidekick is one record everybody at the table writes, rather
	 * than a copy each. Only for a sidekick, only once it is at a table, and only for whoever owns
	 * it: for everybody else this is a line saying where it came from.
	 *
	 * @return {HTMLElement|null} null when there is nothing to say, which is the usual case.
	 */
	_getSidekickControlRow (entry, wrp) {
		if (!entry?.isSidekick || !hasSidekickControlSupport(this._syncAdapter)) return null;

		const ele = document.createElement("div");
		ele.className = "ve-mb-2";

		// Somebody else's, handed to a table we are at: it is ours to play and not ours to give away
		if (entry.isMine === false) {
			ele.className = "ve-muted ve-small ve-mb-2";
			ele.textContent = "Shared with you by this table — anything you record here is what everybody sees.";
			return ele;
		}

		if (!this._getCurrentCampaignId(entry)) {
			ele.className = "ve-muted ve-small ve-mb-2";
			ele.textContent = "Put this sidekick at a table to let the players run it.";
			return ele;
		}

		const label = document.createElement("label");
		label.className = "ve-flex-v-center";

		const cb = document.createElement("input");
		cb.type = "checkbox";
		cb.className = "ve-mr-1";
		cb.checked = entry.control === "campaign";

		cb.addEventListener("change", async () => {
			try {
				await this._syncAdapter.pSetCharacterControl(this._store.currentId, cb.checked ? "campaign" : "owner");
			} catch (e) {
				JqueryUtil.doToast({type: "danger", content: `Could not change who may play this: ${e?.message || e}`});
			}
			this._pRenderTables(wrp);
		});

		label.appendChild(cb);
		label.insertAdjacentHTML("beforeend", `<span>Let the table play this sidekick</span>`);
		ele.appendChild(label);
		ele.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-small">Everybody at the table can then run it, on this one copy. You keep it either way.</div>`);
		return ele;
	}

	/**
	 * The loan a player gives their GM: permission to edit this character.
	 *
	 * It exists because handing out loot, taking something away and fixing a mistake mid-session are
	 * real, and doing them by dictation is tedious. It is off by default, either end can set it, and
	 * either end can end it — so the player's own copy of the switch lives here. What makes it
	 * bearable is the trail: every edit the GM makes is named in this character's history.
	 *
	 * @return {HTMLElement|null} null when there is nothing to offer, which is the usual case.
	 */
	_getGmWriteRow (entry, wrp) {
		if (!entry || entry.isSidekick || entry.isMine === false) return null;
		if (!hasGmWriteSupport(this._syncAdapter) || !this._getCurrentCampaignId(entry)) return null;

		const ele = document.createElement("div");
		ele.className = "ve-mb-2";

		const label = document.createElement("label");
		label.className = "ve-flex-v-center";

		const cb = document.createElement("input");
		cb.type = "checkbox";
		cb.className = "ve-mr-1";
		cb.checked = !!entry.isGmWrite;

		cb.addEventListener("change", async () => {
			try {
				await this._syncAdapter.pSetCharacterGmWrite(this._store.currentId, cb.checked);
			} catch (e) {
				JqueryUtil.doToast({type: "danger", content: `Could not change who may edit this: ${e?.message || e}`});
			}
			this._pRenderTables(wrp);
		});

		label.appendChild(cb);
		label.insertAdjacentHTML("beforeend", `<span>Let this table's DM edit this character</span>`);
		ele.appendChild(label);
		ele.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-small">For handing out loot and fixing mistakes. Their edits are named in this character's history, and you can switch this off again.</div>`);
		return ele;
	}

	/** What the server says, falling back to what this browser did — see `_getCurrentTablePicker`. */
	_getCurrentCampaignId (entry) {
		return entry?.campaignId || getSyncMeta(this._store, this._store.currentId)?.campaignId || null;
	}

	_getTableRow (campaign, wrp) {
		const ele = document.createElement("div");
		ele.className = "ve-flex-v-center ve-mb-1";
		ele.insertAdjacentHTML("beforeend",
			`<span style="flex: 1; min-width: 0;"><span class="bold">${campaign.name.qq()}</span>`
			+ `<span class="ve-muted ve-small ve-ml-1">${campaign.role.qq()}</span></span>`);

		const addBtn = (text, pFn) => {
			const btn = document.createElement("button");
			btn.className = "ve-btn ve-btn-default ve-btn-xs ve-ml-1";
			btn.type = "button";
			btn.textContent = text;
			btn.addEventListener("click", () => pFn().catch(e => JqueryUtil.doToast({type: "danger", content: `${e?.message || e}`})));
			ele.appendChild(btn);
		};

		addBtn("Characters", () => this._pShowTableCharacters(campaign));
		// Only a GM can invite, so only a GM is offered it
		if (campaign.role === "gm") {
			addBtn("Invite", async () => {
				const invite = await this._syncAdapter.pCreateInvite(campaign.id, {role: "player"});
				await InputUiUtil.pGetUserString({title: `Invite code for ${campaign.name}`, default: invite.code, autocomplete: "off"});
				this._pRenderTables(wrp);
			});
		}

		return ele;
	}

	async _pShowTableCharacters (campaign) {
		const {eleModalInner} = UiUtil.getShowModal({title: campaign.name, isMinHeight0: true});
		eleModalInner.innerHTML = `<div class="ve-muted ve-small">Loading…</div>`;

		let rows;
		try {
			rows = await this._syncAdapter.pListCampaignCharacters(campaign.id);
		} catch (e) {
			eleModalInner.innerHTML = `<div class="ve-muted ve-small">Could not list the party: ${(e?.message || String(e)).qq()}</div>`;
			return;
		}

		eleModalInner.innerHTML = "";
		if (!rows.length) {
			eleModalInner.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-small">Nobody has put a character at this table yet.</div>`);
			return;
		}

		rows.forEach(row => {
			const line = document.createElement("div");
			line.className = "ve-flex-v-center ve-mb-1";
			line.insertAdjacentHTML("beforeend",
				`<span style="flex: 1; min-width: 0;"><span class="bold">${row.name.qq()}</span>`
				+ `<span class="ve-muted ve-small ve-ml-1">${(row.ownerName || "").qq()}</span></span>`);

			const btn = document.createElement("button");
			btn.className = "ve-btn ve-btn-default ve-btn-xs ve-ml-1";
			btn.type = "button";
			btn.textContent = row.isMine ? "View" : "View (read-only)";
			btn.addEventListener("click", () => this._pShowCharacterSummary(row.id, row.name));
			line.appendChild(btn);

			eleModalInner.appendChild(line);
		});
	}

	/**
	 * Somebody else's character, at a glance.
	 *
	 * Read-only *by construction*: it loads an envelope, computes from it with the same pure modules
	 * the sheet uses, and prints values. Nothing here touches the store, so there is no path by
	 * which a GM looking at a sheet could change it — which is the rule the server enforces too.
	 */
	async _pShowCharacterSummary (id, name) {
		const {eleModalInner} = UiUtil.getShowModal({title: name, isMinHeight0: true});
		eleModalInner.innerHTML = `<div class="ve-muted ve-small">Loading…</div>`;

		let envelope;
		try {
			({envelope} = await this._syncAdapter.pLoad(id));
		} catch (e) {
			eleModalInner.innerHTML = `<div class="ve-muted ve-small">Could not open it: ${(e?.message || String(e)).qq()}</div>`;
			return;
		}

		const summary = getCharacterSummary(envelope?.state || {});
		const abilities = summary.abilities
			.map(a => `<div class="ve-mr-3"><div class="ve-small ve-muted">${a.label.qq()}</div><div class="bold">${a.score} <span class="ve-muted">(${a.modText})</span></div></div>`)
			.join("");
		const lines = getSummaryLines(summary)
			.map(({label, value}) => `<div class="ve-flex ve-mb-1"><span class="bold" style="min-width: 11em; flex-shrink: 0;">${label.qq()}</span><span>${String(value).qq()}</span></div>`)
			.join("");

		eleModalInner.innerHTML = `<div class="ve-muted ve-small ve-mb-2">Read-only.</div>
			<div class="ve-flex ve-flex-wrap ve-mb-2">${abilities}</div>
			${lines}`;
	}

	/** Upload, stating the version being replaced. A refusal is a conflict, and gets asked about. */
	/**
	 * @param isQuiet for an automatic push: a toast for every save would be noise, and a failure
	 *        while offline is not news the second time.
	 */
	async _pPushCharacter (id, {isQuiet = false} = {}) {
		const envelope = this._store.characters[id] ?? {version: 2, state: {}};
		const known = getSyncMeta(this._store, id);

		try {
			const {version} = await this._syncAdapter.pSave(id, envelope, {version: known?.version ?? null});
			setSyncMeta(this._store, id, {version, at: Date.now()});
			this._persistNow();
			// After the persist, which would otherwise queue it straight back up
			this._syncPending.delete(id);
			this._syncLastError = null;
			this._renderSyncBadge();
			if (!isQuiet) JqueryUtil.doToast({type: "success", content: `${getCharacterLabel(envelope)} saved online.`});
		} catch (e) {
			if (isSyncConflict(e)) {
				this._syncPending.delete(id);
				return this._pResolveSyncConflict(id, envelope, e);
			}

			// Keep it queued: a minute offline must not cost the session
			const message = `Could not save online: ${e?.message || e}`;
			if (!isQuiet || this._syncLastError !== message) JqueryUtil.doToast({type: "danger", content: message});
			this._syncLastError = message;
		}
	}

	async _pPullCharacter (id) {
		try {
			const {envelope, version} = await this._syncAdapter.pLoad(id);
			this._doAdoptEnvelope(id, envelope, version);
			JqueryUtil.doToast({type: "success", content: `${getCharacterLabel(envelope)} downloaded.`});
		} catch (e) {
			JqueryUtil.doToast({type: "danger", content: `Could not download: ${e?.message || e}`});
		}
	}

	/**
	 * Take the server's copy of a character into the store.
	 *
	 * The ordering here is the whole of it. `_persistNow` writes the *live component* back over the
	 * current character's entry, so putting an envelope in the store and then persisting quietly
	 * undoes it — the character on screen wins. The character being edited therefore has to be
	 * reloaded through `_switchCharacter` instead, which is also the only way the screen can come to
	 * match what was downloaded.
	 */
	_doAdoptEnvelope (id, envelope, version) {
		this._store.characters[id] = envelope;
		setSyncMeta(this._store, id, {version, at: Date.now()});

		if (id === this._store.currentId) this._switchCharacter(id, {isSkipPersist: true});
		else this._persistNow();
	}

	/**
	 * Two devices changed one character. Ask; never pick.
	 *
	 * "Keep both" exists because it is the only answer that cannot lose anything, and it is the one
	 * to reach for when the question is hard to answer at the table.
	 */
	async _pResolveSyncConflict (id, mine, err) {
		const name = getCharacterLabel(mine);
		// The enum prompt renders no description, so the situation has to fit in the title and the
		// option labels — which is no bad discipline for a question asked mid-session
		const choice = await InputUiUtil.pGetUserEnum({
			title: `“${name}” was changed in two places — nothing has been overwritten`,
			placeholder: "Which copy should be kept?",
			values: ["Keep this browser's copy", "Keep the online copy", "Keep both"],
			isResolveItem: true,
			fnDisplay: it => it,
		});
		if (choice == null) return;

		if (choice === "Keep the online copy") {
			this._doAdoptEnvelope(id, err.serverEnvelope, err.serverVersion);
			return;
		}

		if (choice === "Keep both") {
			// This browser's copy becomes a new character, so neither version is anybody's loss
			const copyId = CryptUtil.uid();
			const copy = JSON.parse(JSON.stringify(mine));
			if (copy.state) copy.state.name = getKeptBothName(name);
			this._store.characters[copyId] = copy;

			// Adopt first: the copy is safely in the store, and this is what puts the server's
			// version on screen before anything persists over it
			this._doAdoptEnvelope(id, err.serverEnvelope, err.serverVersion);
			await this._pPushCharacter(copyId);
			return;
		}

		// Keep mine: save again over the version the server actually holds
		try {
			const {version} = await this._syncAdapter.pSave(id, mine, {version: err.serverVersion});
			setSyncMeta(this._store, id, {version, at: Date.now()});
			this._persistNow();
		} catch (e) {
			JqueryUtil.doToast({type: "danger", content: `Could not save online: ${e?.message || e}`});
		}
	}

	/** The badge's text while work is in flight; the same rule as `getSyncStatus`, applied live. */
	_getWorkLabel () {
		const pending = this._syncPending.size;
		const work = this._isSyncFlushing ? "Saving…" : (pending > 0 ? `Unsaved (${pending})` : null);
		if (!work) return {label: this._syncStatus.baseLabel ?? this._syncStatus.label, tone: this._syncStatus.baseTone ?? this._syncStatus.tone};
		return {
			label: work,
			tone: this._isSyncFlushing ? (this._syncStatus.baseTone ?? this._syncStatus.tone) : "warn",
			baseLabel: this._syncStatus.baseLabel ?? this._syncStatus.label,
			baseTone: this._syncStatus.baseTone ?? this._syncStatus.tone,
		};
	}

	/** Whether an account system is connected. The panels ask this rather than poking at the adapter. */
	get isSyncEnabled () { return !!this._syncAdapter; }

	/** What the badge is showing, exposed so a browser test can read it without scraping the DOM. */
	get syncStatus () { return this._syncStatus; }

	init () {
		this._buildDom();
		this._bindInputs();
		this._bindStoreControls();
		this._bindDom();

		this._comp._addHookBase("level", () => this._pMaybePromptLevelUp());
		this._comp._addHookBase("proficiencies", () => this._renderProficiencies());
		this._comp._addHookBase("defenses", () => this._renderDefenses());
		this._comp._addHookBase("pendingAbilityOffers", () => this._renderAbilityOffers());
		// Trait picks imply resistances, and equipped gear grants them for as long as it is worn
		this._comp._addHookBase("inventory", () => this._renderDefenses());
		this._comp._addHookBase("refSpecies", () => this._pRefreshTraitChoices());
		this._comp._addHookBase("traitChoices", () => { this._renderTraitChoices(); this._renderDefenses(); });
		// Level gates the later picks (an Aasimar's Celestial Revelation, ...)
		this._comp._addHookBase("level", () => this._renderTraitChoices());
		this._comp._addHookAllBase(() => this._onStateChange());

		this._bindBreakdownPopovers();
		this._bindPrintPrep();
		this._bindConcentrationWatch();
		this._bindDeathSaveWatch();
		this._buildAppearance();
		this._initStore();

		this._doRenderAll();

		// After the store, because the character asked for may already be here; and after the
		// adapter, because if it is not, it has to be fetched
		this._pOpenRequestedCharacter();

		window.dispatchEvent(new Event("toolsLoaded"));
	}

	/**
	 * `?character=<id>` — a link straight to one character.
	 *
	 * This is what makes the account system's overview able to *say* "open this one": it lists
	 * characters it cannot render, and the pages that can render them are here. A character already
	 * in this browser is simply selected; one that is only online is pulled first, which is the same
	 * path the sync panel's Download takes.
	 *
	 * Silent when it cannot: a stale link, or one for a character on the other page, should leave
	 * somebody looking at their own sheet rather than at an error about a URL they did not type.
	 */
	async _pOpenRequestedCharacter () {
		const id = new URL(window.location.href).searchParams.get("character");
		if (!id) return;

		if (id in this._store.characters) {
			if (id !== this._store.currentId) this._switchCharacter(id);
			return;
		}

		if (!this._syncAdapter) return;

		try {
			const {envelope, version} = await this._syncAdapter.pLoad(id);
			this._doAdoptEnvelope(id, envelope, version);
			// Adopting stores it; opening it is the point of the link
			this._switchCharacter(id);
		} catch (e) {
			JqueryUtil.doToast({type: "danger", content: `Could not open that character: ${e?.message || e}`});
		}
	}

	// region Subclass hooks
	/** Build page-specific DOM scaffolding (ability boxes, lists, panels, ...). */
	_buildDom () {}
	/** Bind page-specific controls, pickers, and panels; register render hooks. */
	_bindDom () {}
	/** Re-render everything from current state (called after bulk loads). */
	_doRenderAll () { this._lastLevel = this._comp.getLevelNumber(); }
	/** Re-render derived values (called on any state change). */
	_renderDerived () {}
	// endregion

	_onStateChange () {
		if (this._isLoading) return;
		this._renderDerived();
		this._saveStateDebounced();
	}

	/* -------------------------------------------- Null-safe input binding -------------------------------------------- */

	_bindInputs () {
		CharacterPageBase._IPT_STR_BINDINGS.forEach(([id, prop]) => this._bindIptStr(id, prop));
		CharacterPageBase._IPT_NUM_BINDINGS.forEach(([id, prop]) => this._bindIptNum(id, prop));
		this._bindCb("cs-inspiration", "inspiration");
	}

	_bindIptStr (id, prop) {
		const ele = document.getElementById(id);
		if (!ele) return;
		const setState = () => this._comp._state[prop] = ele.value;
		ele.addEventListener("input", setState);
		ele.addEventListener("change", setState);

		const hook = () => {
			const val = this._comp._state[prop] ?? "";
			if (ele.value !== `${val}`) ele.value = val;
		};
		this._comp._addHookBase(prop, hook);
		this._fnsSyncInput.push(hook);
		hook();
	}

	_bindIptNum (id, prop) {
		const ele = document.getElementById(id);
		if (!ele) return;
		const setState = () => {
			const raw = ele.value.trim();
			const num = Number(raw);
			this._comp._state[prop] = raw === "" || isNaN(num) ? null : num;
		};
		ele.addEventListener("input", setState);
		ele.addEventListener("change", setState);

		const doSync = () => {
			const val = this._comp._state[prop];
			const asStr = val == null ? "" : `${val}`;
			if (ele.value !== asStr) ele.value = asStr;
		};
		const hook = () => {
			if (document.activeElement === ele) return; // don't clobber while typing
			doSync();
		};
		this._comp._addHookBase(prop, hook);
		this._fnsSyncInput.push(doSync);
		doSync();
	}

	_bindCb (id, prop) {
		const ele = document.getElementById(id);
		if (!ele) return;
		ele.addEventListener("change", () => this._comp._state[prop] = ele.checked);
		const hook = () => ele.checked = !!this._comp._state[prop];
		this._comp._addHookBase(prop, hook);
		this._fnsSyncInput.push(hook);
		hook();
	}

	/** Sync every bound input from state, bypassing focus guards (for bulk loads). */
	_syncAllInputs () { this._fnsSyncInput.forEach(fn => fn()); }

	/* -------------------------------------------- Shared build helpers (data pickers, wizard) -------------------------------------------- */

	/** Build the six ability-score boxes (score input + derived modifier), shared by both pages. */
	_buildAbilities () {
		const wrp = document.getElementById("cs-abilities");
		if (!wrp) return;
		// The modifier leads: it is the number that gets rolled, while the score is reference data
		// you set once. Stacking them (rather than overlapping) keeps both readable.
		wrp.innerHTML = CHAR_SHEET_ABILITIES
			.map(([abv, name]) => `
				<div class="cs__ability" data-cs-ability="${abv}">
					<span class="cs__lbl cs__ability-name">${name}</span>
					<span class="cs__ability-mod cs__roll" id="cs-mod-${abv}">+0</span>
					<label class="cs__ability-scorewrp" title="${name} score">
						<span class="cs__lbl cs__ability-scorelbl">Score</span>
						<input type="number" id="cs-abil-${abv}" min="1" max="30" class="ve-form-control ve-input-xs cs__ability-score">
					</label>
				</div>
			`)
			.join("");

		CHAR_SHEET_ABILITIES.forEach(([abv]) => this._bindIptNum(`cs-abil-${abv}`, `abil_${abv}`));
	}

	/**
	 * Render the ability modifiers, saving throws, skills and passive Perception, each with the
	 * breakdown that explains where its number came from. Identical on every page that shows them.
	 */
	_renderAbilitiesSavesSkills (derived) {
		CHAR_SHEET_ABILITIES.forEach(([abv, name]) => {
			const abil = derived.abilities[abv];
			// The modifier comes from the score; the score itself is explained on its input. The
			// number shown is what an ability *check* rolls, so it carries any exhaustion penalty.
			this._renderRoll(`cs-mod-${abv}`, abil.checkMod, `${name} check`,
				[
					{label: `Score ${abil.score}`, isText: true},
					...abil.scoreParts.slice(1),
					...(derived.exhaustion?.penalty ? [{label: `Exhaustion ${derived.exhaustion.level}`, value: derived.exhaustion.penalty}] : []),
				], {isTapTarget: false});
			CharacterPageBase.setBreakdownTitle(document.getElementById(`cs-abil-${abv}`), name, abil.scoreParts, null, {citeKind: "abilityCheck"});
			this._renderRoll(`cs-saveroll-${abv}`, derived.saves[abv].mod, `${name} save`, derived.saves[abv].parts, {isTapTarget: false});
			CharacterPageBase.setBreakdownTitle(document.getElementById(`cs-savename-${abv}`), `${name} save`, derived.saves[abv].parts, derived.saves[abv].mod, {citeKind: "save"});
		});

		CHAR_SHEET_SKILLS.forEach(skill => {
			const {mod, profState} = derived.skills[skill.key];
			this._renderRoll(`cs-skillroll-${skill.key}`, mod, skill.name, derived.skills[skill.key].parts, {isTapTarget: false});
			CharacterPageBase.setBreakdownTitle(document.getElementById(`cs-skillname-${skill.key}`), skill.name, derived.skills[skill.key].parts, mod, {citeKind: "skill"});

			const btn = document.getElementById(`cs-skillprof-${skill.key}`);
			btn.classList.toggle("cs__prof--1", profState === 1);
			btn.classList.toggle("cs__prof--2", profState === 2);
		});

		const elePassive = document.getElementById("cs-passive-perception");
		elePassive.textContent = `${derived.passivePerception}`;
		CharacterPageBase.setBreakdownTitle(elePassive, "Passive Perception", derived.passivePerceptionParts, derived.passivePerception, {isTotalValue: true, citeKind: "passivePerception"});
	}

	/* -------------------------------------------- Shared DOM scaffolding -------------------------------------------- */

	// Saves, skills, death saves and conditions are built identically wherever they appear, so the
	// sheet and the sidekick page share one copy.
	_buildSaves () {
		const wrp = document.getElementById("cs-saves");
		wrp.innerHTML = CHAR_SHEET_ABILITIES
			.map(([abv, name]) => `
				<label class="cs__list-row" title="Toggle proficiency in ${name} saving throws">
					<input type="checkbox" id="cs-save-${abv}" class="cs__list-cb">
					<span class="cs__roll cs__list-mod" id="cs-saveroll-${abv}">+0</span>
					<span class="cs__list-name" id="cs-savename-${abv}">${name}</span>
				</label>
			`)
			.join("");

		CHAR_SHEET_ABILITIES.forEach(([abv]) => this._bindCb(`cs-save-${abv}`, `save_${abv}`));
	}

	_buildSkills () {
		const wrp = document.getElementById("cs-skills");
		wrp.innerHTML = CHAR_SHEET_SKILLS
			.map(skill => `
				<div class="cs__list-row" data-cs-skill="${skill.key}">
					<button type="button" class="cs__prof" id="cs-skillprof-${skill.key}" title="Click to cycle: not proficient → proficient → expertise"></button>
					<span class="cs__roll cs__list-mod" id="cs-skillroll-${skill.key}">+0</span>
					<span class="cs__list-name" id="cs-skillname-${skill.key}">${skill.name}</span>
					<span class="cs__list-abil ve-muted">${Parser.attAbvToFull(skill.ability).slice(0, 3)}</span>
				</div>
			`)
			.join("");

		CHAR_SHEET_SKILLS.forEach(skill => {
			document.getElementById(`cs-skillprof-${skill.key}`).addEventListener("click", () => {
				const prop = `skill_${skill.key}`;
				this._comp._state[prop] = ((Number(this._comp._state[prop]) || 0) + 1) % 3;
			});
		});
	}

	_buildDeathSaves () {
		[["cs-death-success", "deathSuccess", "success"], ["cs-death-fail", "deathFail", "failure"]]
			.forEach(([id, prop, word]) => {
				const wrp = document.getElementById(id);
				const max = Number(wrp.getAttribute("data-cs-max"));
				for (let i = 0; i < max; ++i) {
					const dot = document.createElement("button");
					dot.type = "button";
					dot.className = "cs__death-dot";
					// Six identical circles are one control to a mouse and six anonymous buttons to
					// anything else; each says which it is, and `aria-pressed` says whether it is set
					dot.setAttribute("aria-label", `Death save ${word} ${i + 1}`);
					dot.setAttribute("aria-pressed", "false");
					dot.addEventListener("click", () => {
						const cur = this._comp._state[prop];
						this._comp._state[prop] = (i + 1 === cur) ? i : i + 1;
					});
					wrp.appendChild(dot);
				}
			});
	}

	_renderDeathSaves () {
		[["cs-death-success", this._comp._state.deathSuccess], ["cs-death-fail", this._comp._state.deathFail]]
			.forEach(([id, cnt]) => {
				const dots = document.getElementById(id).querySelectorAll(".cs__death-dot");
				dots.forEach((dot, ix) => {
					dot.classList.toggle("cs__death-dot--active", ix < cnt);
					dot.setAttribute("aria-pressed", ix < cnt ? "true" : "false");
				});
			});
	}

	_buildConditions () {
		const wrp = document.getElementById("cs-conditions");
		if (!wrp) return;
		wrp.innerHTML = CHAR_SHEET_CONDITIONS
			.map(name => `<button type="button" class="ve-btn ve-btn-xxs ve-btn-default cs__cond no-print" data-cs-cond="${name.qq()}">${name.qq()}</button>`)
			.join("");
		wrp.querySelectorAll(".cs__cond").forEach(btn => {
			btn.addEventListener("click", () => this._comp.toggleCondition(btn.getAttribute("data-cs-cond")));
		});
	}

	_renderConditions () {
		const active = new Set(this._comp._state.conditions || []);
		document.querySelectorAll("#cs-conditions .cs__cond").forEach(btn => {
			const on = active.has(btn.getAttribute("data-cs-cond"));
			btn.classList.toggle("ve-btn-danger", on);
			btn.classList.toggle("ve-btn-default", !on);
		});
	}

	_adjustHp (sign) {
		// The delta input is transient UI, not character state, so it is not model-bound
		const eleDelta = document.getElementById("cs-hp-delta");
		const delta = Math.abs(Number(eleDelta.value) || 0);
		if (!delta) return;
		this._comp._state.hpCur = (Number(this._comp._state.hpCur) || 0) + (sign * delta);
		eleDelta.value = "0";
	}

	/* -------------------------------------------- Concentration -------------------------------------------- */

	/**
	 * Losing hit points while concentrating calls for a Constitution save, and forgetting it is the
	 * single easiest thing to miss at the table. Watching `hpCur` rather than the Damage button means
	 * typing a lower number into the field counts too.
	 */
	_bindConcentrationWatch () {
		this._lastHpCur = Number(this._comp._state.hpCur) || 0;

		this._comp._addHookBase("hpCur", () => {
			const prev = this._lastHpCur;
			const next = Number(this._comp._state.hpCur) || 0;
			this._lastHpCur = next;

			// Loading a character or switching to another is not damage
			if (this._isLoading) return;
			const damage = prev - next;

			// The same swing the journal records: one hook, so the two can never disagree about
			// what counts as damage
			if (damage > 0) this._comp.logJournal(EV_DAMAGE, {v: damage});
			else if (damage < 0) this._comp.logJournal(EV_HEAL, {v: -damage});
			if (next <= 0 && prev > 0) this._comp.logJournal(EV_DOWN);

			if (damage <= 0) return;
			if (!(this._comp._state.concentration || "").trim()) return;

			this._renderConcentrationPrompt(damage);
		});

		// Dropping the spell by hand also dismisses the prompt
		this._comp._addHookBase("concentration", () => {
			if (!(this._comp._state.concentration || "").trim()) this._hideConcentrationPrompt();
		});
	}

	/* -------------------------------------------- Appearance & portrait -------------------------------------------- */

	static _APPEARANCE_FIELDS = [
		["age", "Age"],
		["height", "Height"],
		["weight", "Weight"],
		["eyes", "Eyes"],
		["skin", "Skin"],
		["hair", "Hair"],
	];

	/**
	 * The description fields the printed sheet has always had a box for, plus a portrait. Built here
	 * rather than in each template, so the sheet and the builder cannot drift apart.
	 */
	_buildAppearance () {
		const wrp = document.getElementById("cs-appearance");
		if (!wrp) return;

		wrp.innerHTML = `
			<div class="cs__appearance">
				<div class="cs__portrait-wrp">
					<img id="cs-portrait-img" class="cs__portrait" alt="Character portrait">
					<div id="cs-portrait-empty" class="cs__portrait cs__portrait--empty" title="No portrait chosen">No portrait</div>
					<div class="cs__portrait-controls no-print">
						<label class="ve-btn ve-btn-xs ve-btn-default" title="Choose an image; it is scaled down before it is stored">
							Choose<input type="file" id="cs-portrait-file" accept="image/*" class="ve-hidden">
						</label>
						<button type="button" class="ve-btn ve-btn-xs ve-btn-danger" id="cs-portrait-clear" title="Remove the portrait">Clear</button>
					</div>
				</div>
				<div class="cs__appearance-fields">
					${CharacterPageBase._APPEARANCE_FIELDS
		.map(([key, label]) => `<label class="cs__field"><span class="cs__lbl">${label}</span><input type="text" id="cs-appearance-${key}" class="ve-form-control ve-input-xs"></label>`)
		.join("")}
				</div>
			</div>`;

		CharacterPageBase._APPEARANCE_FIELDS
			.forEach(([key]) => this._bindIptStr(`cs-appearance-${key}`, `appearance${key.uppercaseFirst()}`));

		document.getElementById("cs-portrait-file")
			?.addEventListener("change", evt => this._pOnPortraitPicked(evt.target));
		this._bindClick("cs-portrait-clear", () => { this._comp._state.portrait = ""; });
		this._comp._addHookBase("portrait", () => this._renderPortrait());
		this._renderPortrait();
	}

	_renderPortrait () {
		const img = document.getElementById("cs-portrait-img");
		const empty = document.getElementById("cs-portrait-empty");
		if (!img || !empty) return;
		const src = this._comp._state.portrait || "";
		img.src = src;
		img.classList.toggle("ve-hidden", !src);
		empty.classList.toggle("ve-hidden", !!src);
	}

	/**
	 * Read the chosen image, scale it down and re-encode it before storing. A portrait shares
	 * `localStorage` with every other character, so an untouched photo would be enough on its own to
	 * break saving for all of them.
	 */
	async _pOnPortraitPicked (ipt) {
		const file = ipt?.files?.[0];
		if (!file) return;
		ipt.value = ""; // so choosing the same file twice still fires

		try {
			const dataUrl = await CharacterPageBase._pScaleImageFile(file);
			if (isPortraitTooLarge(dataUrl)) {
				JqueryUtil.doToast({type: "danger", content: "That image is too large to store, even scaled down. Try a smaller one."});
				return;
			}
			this._comp._state.portrait = dataUrl;
		} catch (e) {
			JqueryUtil.doToast({type: "danger", content: `Could not read that image${e?.message ? `: ${e.message}` : ""}.`});
		}
	}

	static _pScaleImageFile (file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onerror = () => reject(new Error("the file could not be read"));
			reader.onload = () => {
				const img = new Image();
				img.onerror = () => reject(new Error("it is not an image"));
				img.onload = () => {
					const {width, height} = getPortraitTargetSize(img.naturalWidth, img.naturalHeight);
					if (!width || !height) return reject(new Error("it has no size"));
					const canvas = document.createElement("canvas");
					canvas.width = width;
					canvas.height = height;
					canvas.getContext("2d").drawImage(img, 0, 0, width, height);
					resolve(canvas.toDataURL(PORTRAIT_MIME, PORTRAIT_QUALITY));
				};
				img.src = reader.result;
			};
			reader.readAsDataURL(file);
		});
	}

	/** Set the loading guard, and stop the journal recording while it is on. */
	_setLoading (isLoading) {
		this._isLoading = isLoading;
		this._comp.setJournalPaused(isLoading);
	}

	/**
	 * A death save is worth remembering, but the counters also go back to zero on a long rest or a
	 * heal — only a count going *up* is a save that was actually rolled.
	 */
	_bindDeathSaveWatch () {
		["deathSuccess", "deathFail"].forEach(prop => {
			this._comp._addHookBase(prop, () => {
				const prev = this._lastDeathSaves[prop] || 0;
				const next = Number(this._comp._state[prop]) || 0;
				this._lastDeathSaves[prop] = next;
				if (this._isLoading || next <= prev) return;
				for (let i = prev; i < next; ++i) {
					this._comp.logJournal(EV_DEATH_SAVE, {n: prop === "deathFail" ? "fail" : "success"});
				}
			});
		});
	}

	_hideConcentrationPrompt () {
		document.getElementById("cs-conc-prompt")?.classList.add("ve-hidden");
	}

	_renderConcentrationPrompt (damage) {
		const wrp = document.getElementById("cs-conc-prompt");
		if (!wrp) return;

		const dc = getConcentrationSaveDc(damage);
		const save = deriveCharacterSheet(this._comp._getState()).saves.con;
		const spell = this._comp._state.concentration;

		wrp.innerHTML = `
			<div class="cs__conc-prompt-line">
				<span class="ve-bold">DC ${dc}</span> Constitution save to keep
				<span class="ve-bold">${spell.qq()}</span>
				<span class="ve-muted">(${damage} damage)</span>
			</div>
			<div class="cs__conc-prompt-actions ve-flex-v-center">
				<span class="cs__roll cs__conc-roll"></span>
				<button type="button" class="ve-btn ve-btn-xxs ve-btn-default" data-cs-conc="keep">Kept it</button>
				<button type="button" class="ve-btn ve-btn-xxs ve-btn-danger" data-cs-conc="lose">Lost it</button>
			</div>`;

		wrp.querySelector(".cs__conc-roll").innerHTML = Renderer.get()
			.render(`{@d20 ${save.mod}|${CharacterPageBase.fmtBonus(save.mod)}|Concentration (Constitution save)}`);
		wrp.querySelector("[data-cs-conc=keep]").addEventListener("click", () => this._hideConcentrationPrompt());
		wrp.querySelector("[data-cs-conc=lose]").addEventListener("click", () => {
			this._comp._state.concentration = "";
			this._hideConcentrationPrompt();
		});

		wrp.classList.remove("ve-hidden");
	}

	/** What exhaustion is costing this character, stated next to the counter. */
	_renderExhaustionNote (derived) {
		const ele = document.getElementById("cs-exhaustion-note");
		if (!ele) return;

		const {level, penalty, speedPenaltyFt} = derived.exhaustion;
		if (!level) { ele.textContent = ""; return; }

		ele.textContent = level >= EXHAUSTION_MAX_LEVEL
			? "dead"
			: `${penalty} to d20 tests, −${speedPenaltyFt} ft. speed`;
		ele.title = level >= EXHAUSTION_MAX_LEVEL
			? "The sixth level of exhaustion is death"
			: `Every ability check, saving throw and attack roll is reduced by ${Math.abs(penalty)}`;
	}

	/** Bind the species/background/class search buttons shared by both pages. */
	_bindBuildPickers () {
		this._bindClick("cs-pick-species", () => this._onPickSpecies());
		this._bindClick("cs-pick-background", () => this._onPickBackground());
		this._bindClick("cs-pick-class", () => this._onPickClass());
	}

	_renderPickLink (which) {
		const ele = document.getElementById(`cs-link-${which}`);
		if (!ele) return;
		const tag = this._comp._state.pickTags[which];
		ele.innerHTML = tag ? Renderer.get().render(tag) : "";
	}

	_renderPickLinks () {
		["species", "background", "class"].forEach(w => this._renderPickLink(w));
	}

	/* -------------------------------------------- Proficiencies -------------------------------------------- */

	/**
	 * Render the structured armor/weapon/tool/language proficiencies, grouped by kind. Each entry
	 * carries the source(s) that granted it, so a player can see *why* they have it; the free-text
	 * box below stays for anything the data cannot express.
	 */
	_renderProficiencies () {
		const wrp = document.getElementById("cs-prof-list");
		if (!wrp) return;
		wrp.innerHTML = "";

		const groups = groupProficienciesByKind(this._comp._state.proficiencies || []);
		if (!groups.length) {
			wrp.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-small no-print">None yet &mdash; picking content fills these in, or add one by hand.</div>`);
		}

		groups.forEach(grp => {
			const row = document.createElement("div");
			row.className = "cs__prof-group";

			const lbl = document.createElement("span");
			lbl.className = "cs__lbl cs__prof-group-lbl";
			lbl.textContent = grp.label;
			row.appendChild(lbl);

			grp.items.forEach(it => {
				const chip = document.createElement("span");
				chip.className = "cs__prof-chip";
				if (it.isOptional) chip.classList.add("cs__prof-chip--optional");

				const from = it.sources.length ? `From: ${it.sources.join(", ")}` : "Added by hand";
				const explanation = it.isOptional ? `${from} (optional in the rules)` : from;
				chip.title = explanation;
				chip.classList.add("cs__has-breakdown");
				chip.dataset.csBreakdown = `${it.name} — ${explanation}`;
				CharacterPageBase._markBreakdownTarget(chip);

				const name = document.createElement("span");
				name.textContent = it.name;
				chip.appendChild(name);

				const btnRm = document.createElement("button");
				btnRm.type = "button";
				btnRm.className = "cs__prof-chip-rm no-print";
				btnRm.title = "Remove";
				btnRm.innerHTML = "&times;";
				btnRm.addEventListener("click", () => it.ids.forEach(id => this._comp.removeProficiency(id)));
				chip.appendChild(btnRm);

				row.appendChild(chip);
			});

			wrp.appendChild(row);
		});

		const btnAdd = document.createElement("button");
		btnAdd.type = "button";
		btnAdd.className = "ve-btn ve-btn-xxs ve-btn-default no-print ve-mt-1";
		btnAdd.id = "cs-prof-add";
		btnAdd.title = "Add a proficiency earned through training or the story";
		btnAdd.innerHTML = `<span class="glyphicon glyphicon-plus"></span> Add Proficiency`;
		btnAdd.addEventListener("click", () => this._pOnAddProficiency());
		wrp.appendChild(btnAdd);
	}

	async _pOnAddProficiency () {
		const kind = await InputUiUtil.pGetUserEnum({
			values: PROF_KINDS,
			isResolveItem: true,
			fnDisplay: it => it.label,
			title: "Add a proficiency",
			placeholder: "Which kind?",
		});
		if (kind == null) return;

		const name = await InputUiUtil.pGetUserString({title: `Add ${kind.label} proficiency`});
		if (!name?.trim()) return;

		this._comp.addProficiency({kind: kind.kind, name: name.trim(), source: null});
	}

	/* -------------------------------------------- Defenses & senses -------------------------------------------- */

	/**
	 * Resistances, immunities, vulnerabilities, condition immunities and senses, grouped and
	 * attributed. What equipped gear grants is folded in here rather than stored, so taking the ring
	 * off takes the resistance with it — the chip says as much.
	 */
	_renderDefenses () {
		const wrp = document.getElementById("cs-defense-list");
		if (!wrp) return;
		wrp.innerHTML = "";

		const groups = groupDefensesByKind(getAllDefenses(this._comp._getState()));
		if (!groups.length) {
			wrp.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-small no-print">None yet &mdash; a species, feat or magic item fills these in, or add one by hand.</div>`);
		}

		groups.forEach(grp => {
			const row = document.createElement("div");
			row.className = "cs__prof-group";

			const lbl = document.createElement("span");
			lbl.className = "cs__lbl cs__prof-group-lbl";
			lbl.textContent = grp.label;
			row.appendChild(lbl);

			grp.items.forEach(it => {
				const chip = document.createElement("span");
				chip.className = "cs__prof-chip";
				if (it.isFromItem) chip.classList.add("cs__prof-chip--optional");

				const from = it.sources.length ? `From: ${it.sources.join(", ")}` : "Added by hand";
				const explanation = [
					from,
					it.note ? `(${it.note})` : null,
					it.isFromItem ? "— while that gear is equipped" : null,
				].filter(Boolean).join(" ");
				chip.title = explanation;
				chip.classList.add("cs__has-breakdown");
				chip.dataset.csBreakdown = `${it.name} — ${explanation}`;
				CharacterPageBase._markBreakdownTarget(chip);

				const name = document.createElement("span");
				name.textContent = it.note ? `${it.name}*` : it.name;
				chip.appendChild(name);

				// Only a stored entry can be removed; gear is removed by unequipping it
				if (it.ids.length) {
					const btnRm = document.createElement("button");
					btnRm.type = "button";
					btnRm.className = "cs__prof-chip-rm no-print";
					btnRm.title = "Remove";
					btnRm.innerHTML = "&times;";
					btnRm.addEventListener("click", () => it.ids.forEach(id => this._comp.removeDefense(id)));
					chip.appendChild(btnRm);
				}

				row.appendChild(chip);
			});

			wrp.appendChild(row);
		});

		const btnAdd = document.createElement("button");
		btnAdd.type = "button";
		btnAdd.className = "ve-btn ve-btn-xxs ve-btn-default no-print ve-mt-1";
		btnAdd.id = "cs-defense-add";
		btnAdd.title = "Add a resistance, immunity or sense granted by the story or a ruling";
		btnAdd.innerHTML = `<span class="glyphicon glyphicon-plus"></span> Add Defense`;
		btnAdd.addEventListener("click", () => this._pOnAddDefense());
		wrp.appendChild(btnAdd);
	}

	async _pOnAddDefense () {
		const kind = await InputUiUtil.pGetUserEnum({
			values: DEFENSE_KINDS,
			isResolveItem: true,
			fnDisplay: it => it.label,
			title: "Add a defense or sense",
			placeholder: "Which kind?",
		});
		if (kind == null) return;

		const name = await InputUiUtil.pGetUserString({
			title: kind.kind === DEFENSE_KIND_SENSE ? "Add a sense (e.g. Darkvision 60 ft.)" : `Add ${kind.label.replace(/s$/, "")}`,
		});
		if (!name?.trim()) return;

		this._comp.addDefense({kind: kind.kind, name: name.trim(), source: null});
	}

	/**
	 * The upstream `pGetUserRaceSearch`/`pGetUserBackgroundSearch` helpers take no options, so there is
	 * no way to pass a source filter into them. Rather than edit an upstream file (which would add an
	 * upstream-merge conflict point), load the same index and drive the lower-level entity search — it
	 * does accept `fnFilterResults`. Search docs carry their source as `.s`.
	 */
	async _pSearchEntity ({fnLoad, indexName, title, fnTransform = null}) {
		await fnLoad();
		const opts = {};
		if (fnTransform) opts.fnTransform = fnTransform;
		if (!isSourceFilterInactive(this._comp._state.sourceFilter)) {
			opts.fnFilterResults = doc => this._isSourceAllowed(doc.s);
		}
		return SearchWidget.pGetUserEntitySearch(title, indexName, opts);
	}

	async _onPickSpecies () {
		const doc = await this._pSearchEntity({
			fnLoad: () => SearchWidget.pLoadCustomIndex({
				contentIndexName: "entity_Races",
				errorName: "species",
				customIndexSubSpecs: [new SearchWidget.CustomIndexSubSpec({
					dataSource: () => DataUtil.race.loadJSON(),
					prop: "race",
					catId: Parser.CAT_ID_RACE,
					page: UrlUtil.PG_RACES,
				})],
			}),
			indexName: "entity_Races",
			title: "Select Species",
			fnTransform: doc => {
				const cpy = MiscUtil.copyFast(doc);
				Object.assign(cpy, SearchWidget.docToPageSourceHash(cpy));
				cpy.tag = `{@race ${doc.n}${doc.s !== Parser.SRC_PHB ? `|${doc.s}` : ""}}`;
				return cpy;
			},
		});
		if (!doc) return;
		const ent = await DataLoader.pCacheAndGet(doc.page, doc.source, doc.hash, {isCopy: true});
		this._comp.applyPickedRace({doc, ent});
		if (ent) {
			await this._pOfferAbilityBonuses(ent, doc.n);
			await this._pResolveSizeChoice(ent);
			await this._pResolveProficiencyChoices({ent, kind: "race"});
			// The 2024 Human's Versatile grants an Origin feat, in the same way a background does
			await this._pGrantOriginFeats(ent);
			const isResistChosen = await this._pResolveTraitChoices(ent);
			// A Draconic Ancestry pick already fixes the damage resistance; don't ask twice
			if (!isResistChosen) await this._pResolveResistChoices(ent);
			// A species' lineage spells (Elf, Tiefling, ...) use the same `additionalSpells` shape as feats
			await pResolveEntitySpellGrants(this._comp, ent, {grantKeyPrefix: `race:${ent.name}|${ent.source}`});
		}
	}

	/**
	 * The size a species leaves to the player — "Small or Medium", which 30 of them say.
	 *
	 * It is a real decision (carrying capacity, grappling, squeezing), not a label, so it is asked
	 * once and stored rather than printed as a slash and forgotten.
	 */
	async _pResolveSizeChoice (ent) {
		const sizes = [ent?.size].flat().filter(Boolean);
		if (sizes.length < 2) return;
		const picked = await InputUiUtil.pGetUserEnum({
			values: sizes,
			isResolveItem: true,
			fnDisplay: abv => Parser.sizeAbvToFull(abv),
			title: `${ent.name}: which size?`,
			placeholder: "Select a size...",
		});
		if (picked == null) return;
		this._comp.setSize(picked);
	}

	/**
	 * Resolve a species' damage-resistance choice — a Dragonborn's draconic ancestry and the few
	 * species built the same way — into structured entries alongside its fixed ones.
	 */
	async _pResolveResistChoices (ent) {
		for (const choice of getResistChoices({groups: ent.resist, sourceName: ent.name})) {
			const picked = await pPickList({count: choice.count, from: choice.from, title: `${ent.name}: ${choice.label}`});
			(picked || []).forEach(name => this._comp.addDefense({kind: DEFENSE_KIND_RESIST, name, source: ent.name}));
		}
	}

	/* -------------------------------------------- "Choose one" trait picks -------------------------------------------- */

	/**
	 * Ask for each "choose one of the following" species trait the character already qualifies for
	 * (Elven Lineage, Giant Ancestry, Draconic Ancestry, ...). Traits gained at a later level are
	 * left for the panel, which offers them once that level is reached.
	 * @return {boolean} Whether a pick also settled the species' damage resistance.
	 */
	async _pResolveTraitChoices (ent) {
		let isResistChosen = false;
		const level = this._comp.getLevelNumber();

		for (const choice of getTraitChoices(ent)) {
			if (choice.level > level) continue;
			const option = await InputUiUtil.pGetUserEnum({
				values: choice.options,
				isResolveItem: true,
				fnDisplay: opt => opt.name,
				title: `${ent.name}: ${choice.trait}`,
				placeholder: "Select an option...",
			});
			if (option == null) continue;
			this._applyTraitChoice({source: ent.name, choice, optionName: option.name});
			if (getTraitChoiceResist(choice, option.name)) isResistChosen = true;
		}

		return isResistChosen;
	}

	_applyTraitChoice ({source, choice, optionName}) {
		this._comp.setTraitChoice({
			source,
			trait: choice.trait,
			level: choice.level,
			option: optionName,
			resist: optionName ? getTraitChoiceResist(choice, optionName) : null,
		});
	}

	/**
	 * Load the picked species so its "choose one" traits can be offered. Held on the page rather
	 * than in the character, since it is data rather than a decision.
	 */
	async _pRefreshTraitChoices () {
		const ref = this._comp._state.refSpecies;
		this._traitChoiceDefs = [];
		this._traitChoiceSource = ref?.name || null;

		if (ref?.name && ref?.source) {
			const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_RACES]({name: ref.name, source: ref.source});
			const ent = await DataLoader.pCacheAndGet(UrlUtil.PG_RACES, ref.source, hash, {isCopy: true}).catch(() => null);
			if (ent) this._traitChoiceDefs = getTraitChoices(ent);
		}

		this._renderTraitChoices();
	}

	/** Render the species' "choose one" traits, so a pick can be made or changed at any time. */
	_renderTraitChoices () {
		const wrp = document.getElementById("cs-trait-list");
		if (!wrp) return;
		wrp.innerHTML = "";

		const defs = this._traitChoiceDefs || [];
		if (!defs.length) return;

		const source = this._traitChoiceSource;
		const level = this._comp.getLevelNumber();

		defs.forEach(choice => {
			const cur = this._comp.getTraitChoice(source, choice.trait);
			const isLocked = choice.level > level;

			const row = document.createElement("div");
			row.className = "cs__trait-choice";

			const head = document.createElement("div");
			head.className = "ve-flex-v-center";
			const lbl = document.createElement("span");
			lbl.className = "cs__lbl ve-mr-2";
			lbl.textContent = choice.trait;
			lbl.title = choice.prompt;
			head.appendChild(lbl);

			const sel = document.createElement("select");
			sel.className = "ve-form-control ve-input-xs";
			sel.disabled = isLocked;
			sel.innerHTML = `<option value="">&mdash;</option>${choice.options.map(opt => `<option>${opt.name.qq()}</option>`).join("")}`;
			sel.value = cur?.option || "";
			sel.addEventListener("change", () => this._applyTraitChoice({source, choice, optionName: sel.value || null}));
			head.appendChild(sel);
			row.appendChild(head);

			const note = document.createElement("div");
			note.className = "ve-muted ve-small";
			const picked = choice.options.find(opt => opt.name === cur?.option);
			if (isLocked) note.textContent = `Chosen at level ${choice.level}.`;
			else if (picked) note.textContent = [picked.desc, cur.resist ? `Resistance: ${cur.resist}` : null].filter(Boolean).join(" ");
			else note.textContent = choice.prompt;
			row.appendChild(note);

			wrp.appendChild(row);
		});
	}

	async _onPickBackground () {
		const doc = await this._pSearchEntity({
			fnLoad: () => SearchWidget.pLoadCustomIndex({
				contentIndexName: "entity_Backgrounds",
				errorName: "backgrounds",
				customIndexSubSpecs: [new SearchWidget.CustomIndexSubSpec({
					dataSource: `${Renderer.get().baseUrl}data/backgrounds.json`,
					prop: "background",
					catId: Parser.CAT_ID_BACKGROUND,
					page: UrlUtil.PG_BACKGROUNDS,
				})],
			}),
			indexName: "entity_Backgrounds",
			title: "Select Background",
			fnTransform: doc => {
				const cpy = MiscUtil.copyFast(doc);
				Object.assign(cpy, SearchWidget.docToPageSourceHash(cpy));
				cpy.tag = `{@background ${doc.n}${doc.s !== Parser.SRC_PHB ? `|${doc.s}` : ""}}`;
				return cpy;
			},
		});
		if (!doc) return;
		const ent = await DataLoader.pCacheAndGet(doc.page, doc.source, doc.hash, {isCopy: true});
		// Fixed proficiencies apply directly; the "N of your choice" ones are resolved interactively below.
		this._comp.applyPickedBackground({doc, ent, isFixedOnly: true});
		if (ent) {
			await this._pOfferAbilityBonuses(ent, doc.n);
			await this._pResolveProficiencyChoices({ent, kind: "background"});
			await this._pGrantOriginFeats(ent);
		}
	}

	/**
	 * Resolve the choice-based skill/language/tool proficiencies a species or background grants
	 * (e.g. "choose 2 skills", "one tool of your choice") — the same choices the wizard's Choices
	 * step surfaces. Skills apply to the sheet; tools/languages have no structured store, so they
	 * become proficiency notes. Ability-score choices are handled separately by `_pOfferAbilityBonuses`.
	 */
	async _pResolveProficiencyChoices ({ent, kind}) {
		const toolNames = await CharacterSheetClassData.pGetToolProficiencyNames();
		const choices = getPendingChoices({[kind]: ent, toolNames}).filter(c => c.type !== CHOICE_TYPE_ABILITY);
		if (!choices.length) return;

		// What is already held comes out of every list, and each pick joins it — otherwise the second
		// chooser happily offers what the first one just took, and the duplicate silently vanishes
		const held = mergeHeldProficiencyNames(
			getHeldProficiencyNames(this._comp._getState()),
			getFixedProficiencyNames({[kind === "race" ? "race" : "background"]: ent}),
		);

		for (const choice of choices) {
			// A pick spendable on a skill *or* a tool is classified by the pool it came from, so it
			// loses the right things and lands in the right place
			const isMixed = choice.type === CHOICE_TYPE_SKILL_TOOL_LANGUAGE;
			const typeOf = name => (isMixed
				? [CHOICE_TYPE_SKILL, CHOICE_TYPE_TOOL, CHOICE_TYPE_LANGUAGE].find(t => (choice.pools?.[t] || []).includes(name)) || CHOICE_TYPE_TOOL
				: choice.type);

			const offered = isMixed
				? {...choice, from: choice.from.filter(name => !held[typeOf(name)]?.has(name))}
				: getChoiceWithoutHeld(choice, held);
			if (!offered?.from?.length) continue;

			const count = Math.min(choice.count || 1, offered.from.length);
			const picked = await pPickList({count, from: offered.from, title: `${ent.name}: ${choice.label}`});
			(picked || []).forEach(name => {
				const type = typeOf(name);
				held[type]?.add(name);
				if (type === CHOICE_TYPE_SKILL) this._comp.setSkillProfByName(name, PROF_STATE_PROFICIENT);
				else if (type === CHOICE_TYPE_LANGUAGE) this._comp.addProficiency({kind: PROF_KIND_LANGUAGE, name, source: ent.name});
				else if (type === CHOICE_TYPE_TOOL) this._comp.addProficiency({kind: PROF_KIND_TOOL, name, source: ent.name});
			});

			// Recorded the same way the guided setup records it, so a character built either way looks
			// the same afterwards and neither path asks a question the other has answered
			if (picked?.length) {
				this._comp.recordChoice({sig: getChoiceSignature(choice), sourceName: choice.sourceName, type: choice.type, picks: picked});
			}
		}
	}

	/**
	 * The Origin feats an entity grants, in either shape the data uses:
	 *
	 *  - **named**, as most 2024 backgrounds do — `feats: [{"tavern brawler|xphb": true}]`;
	 *  - **by category**, as the 2024 Human's Versatile does — `{anyFromCategory: {category: ["O"]}}`,
	 *    which is "an Origin feat of your choice" and needs a picker rather than a confirmation.
	 *
	 * Each is resolved properly — ability increase, fixed grants, skill and Expertise choices — and
	 * recorded as a real feat. Writing the name into a notes box was the old behaviour, and it is
	 * what made a background's feat invisible to everything that counts.
	 */
	async _pGrantOriginFeats (ent) {
		for (const {name, source, displayName} of getGrantedFeats(ent?.feats)) {
			const feat = await CharacterSheetClassData.pGetFeat({name, source}).catch(() => null);
			if (!feat) continue;
			const isApply = await InputUiUtil.pGetUserBoolean({
				title: "Grant Origin Feat?",
				htmlDescription: `<div>${(ent.name || "This").qq()} grants the origin feat <b>${(displayName || feat.name).qq()}</b>.<br>Add it now?</div>`,
				textYes: "Add",
				textNo: "Skip",
			});
			if (!isApply) continue;
			await this._pTakeOriginFeat(feat, displayName || feat.name, ent.name);
		}

		for (const grant of getGrantedFeatCategories(ent?.feats)) {
			for (let i = 0; i < grant.count; ++i) await this._pPickOriginFeatFromCategory(ent, grant);
		}
	}

	/** "An Origin feat of your choice": the picker, then the feat's own questions. */
	async _pPickOriginFeatFromCategory (ent, grant) {
		const taken = new Set((this._comp._state.originFeats || []).map(it => `${it.name}|${it.source}`.toLowerCase()));
		const pool = (await CharacterSheetClassData.pGetAllFeats())
			.filter(f => String(f.category || "").toUpperCase().split(":")[0] === grant.category)
			// A feat the book marks `repeatable` may legitimately be taken again — Skilled and Magic
			// Initiate both are, and filtering them out blocked a legal second take
			.filter(f => f.repeatable || !taken.has(`${f.name}|${f.source}`.toLowerCase()));

		if (!pool.length) {
			JqueryUtil.doToast({type: "warning", content: "No feats of that kind are available in the books this character allows."});
			return;
		}

		const feat = await InputUiUtil.pGetUserEnum({
			values: pool,
			isResolveItem: true,
			fnDisplay: f => `${f.name} (${Parser.sourceJsonToAbv(f.source)})`,
			title: `${ent.name}: choose an Origin feat`,
			placeholder: "Select...",
		});
		if (feat == null) return;
		await this._pTakeOriginFeat(feat, feat.name, ent.name);
	}

	async _pTakeOriginFeat (feat, displayName, from) {
		const bonuses = await pResolveFeat(this._comp, feat);
		if (bonuses == null) return;
		this._comp.addOriginFeat({name: feat.name, source: feat.source, displayName, bonuses, from, isRepeatable: !!feat.repeatable});
	}

	/**
	 * After a standalone pick: offer to apply the entity's ability score increases (opt-in, since the
	 * sheet's scores are final values). Unambiguous fixed bonuses are a single confirm; choice-based
	 * ones (a 2024 background's "+2/+1 among ..." or "choose 2 of ...") are resolved interactively.
	 */
	async _pOfferAbilityBonuses (ent, name) {
		const fixed = getFixedAbilityBonuses(ent.ability);
		if (Object.keys(fixed).length) {
			const ptBonuses = Object.entries(fixed).map(([abv, n]) => `${n >= 0 ? "+" : ""}${n} ${Parser.attAbvToFull(abv)}`).join(", ");
			const isApply = await InputUiUtil.pGetUserBoolean({
				title: "Apply Ability Score Increases?",
				htmlDescription: `<div>${name.qq()} grants: <b>${ptBonuses.qq()}</b>.<br>Add this to the current ability scores?</div>`,
				textYes: "Apply",
				textNo: "Skip",
			});
			if (isApply) this._comp.applyAbilityBonuses(fixed, {source: name});
		}

		for (const choice of getAbilityChoices({ability: ent.ability, sourceName: name})) {
			const isApplied = await this._pResolveAbilityChoice(choice, name);
			if (isApplied) this._comp.recordChoice({sig: getChoiceSignature(choice), sourceName: choice.sourceName, type: choice.type, picks: []});
		}
	}

	/**
	 * Walk one ability-score choice: pick the package (when a source offers alternatives, e.g. a 2024
	 * background's "+2/+1" vs "+1/+1/+1"), then assign each increase to an ability. Declining leaves a
	 * note so the grant isn't silently lost.
	 */
	async _pResolveAbilityChoice (choice, name) {
		const ptOffer = choice.packages.map(pkg => getAbilityPackageDisplay(pkg)).join(" — or — ");
		const isApply = await InputUiUtil.pGetUserBoolean({
			title: "Apply Ability Score Increases?",
			htmlDescription: `<div>${name.qq()} grants: <b>${ptOffer.qq()}</b>.<br>Assign this now?</div>`,
			textYes: "Assign",
			textNo: "Skip",
		});
		if (!isApply) {
			this._comp.addPendingAbilityOffer({source: name, offer: ptOffer, packages: choice.packages});
			return;
		}

		let pkg = choice.packages[0];
		if (choice.packages.length > 1) {
			pkg = await InputUiUtil.pGetUserEnum({
				values: choice.packages,
				isResolveItem: true,
				fnDisplay: p => getAbilityPackageDisplay(p),
				title: `${name}: which increases?`,
				placeholder: "Select...",
			});
			if (pkg == null) return;
		}

		const allAbvs = CHAR_SHEET_ABILITIES.map(([abv]) => abv);
		const bonuses = {...pkg.fixed};
		const taken = new Set(Object.keys(bonuses));

		// "+2/+1 among Dex, Int, Wis": assign each weight to a distinct ability, largest first
		for (const weight of (pkg.weighted?.weights || [])) {
			const from = (pkg.weighted.from.length ? pkg.weighted.from : allAbvs).filter(abv => !taken.has(abv));
			if (!from.length) break;
			const [abv] = await pPickAbilities({count: 1, from, title: `${name}: which ability gets ${weight >= 0 ? "+" : ""}${weight}?`}) || [];
			if (abv == null) return this._noteUnassignedAbilities(name, ptOffer, choice.packages);
			bonuses[abv] = (bonuses[abv] || 0) + weight;
			taken.add(abv);
		}

		// "+1 to 2 of Str, Dex": pick `count` distinct abilities, each gaining `amount`
		if (pkg.choose) {
			const from = (pkg.choose.from.length ? pkg.choose.from : allAbvs).filter(abv => !taken.has(abv));
			const picked = await pPickAbilities({count: pkg.choose.count, from, title: `${name}: increase which ability?`});
			if (!picked) return this._noteUnassignedAbilities(name, ptOffer, choice.packages);
			picked.forEach(abv => bonuses[abv] = (bonuses[abv] || 0) + pkg.choose.amount);
		}

		if (!Object.keys(bonuses).length) return false;

		this._comp.applyAbilityBonuses(bonuses, {source: name});
		this._comp.clearPendingAbilityOffers(name);
		// The caller records it against the choice, so nothing asks again
		return true;
	}

	_noteUnassignedAbilities (name, ptOffer, packages = null) {
		this._comp.addPendingAbilityOffer({source: name, offer: ptOffer, packages});
	}

	/**
	 * Ability increases that were offered and skipped. Shown as something still to do rather than as
	 * a note in a box that never goes away: assigning one settles it, and so does dismissing it.
	 */
	_renderAbilityOffers () {
		const wrp = document.getElementById("cs-ability-offers");
		if (!wrp) return;
		wrp.innerHTML = "";

		(this._comp._state.pendingAbilityOffers || []).forEach(offer => {
			const box = document.createElement("div");
			box.className = "cs__offer no-print";
			box.innerHTML = `<div><span class="ve-bold">${offer.source.qq()}</span> grants <span class="ve-bold">${offer.offer.qq()}</span>, not yet assigned.</div>`;

			const actions = document.createElement("div");
			actions.className = "cs__offer-actions ve-flex-v-center";

			// Without the packages (an offer carried over from an older character) there is nothing to
			// walk, so the only honest options are to do it by hand and dismiss this
			if (offer.packages?.length) {
				const btnAssign = document.createElement("button");
				btnAssign.type = "button";
				btnAssign.className = "ve-btn ve-btn-xxs ve-btn-primary";
				btnAssign.textContent = "Assign now";
				btnAssign.addEventListener("click", () => this._pOnAssignPendingOffer(offer));
				actions.appendChild(btnAssign);
			}

			const btnDismiss = document.createElement("button");
			btnDismiss.type = "button";
			btnDismiss.className = "ve-btn ve-btn-xxs ve-btn-default";
			btnDismiss.textContent = offer.packages?.length ? "Dismiss" : "Done — dismiss";
			btnDismiss.title = "Remove this reminder; the scores are yours to set by hand";
			btnDismiss.addEventListener("click", () => this._comp.removePendingAbilityOffer(offer.id));
			actions.appendChild(btnDismiss);

			box.appendChild(actions);
			wrp.appendChild(box);
		});
	}

	async _pOnAssignPendingOffer (offer) {
		// Walking the choice again settles it on success, and re-records it on a cancel
		this._comp.removePendingAbilityOffer(offer.id);
		await this._pResolveAbilityChoice({packages: offer.packages}, offer.source);
		this._renderAbilityOffers();
	}

	async _onPickClass () {
		const classes = await CharacterSheetClassData.pGetAllClasses();
		if (!classes.length) return;
		const cls = await InputUiUtil.pGetUserEnum({
			values: classes,
			isResolveItem: true,
			fnDisplay: c => `${c.name} (${Parser.sourceJsonToAbv(c.source)})`,
			title: "Select Class",
			placeholder: "Select a class...",
		});
		if (cls == null) return;

		this._comp.applyPickedClass(cls, this._comp.getLevelNumber());
	}

	/** The wizard applies its own suggested HP, so suppress the per-level prompt while it runs. */
	async _pOnWizard () {
		this._suppressLevelPrompt += 1;
		try {
			await CharacterWizard.pShow({comp: this._comp, page: this});
		} finally {
			this._suppressLevelPrompt -= 1;
			this._lastLevel = this._comp.getLevelNumber();
		}
	}

	/**
	 * Render a rollable modifier. When `parts` is supplied, the element also carries a breakdown
	 * tooltip explaining where the number came from ("Dexterity +3, Proficiency +2 = +5").
	 */
	_renderRoll (id, mod, name, parts = null, {isTapTarget = true} = {}) {
		const ele = document.getElementById(id);
		if (!ele) return;
		ele.innerHTML = Renderer.get().render(`{@d20 ${mod}|${CharacterPageBase.fmtBonus(mod)}|${name}}`);
		// A rollable value swallows clicks (that is the roll), so its explanation is hover-only and
		// the tap target lives on the neighbouring label instead.
		CharacterPageBase.setBreakdownTitle(ele, name, parts, mod, {isTapTarget});
	}

	/**
	 * The spell save DC and attack bonus only mean anything once a spellcasting ability is set, so
	 * hide the pair for a character who has none rather than showing two em-dashes.
	 */
	static setSpellBadgesVisible (isVisible) {
		["cs-spell-dc", "cs-spell-atk"].forEach(id => {
			const badge = document.getElementById(id)?.closest(".cs__stat-badge");
			if (badge) badge.classList.toggle("ve-hidden", !isVisible);
		});
	}

	/**
	 * Attach a "where this comes from" explanation to an element: a `title` for desktop hover, and a
	 * tap/click popover for touch devices, where `title` never appears. Cleared when there is nothing
	 * to say.
	 */
	static setBreakdownTitle (ele, name, parts, total = null, {isTotalValue = false, isTapTarget = true, citeKind = null} = {}) {
		if (!ele) return;
		if (!parts?.length) {
			ele.removeAttribute("title");
			ele.classList.remove("cs__has-breakdown");
			delete ele.dataset.csBreakdown;
			CharacterPageBase._unmarkBreakdownTarget(ele);
			CharacterPageBase._BREAKDOWN_PARTS.delete(ele);
			return;
		}

		const text = `${name}: ${formatBreakdown(parts, total, {isTotalValue})}`;
		ele.setAttribute("title", text);
		// The roll link is rendered inside, and would otherwise show its own tooltip instead
		ele.querySelectorAll("[title]").forEach(child => child.removeAttribute("title"));

		if (!isTapTarget) return;
		ele.classList.add("cs__has-breakdown");
		ele.dataset.csBreakdown = text;
		CharacterPageBase._markBreakdownTarget(ele);
		// The popover needs the parts themselves, not the flattened line, so it can offer each one's
		// rule. Kept beside the element rather than serialised into a data attribute: the sheet
		// re-renders constantly, and a WeakMap lets the old entries go with the old nodes.
		CharacterPageBase._BREAKDOWN_PARTS.set(ele, {name, parts, total, isTotalValue, citeKind});
	}

	/* -------------------------------------------- Print / PDF -------------------------------------------- */

	/**
	 * Printing (and so "Save as PDF") needs two things CSS cannot do:
	 *
	 *  - a `textarea` prints only the lines its box shows, so its text is mirrored into a plain
	 *    element that flows and wraps;
	 *  - a closed `<details>` prints as its summary alone, so every feature card is opened.
	 *
	 * Both are undone afterwards, leaving the page as the player left it.
	 */
	_bindPrintPrep () {
		const onBefore = () => {
			document.querySelectorAll("#charsheet details").forEach(ele => {
				if (ele.open) return;
				ele.dataset.csReclose = "1";
				ele.open = true;
			});

			// A saves/skills panel with nothing marked is a heading with nothing under it
			document.querySelectorAll("#charsheet .cs__panel").forEach(panel => {
				const lists = panel.querySelectorAll(".cs__list");
				const isEmptyLists = lists.length && ![...lists].some(list => list.querySelector(".cs__prof--1, .cs__prof--2, .cs__list-cb:checked"));
				panel.classList.toggle("cs__panel--print-empty", !!isEmptyLists);
			});

			document.querySelectorAll("#charsheet textarea").forEach(ta => {
				let mirror = ta.nextElementSibling;
				if (!mirror?.classList?.contains("cs__print-text")) {
					mirror = document.createElement("div");
					mirror.className = "cs__print-text";
					ta.after(mirror);
				}
				mirror.textContent = ta.value;
				mirror.classList.toggle("cs__print-text--empty", !ta.value.trim());
			});
		};

		const onAfter = () => {
			document.querySelectorAll("#charsheet details[data-cs-reclose]").forEach(ele => {
				ele.open = false;
				delete ele.dataset.csReclose;
			});
		};

		window.addEventListener("beforeprint", onBefore);
		window.addEventListener("afterprint", onAfter);
		// Headless printing and "print to PDF" from our own button do not always fire `beforeprint`
		this._doPrintPrep = onBefore;
	}

	/** Print, having prepared the page for paper first. */
	_doPrint () {
		this._doPrintPrep?.();
		window.print();
	}

	/**
	 * One delegated listener for the whole page: tapping anything carrying a breakdown shows it in a
	 * dismissible popover. Delegation means it keeps working across the many re-renders, and costs
	 * nothing on elements that have no breakdown.
	 */
	_bindBreakdownPopovers () {
		document.addEventListener("click", evt => {
			// A rule button lives inside the popover, so handle it before the dismiss logic below
			const eleCite = evt.target.closest?.(".cs__cite-btn");
			if (eleCite) {
				evt.preventDefault();
				return CharacterPageBase._pShowCitation(eleCite);
			}

			const ele = evt.target.closest?.("[data-cs-breakdown]");
			if (!ele) {
				// Clicks inside the popover itself must not dismiss it
				if (evt.target.closest?.("#cs-breakdown-popover")) return;
				return CharacterPageBase._closeBreakdownPopover();
			}
			// Let rollable links roll; the popover is for the surrounding value
			if (evt.target.closest("a, button, input, select, textarea")) return;
			evt.preventDefault();
			CharacterPageBase._showBreakdownPopover(ele);
		});
		// The same thing from the keyboard. `Space` would otherwise scroll the page, so it is claimed
		// here; a rollable link inside keeps its own behaviour, as it does for a click.
		document.addEventListener("keydown", evt => {
			if (evt.key === "Escape") return CharacterPageBase._closeBreakdownPopover();
			if (evt.key !== "Enter" && evt.key !== " ") return;

			const ele = evt.target.closest?.("[data-cs-breakdown]");
			if (!ele || evt.target !== ele) return;

			evt.preventDefault();
			CharacterPageBase._showBreakdownPopover(ele);
		});

		// Scrolling away should dismiss it, since it is positioned against a spot on the page. But the
		// act of opening it can itself scroll — bringing the value into view first — and that trailing
		// event must not close what the same gesture just opened. Compare positions rather than
		// reacting to the event: a scroll that did not move the page is not a scroll away.
		window.addEventListener("scroll", () => {
			if (Math.abs(window.scrollY - CharacterPageBase._breakdownScrollY) <= 2) return;
			CharacterPageBase._closeBreakdownPopover();
		}, {passive: true});
	}

	/**
	 * Make a value that carries a breakdown behave like the control it already is.
	 *
	 * These are `<span>`s and `<div>`s opened by a click delegate, which made the whole "every number
	 * cites its rule" feature reachable by mouse and by nothing else. A role and a tab stop cost two
	 * attributes and hand it to the keyboard.
	 */
	static _markBreakdownTarget (ele) {
		ele.setAttribute("role", "button");
		ele.setAttribute("tabindex", "0");
		ele.setAttribute("aria-expanded", "false");
	}

	static _unmarkBreakdownTarget (ele) {
		["role", "tabindex", "aria-expanded"].forEach(attr => ele.removeAttribute(attr));
	}

	static _closeBreakdownPopover () {
		document.getElementById("cs-breakdown-popover")?.remove();
		document.querySelectorAll("[data-cs-breakdown][aria-expanded=\"true\"]")
			.forEach(ele => ele.setAttribute("aria-expanded", "false"));
	}

	static _showBreakdownPopover (ele) {
		CharacterPageBase._closeBreakdownPopover();
		CharacterPageBase._breakdownScrollY = window.scrollY;

		const pop = document.createElement("div");
		pop.id = "cs-breakdown-popover";
		pop.className = "cs__breakdown-pop";
		// Informational rather than a dialog: it takes no focus and demands no dismissal, so it is
		// announced where it stands rather than interrupting
		pop.setAttribute("role", "group");
		ele.setAttribute("aria-expanded", "true");
		const meta = CharacterPageBase._BREAKDOWN_PARTS.get(ele);
		if (meta) pop.appendChild(CharacterPageBase._getBreakdownBody(meta));
		else pop.textContent = ele.dataset.csBreakdown;
		document.body.appendChild(pop);

		const rect = ele.getBoundingClientRect();
		const popRect = pop.getBoundingClientRect();
		// Keep it on-screen: prefer below, flip above when there is no room
		const top = rect.bottom + popRect.height + 8 > window.innerHeight && rect.top > popRect.height + 8
			? rect.top - popRect.height - 6
			: rect.bottom + 6;
		const left = Math.max(6, Math.min(rect.left, window.innerWidth - popRect.width - 6));
		pop.style.top = `${top + window.scrollY}px`;
		pop.style.left = `${left + window.scrollX}px`;
	}

	/**
	 * The popover's contents: a row per contribution, and beside each the rule that lets it count.
	 * A part with no rule to point at is still listed — it just is not a button.
	 */
	static _getBreakdownBody ({name, parts, total, isTotalValue, citeKind}) {
		const wrp = document.createElement("div");

		const head = document.createElement("div");
		head.className = "cs__breakdown-head";
		head.textContent = total == null ? name : `${name} ${isTotalValue ? total : CharacterPageBase.fmtBonus(total)}`;
		wrp.appendChild(head);

		parts.forEach(part => {
			const row = document.createElement("div");
			row.className = "cs__breakdown-row";

			const lbl = document.createElement("span");
			lbl.className = "cs__breakdown-label";
			lbl.textContent = part.label;
			row.appendChild(lbl);

			if (!part.isText) {
				const val = document.createElement("span");
				val.className = "cs__breakdown-value";
				val.textContent = part.isRaw ? `${part.value}` : CharacterPageBase.fmtBonus(part.value);
				row.appendChild(val);
			}

			const cite = resolveCitation(part.cite);
			if (cite) row.appendChild(CharacterPageBase._getCiteButton(cite));
			wrp.appendChild(row);
		});

		// The rule for the number as a whole, when the parts have not already named it
		const ruleWhole = getBreakdownCitation(citeKind);
		if (ruleWhole && !getPartCitations(parts).some(it => isSameCitation(it, ruleWhole))) {
			const row = document.createElement("div");
			row.className = "cs__breakdown-row cs__breakdown-row--rule";
			const lbl = document.createElement("span");
			lbl.className = "cs__breakdown-label";
			lbl.textContent = "Rule";
			row.appendChild(lbl);
			row.appendChild(CharacterPageBase._getCiteButton(ruleWhole));
			wrp.appendChild(row);
		}

		return wrp;
	}

	static _getCiteButton (cite) {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "cs__cite-btn";
		btn.textContent = cite.name;
		btn.title = `Show the rule: ${cite.name}`;
		btn.dataset.citeName = cite.name;
		btn.dataset.citeSource = cite.source;
		btn.dataset.citePage = cite.page;
		return btn;
	}

	/**
	 * Show a cited rule's own text. This app ships the books, so the paragraph is right there in the
	 * data — no paraphrase, and the page number comes with it.
	 */
	static async _pShowCitation (btn) {
		const {citeName: name, citeSource: source, citePage: page} = btn.dataset;
		const {eleModalInner} = UiUtil.getShowModal({title: name, isHeaderBorder: true, isUncappedHeight: true});

		const wrp = document.createElement("div");
		wrp.className = "cs__cite-body";
		wrp.textContent = "Loading…";
		eleModalInner.appendChild(wrp);

		const ent = await CharacterPageBase._pLoadCitation({name, source, page});
		if (!ent) {
			wrp.textContent = `Could not find "${name}" in ${source}.`;
			return;
		}

		wrp.innerHTML = Renderer.get().setFirstSection(true).render({type: "entries", entries: ent.entries || []});

		const src = document.createElement("div");
		src.className = "cs__cite-source";
		src.textContent = ent.page
			? `${Parser.sourceJsonToFull(ent.source)}, p. ${ent.page}`
			: Parser.sourceJsonToFull(ent.source);
		wrp.appendChild(src);
	}

	static async _pLoadCitation ({name, source, page}) {
		const builder = UrlUtil.URL_TO_HASH_BUILDER[page];
		if (!builder) return null;
		const hash = builder({name, source});
		return DataLoader.pCacheAndGet(page, source, hash, {isCopy: true}).catch(() => null);
	}

	/* -------------------------------------------- Store controls (toolbar) -------------------------------------------- */

	_bindStoreControls () {
		this._bindClick("cs-btn-save", () => this._onSaveToFile());
		this._bindClick("cs-btn-load", () => this._onLoadFromFile());
		this._bindClick("cs-btn-print", () => this._doPrint());
		this._bindClick("cs-btn-reset", () => this._onReset());
		// Opens 5etools' own manager, so brew added here is the same brew every other page sees
		this._bindClick("cs-btn-homebrew", async () => {
			const {ManageBrewUi} = await import("../utils-brew/utils-brew-ui-manage.js");
			await ManageBrewUi.pDoManageBrew();
		});

		const sel = document.getElementById("cs-char-select");
		if (sel) sel.addEventListener("change", () => this._switchCharacter(sel.value));
		this._bindClick("cs-char-new", () => {
			this._persistNow();
			const id = CryptUtil.uid();
			this._store.characters[id] = null;
			this._switchCharacter(id);
			// The sidekick page creates sidekicks, the character pages create characters
			Object.entries(this._getNewCharacterState()).forEach(([prop, val]) => this._comp._state[prop] = val);
		});
		this._bindClick("cs-char-delete", () => this._onDeleteCharacter());
	}

	_bindClick (id, fn) {
		const ele = document.getElementById(id);
		if (ele) ele.addEventListener("click", fn);
	}

	/* -------------------------------------------- Store / persistence -------------------------------------------- */

	_initStore () {
		const rawStore = StorageUtil.syncGet(CharacterPageBase._SHARED_STORAGE_KEY) ??
			StorageUtil.syncGet(`${CharacterPageBase._LEGACY_STORAGE_KEY}_charactersheet.html`);
		this._store = getMigratedStore(rawStore) || getNewStore();

		// The stored "current" character may belong to another page; prefer one of ours
		const ownIds = Object.entries(this._store.characters)
			.filter(([, envelope]) => this._isCharacterListed(envelope?.state ?? envelope))
			.map(([id]) => id);
		const cur = this._store.characters[this._store.currentId];
		if (!this._isCharacterListed(cur?.state ?? cur) && ownIds.length) this._store.currentId = ownIds[0];

		const envelope = this._store.characters[this._store.currentId];
		if (envelope) this._doLoadState(envelope);
		else Object.entries(this._getNewCharacterState()).forEach(([prop, val]) => this._comp._state[prop] = val);
		this._onStoreLoaded();
		this._renderCharacterSelect();
	}

	/** Subclass hook after the initial character is loaded (e.g. ensure a default attack row). */
	_onStoreLoaded () {}

	_doLoadState (saved) {
		this._setLoading(true);
		try {
			const isApplied = this._comp.setStateFrom(saved);
			if (!isApplied) JqueryUtil.doToast({type: "danger", content: "Could not load character&mdash;unknown save format."});
		} finally {
			this._setLoading(false);
		}
		this._applySourceFilter();
		this._doRenderAll();
	}

	/**
	 * Push this character's source filter into the data layer, so the pickers only offer content from
	 * the books it allows. Lookups of content the character already has stay unfiltered.
	 */
	_applySourceFilter () {
		const filter = this._comp._state.sourceFilter;
		CharacterSheetClassData.setSourceFilter(
			getSourceFilterPredicate(filter, {isClassic: src => SourceUtil.isClassicSource(src)}),
		);
	}

	/** Whether a source may be picked under this character's filter. */
	_isSourceAllowed (source) {
		return isSourceAllowed(source, this._comp._state.sourceFilter, {isClassic: src => SourceUtil.isClassicSource(src)});
	}

	/* -------------------------------------------- Source filter UI -------------------------------------------- */

	_bindSourceFilter () {
		this._bindClick("cs-btn-sources", () => this._pOnEditSources());
		this._comp._addHookBase("sourceFilter", () => {
			this._applySourceFilter();
			this._renderSourceFilterLabel();
		});
		this._renderSourceFilterLabel();
	}

	_renderSourceFilterLabel () {
		const ele = document.getElementById("cs-sources-label");
		if (ele) ele.textContent = getSourceFilterLabel(this._comp._state.sourceFilter);
	}

	/** Every source that actually has character-relevant content, grouped for the picker. */
	async _pGetSelectableSources () {
		const [classes, subclasses, feats, spells, optFeatures] = await Promise.all([
			CharacterSheetClassData.pGetAllClassesUnfiltered(),
			CharacterSheetClassData.pGetAllSubclassesUnfiltered(),
			CharacterSheetClassData.pGetAllFeatsUnfiltered(),
			CharacterSheetClassData.pGetAllSpellsUnfiltered(),
			CharacterSheetClassData.pGetAllOptionalFeaturesUnfiltered(),
		]);
		const counts = new Map();
		[classes, subclasses, feats, spells, optFeatures]
			.flat()
			.forEach(it => { if (it?.source) counts.set(it.source, (counts.get(it.source) || 0) + 1); });

		return [...counts.entries()]
			.map(([source, count]) => ({
				source,
				count,
				name: Parser.sourceJsonToFull(source),
				abv: Parser.sourceJsonToAbv(source),
				group: SourceUtil.getFilterGroup(source),
				isClassic: SourceUtil.isClassicSource(source),
			}))
			.sort((a, b) => (a.group - b.group) || SortUtil.ascSortLower(a.name, b.name));
	}

	async _pOnEditSources () {
		const sources = await this._pGetSelectableSources();
		const cur = this._comp._state.sourceFilter || {mode: "all", sources: {}};
		// Working copy; only committed on Save
		const draft = {mode: cur.mode || "all", sources: {...(cur.sources || {})}};

		const {eleModalInner, doClose} = UiUtil.getShowModal({
			title: "Sources",
			isMinHeight0: true,
		});
		const wrp = document.createElement("div");
		wrp.className = "ve-flex-col";
		eleModalInner.appendChild(wrp);

		wrp.insertAdjacentHTML("beforeend", `<p class="ve-muted ve-small">Choose which books this character may pick content from. Anything already on the character keeps working, whatever you pick here.</p>`);

		// --- Presets ---
		const wrpModes = document.createElement("div");
		wrpModes.className = "ve-flex ve-flex-wrap ve-mb-2";
		wrp.appendChild(wrpModes);

		// --- Per-source checkboxes, grouped ---
		const wrpSources = document.createElement("div");
		wrpSources.className = "ve-flex-col";
		wrpSources.style.maxHeight = "45vh";
		wrpSources.style.overflowY = "auto";
		wrp.appendChild(wrpSources);

		const renderSources = () => {
			const isCustom = draft.mode === SOURCE_MODE_CUSTOM;
			wrpSources.innerHTML = "";
			if (!isCustom) {
				const allowed = sources.filter(it => isSourceAllowed(it.source, draft, {isClassic: s => SourceUtil.isClassicSource(s)}));
				wrpSources.innerHTML = `<div class="ve-muted ve-small">This preset allows <b>${allowed.length}</b> of ${sources.length} books. Switch to <b>Custom</b> to pick individual books.</div>`;
				return;
			}

			let lastGroup = null;
			sources.forEach(it => {
				if (it.group !== lastGroup) {
					lastGroup = it.group;
					const groupName = SourceUtil.getFilterGroupName(it.group) || "Standard";
					const hdr = document.createElement("div");
					hdr.className = "ve-flex-v-center ve-mt-1 ve-mb-1";
					hdr.innerHTML = `<span class="bold ve-small">${groupName.qq()}</span>`;
					const btnAll = document.createElement("button");
					btnAll.type = "button";
					btnAll.className = "ve-btn ve-btn-xxs ve-btn-default ve-ml-2";
					btnAll.textContent = "All";
					btnAll.addEventListener("click", () => {
						sources.filter(s => s.group === it.group).forEach(s => draft.sources[s.source] = true);
						renderSources();
					});
					const btnNone = document.createElement("button");
					btnNone.type = "button";
					btnNone.className = "ve-btn ve-btn-xxs ve-btn-default ve-ml-1";
					btnNone.textContent = "None";
					btnNone.addEventListener("click", () => {
						sources.filter(s => s.group === it.group).forEach(s => delete draft.sources[s.source]);
						renderSources();
					});
					hdr.append(btnAll, btnNone);
					wrpSources.appendChild(hdr);
				}

				const lbl = document.createElement("label");
				lbl.className = "ve-flex-v-center ve-small ve-mb-1";
				const cb = document.createElement("input");
				cb.type = "checkbox";
				cb.className = "ve-mr-2";
				cb.checked = !!draft.sources[it.source];
				cb.addEventListener("change", () => {
					if (cb.checked) draft.sources[it.source] = true;
					else delete draft.sources[it.source];
				});
				const spn = document.createElement("span");
				spn.innerHTML = `${it.name.qq()} <span class="ve-muted">(${it.abv.qq()}${it.isClassic ? ", 2014" : ""}; ${it.count} entries)</span>`;
				lbl.append(cb, spn);
				wrpSources.appendChild(lbl);
			});
		};

		SOURCE_MODES.forEach(({mode, name, desc}) => {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = `ve-btn ve-btn-xs ve-mr-1 ve-mb-1 ${draft.mode === mode ? "ve-btn-primary" : "ve-btn-default"}`;
			btn.textContent = name;
			btn.title = desc;
			btn.addEventListener("click", () => {
				// Switching to Custom seeds the boxes from whatever the current preset allows
				if (mode === SOURCE_MODE_CUSTOM && draft.mode !== SOURCE_MODE_CUSTOM) {
					draft.sources = {};
					sources
						.filter(it => isSourceAllowed(it.source, draft, {isClassic: s => SourceUtil.isClassicSource(s)}))
						.forEach(it => draft.sources[it.source] = true);
				}
				draft.mode = mode;
				[...wrpModes.children].forEach((el, ix) => {
					el.className = `ve-btn ve-btn-xs ve-mr-1 ve-mb-1 ${SOURCE_MODES[ix].mode === mode ? "ve-btn-primary" : "ve-btn-default"}`;
				});
				renderSources();
			});
			wrpModes.appendChild(btn);
		});

		renderSources();

		const wrpBtns = document.createElement("div");
		wrpBtns.className = "ve-flex-v-center ve-flex-h-right ve-mt-2";
		const btnSave = document.createElement("button");
		btnSave.type = "button";
		btnSave.className = "ve-btn ve-btn-sm ve-btn-primary";
		btnSave.textContent = "Save";
		btnSave.addEventListener("click", () => {
			this._comp.setSourceFilter(draft);
			doClose(true);
		});
		const btnCancel = document.createElement("button");
		btnCancel.type = "button";
		btnCancel.className = "ve-btn ve-btn-sm ve-btn-default ve-mr-2";
		btnCancel.textContent = "Cancel";
		btnCancel.addEventListener("click", () => doClose(false));
		wrpBtns.append(btnCancel, btnSave);
		wrp.appendChild(wrpBtns);
	}

	/** Picks the character already has that fall outside its current filter (never hidden, just flagged). */
	_getOutOfFilterPicks () {
		return getOutOfFilterSources(this._comp._getState(), this._comp._state.sourceFilter, {
			isClassic: src => SourceUtil.isClassicSource(src),
		});
	}

	_saveStateDebounced () {
		if (this._saveTimer) clearTimeout(this._saveTimer);
		this._saveTimer = setTimeout(() => this._persistNow(), 150);
	}

	_persistNow () {
		if (this._saveTimer) {
			clearTimeout(this._saveTimer);
			this._saveTimer = null;
		}
		this._store.characters[this._store.currentId] = this._comp.getSaveableState();
		StorageUtil.syncSet(CharacterPageBase._SHARED_STORAGE_KEY, this._store);
		this._renderCharacterSelect();
		this._queueSyncPush(this._store.currentId);
	}

	/**
	 * Characters and sidekicks live in one store but are edited on different pages, so each page's
	 * switcher lists only its own kind. The current character is always listed, whatever it is —
	 * hiding what is on screen would be worse than showing something unexpected.
	 */
	_isCharacterListed () { return true; }

	/** State to seed onto a character created on this page. */
	_getNewCharacterState () { return {}; }

	_getListedCharacterIds () {
		return Object.entries(this._store.characters)
			.filter(([id, envelope]) => id === this._store.currentId || this._isCharacterListed(envelope?.state ?? envelope))
			.map(([id]) => id);
	}

	_renderCharacterSelect () {
		const sel = document.getElementById("cs-char-select");
		if (!sel) return;
		sel.innerHTML = this._getListedCharacterIds()
			.map(id => `<option value="${id.qq()}">${getCharacterLabel(id === this._store.currentId ? this._comp.getSaveableState() : this._store.characters[id]).qq()}</option>`)
			.join("");
		sel.value = this._store.currentId;
	}

	_switchCharacter (id, {isSkipPersist = false} = {}) {
		if (!(id in this._store.characters)) return;
		if (!isSkipPersist && id !== this._store.currentId) this._persistNow();
		this._store.currentId = id;

		const envelope = this._store.characters[id];
		this._setLoading(true);
		try {
			this._comp._setState(this._comp._getDefaultState());
		} finally {
			this._setLoading(false);
		}
		if (envelope) this._doLoadState(envelope);
		else this._doRenderAll();
		this._onStoreLoaded();
		this._persistNow();
	}

	async _onDeleteCharacter () {
		if (!await InputUiUtil.pGetUserBoolean({
			title: "Delete Character",
			htmlDescription: `<div>Delete <b>${getCharacterLabel(this._comp.getSaveableState()).qq()}</b>?<br>This cannot be undone.</div>`,
			textYes: "Delete",
			textNo: "Cancel",
		})) return;

		delete this._store.characters[this._store.currentId];
		// The remembered online version goes with it; an online copy that survives can still be pulled
		deleteSyncMeta(this._store, this._store.currentId);
		const remaining = Object.entries(this._store.characters)
			.filter(([, envelope]) => this._isCharacterListed(envelope?.state ?? envelope))
			.map(([id]) => id);
		if (!remaining.length) {
			const id = CryptUtil.uid();
			this._store.characters[id] = null;
			remaining.push(id);
		}
		this._switchCharacter(remaining[0], {isSkipPersist: true});
	}

	/* -------------------------------------------- File / reset -------------------------------------------- */

	_onSaveToFile () {
		const name = (this._comp._state.name || "character").trim() || "character";
		DataUtil.userDownload(Parser.stringToSlug(name) || "character", this._comp.getSaveableState(), {fileType: CharacterPageBase._FILE_TYPE});
	}

	async _onLoadFromFile () {
		const {jsons, errors} = await InputUiUtil.pGetUserUploadJson({expectedFileTypes: [CharacterPageBase._FILE_TYPE]});
		DataUtil.doHandleFileLoadErrorsGeneric(errors);
		if (!jsons?.length) return;
		this._doLoadState(jsons[0]);
		this._onStoreLoaded();
		this._persistNow();
	}

	async _onReset () {
		if (!await InputUiUtil.pGetUserBoolean({
			title: "Reset Character",
			htmlDescription: `<div>This will clear the current character's sheet (other characters are kept).<br>Are you sure?</div>`,
			textYes: "Reset",
			textNo: "Cancel",
		})) return;

		this._setLoading(true);
		try {
			this._comp._setState(this._comp._getDefaultState());
		} finally {
			this._setLoading(false);
		}
		this._onStoreLoaded();
		this._doRenderAll();
		this._persistNow();
	}

	/* -------------------------------------------- Level-up prompt -------------------------------------------- */

	async _pMaybePromptLevelUp () {
		const newLevel = this._comp.getLevelNumber();
		const prevLevel = this._lastLevel;
		this._lastLevel = newLevel;

		if (this._isLoading || this._suppressLevelPrompt > 0 || newLevel <= prevLevel) return;

		for (let lvl = prevLevel + 1; lvl <= newLevel; ++lvl) this._comp.logJournal(EV_LEVEL, {v: lvl});

		const primary = this._comp._state.classes.find(c => c.hdFaces);
		if (!primary) return;

		// What this level actually gains, shown before anything is committed — and a way out that
		// leaves the character as it was. Every sheet walks you through a level-up; none says what the
		// outcome will be first, so the only way to find out has been to do it and look.
		if (!await this._pConfirmLevelUp({prevLevel, newLevel})) {
			this._suppressLevelPrompt += 1;
			try {
				this._comp._state.level = prevLevel;
			} finally {
				this._suppressLevelPrompt -= 1;
				this._lastLevel = prevLevel;
			}
			return;
		}

		const faces = primary.hdFaces;
		const numLevels = newLevel - prevLevel;
		const conMod = Parser.getAbilityModNumber(Number(this._comp._state.abil_con) || 10);

		const avgTotal = getLevelUpHp({faces, conMod, numLevels}).total;
		const maxTotal = numLevels * Math.max(1, faces + conMod);
		const rollTotal = () => getLevelUpHp({faces, conMod, numLevels, fnRoll: f => Math.floor(Math.random() * f) + 1}).total;

		const applyGain = gained => {
			this._comp._state.hpMax = (Number(this._comp._state.hpMax) || 0) + gained;
			this._comp._state.hpCur = (Number(this._comp._state.hpCur) || 0) + gained;
			JqueryUtil.doToast({type: "success", content: `Gained ${gained} HP (now level ${newLevel}).`});
		};

		// A saved HP policy applies automatically; "ask" (the default) prompts each level-up.
		const policy = this._comp._state.hpPolicy || "ask";
		if (policy === "average") return applyGain(avgTotal);
		if (policy === "max") return applyGain(maxTotal);
		// Rolling is the one policy where the answer is not the sheet's to give: the dice are on the
		// table. So it asks for what was rolled — the raw dice — and adds Constitution itself
		if (policy === "roll") return this._pApplyRolledHp({faces, conMod, numLevels, applyGain});

		const optAvg = `Add average (+${avgTotal} HP)`;
		const optMax = `Add max (+${maxTotal} HP)`;
		const ptConMod = conMod ? ` ${conMod > 0 ? "+" : "−"} ${Math.abs(conMod)} per level` : "";
		const optRoll = `Roll ${numLevels}d${faces}${ptConMod}`;
		const optSkip = "Enter manually / skip";

		const choice = await InputUiUtil.pGetUserEnum({
			values: [optAvg, optMax, optRoll, optSkip],
			isResolveItem: true,
			title: `Level up to ${newLevel}${numLevels > 1 ? ` (+${numLevels} levels)` : ""}`,
			placeholder: "How do you want to gain HP?",
		});
		if (choice == null || choice === optSkip) return;

		if (choice === optRoll) return this._pApplyRolledHp({faces, conMod, numLevels, applyGain});
		applyGain(choice === optMax ? maxTotal : avgTotal);
	}

	/**
	 * Show what the new level brings, and let it be waved off.
	 *
	 * Reports only: `getLevelUpPreview` derives the diff and writes nothing, so declining here leaves
	 * the character untouched apart from the level being put back.
	 *
	 * @return {boolean} whether to go ahead.
	 */
	async _pConfirmLevelUp ({prevLevel, newLevel}) {
		const loaded = await CharacterSheetClassData.pGetLoadedClasses(this._comp._state.classes).catch(() => []);
		// The class whose level moved — with one class that is the only one; with several, the primary
		const meta = loaded.find(it => it.entry?.hdFaces) || loaded[0];
		if (!meta?.cls) return true;

		const state = this._comp._getState();
		const abv = meta.cls.spellcastingAbility;
		const preview = getLevelUpPreview({
			cls: meta.cls,
			sc: meta.sc,
			levelFrom: prevLevel,
			levelTo: newLevel,
			conMod: Parser.getAbilityModNumber(Number(state.abil_con) || 10),
			hpPerLevel: getHpBonusPerLevel(state),
			abilityMod: abv ? Parser.getAbilityModNumber(Number(state[`abil_${abv}`]) || 10) : 0,
		});

		// Nothing worth reading means nothing worth interrupting for
		if (!preview.lines.length && !preview.decisions.length) return true;

		const fmt = ({label, detail}) => `<li>${label.qq()}${detail ? ` <span class="ve-muted">(${detail.qq()})</span>` : ""}</li>`;
		const htmlDescription = `
			<div class="ve-flex-col">
				<div class="bold ve-mb-1">Level ${prevLevel} &rarr; ${newLevel}</div>
				${preview.lines.length ? `<div class="ve-small">You gain:</div><ul class="ve-small ve-mb-2">${preview.lines.map(fmt).join("")}</ul>` : ""}
				${preview.decisions.length ? `<div class="ve-small">You will then choose:</div><ul class="ve-small">${preview.decisions.map(fmt).join("")}</ul>` : ""}
			</div>`;

		return !!await InputUiUtil.pGetUserBoolean({
			title: `Level up to ${newLevel}?`,
			htmlDescription,
			textYes: "Level up",
			textNo: "Cancel",
		});
	}

	/**
	 * Hit points from dice that were actually rolled.
	 *
	 * A sheet that rolls for you is fine until somebody rolls at the table, which is the usual case:
	 * then the number it invented is simply wrong. So this asks for the dice — *just* the dice — and
	 * does the rest itself: Constitution per level, the floor of 1 per level that the rules impose,
	 * and anything else that adds hit points per level. Pre-filled with a roll of its own, so
	 * accepting it is one click for anybody who did not roll their own.
	 *
	 * @param applyGain adds the total to max and current HP, and says so.
	 */
	async _pApplyRolledHp ({faces, conMod, numLevels, applyGain}) {
		const suggested = getLevelUpHp({faces, conMod: 0, numLevels, fnRoll: f => Math.floor(Math.random() * f) + 1}).total;
		const perLevelBonus = getHpBonusPerLevel(this._comp._getState());

		const ptCon = conMod ? `, ${conMod > 0 ? "+" : "−"}${Math.abs(conMod)} Constitution per level` : "";
		const ptBonus = perLevelBonus ? `, +${perLevelBonus} per level from feats` : "";

		// The prompt has to say what it will do with the number, or it invites the *total* instead
		const elePre = document.createElement("div");
		elePre.className = "ve-small ve-mb-2";
		elePre.textContent = `Enter what you rolled on ${numLevels}d${faces} — the dice alone${ptCon}${ptBonus} is added for you.`;

		const rolled = await InputUiUtil.pGetUserNumber({
			title: `Rolled hit points (${numLevels}d${faces})`,
			default: suggested,
			min: numLevels,
			max: numLevels * faces,
			int: true,
			elePre,
		});
		if (rolled == null) return;

		// The dice are added exactly as rolled — dividing them per level and rounding would invent hit
		// points nobody rolled. Constitution and any per-level feat bonus are added once per level,
		// and the rules' floor of 1 hit point per level is applied to the whole
		const dice = Math.max(0, Number(rolled) || 0);
		const total = Math.max(numLevels, dice + numLevels * (conMod + perLevelBonus));
		applyGain(total);
	}
}

globalThis.CharacterPageBase = CharacterPageBase;
