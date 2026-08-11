/**
 * The seam an account system plugs into — and nothing more.
 *
 * The account system itself (OIDC login against Authentik, sessions, character storage) lives in a
 * **separate repository**, deployed behind the same subdomain on its own path by a reverse proxy.
 * This fork holds only the contract and the wiring, so that:
 *
 *  - the four shared upstream files stay four — nothing here touches them;
 *  - every later sync feature ships from the other repo, with no change to 5etools-src at all;
 *  - with no account system deployed, the pages behave exactly as they always have. That is not a
 *    fallback but a supported deployment: the GitHub Pages build is static, with no proxy in front.
 *
 * ## How it connects
 *
 * The account app serves a small client script at `<base>/client.js`. That script defines
 * `window.CharacterSyncAdapter`. The pages load it during `pInit`; if it is missing, or 404s, or
 * defines nothing valid, sync simply never turns on.
 *
 * Because everything is same-origin, the browser's own session cookie authenticates each call:
 * the client never sees or stores a credential, and there is no CORS to configure.
 *
 * ## The adapter contract
 *
 * ```js
 * window.CharacterSyncAdapter = {
 *   pWhoAmI (),                          // → {id, name} | null   (null = not signed in)
 *   pList   (),                          // → [{id, name, version, updatedAt}]
 *   pLoad   (id),                        // → {envelope, version}
 *   pSave   (id, envelope, {version}),   // → {version}            (throws SyncConflictError on 409)
 *   pDelete (id),                        // → void
 *   getLoginUrl (),                      // → string, where to send someone to sign in
 *   getLogoutUrl ()?,                    // → string, optional
 *   getCapabilities ()?,                 // → {characters: boolean}, optional; assumed true
 *
 *   // Campaigns — all optional, and all present or all absent. A service without them simply has
 *   // no tables, and the pages show no campaign UI at all.
 *   pListCampaigns (),                   // → [{id, name, role, isPartyVisible}]
 *   pCreateCampaign (name),              // → {id, name, role}
 *   pJoinCampaign (code),                // → {id, name, role}
 *   pCreateInvite (campaignId, opts),    // → {code, role, maxUses, expiresAt}
 *   pListCampaignCharacters (campaignId),// → [{id, name, ownerName, isMine, ...}]
 *   pSetCharacterCampaign (id, campaignId), // → void   (null to take it off a table)
 *
 *   // History — optional as a set, same reasoning
 *   pListVersions (id),                  // → {versions: [{version, createdAt}], current}
 *   pLoadVersion (id, version),          // → {envelope, version, createdAt}
 *   pRestoreVersion (id, version),       // → {version}   (writes forward; never rewinds)
 *
 *   // Sharing — optional as a set
 *   pGetShare (id),                      // → {share: {token, url, expiresAt}|null}
 *   pCreateShare (id, {expiresInHours}), // → {share}      (replaces any existing link)
 *   pRevokeShare (id),                   // → void
 * }
 * ```
 *
 * `envelope` is the existing save-file envelope, unchanged — an export is therefore a valid upload,
 * and there is no second schema to keep in step.
 *
 * This module is DOM-free apart from reading the configured path off the document, and is tested.
 */

/** Where the account system is mounted, unless the deployment says otherwise. */
export const SYNC_PATH_DEFAULT = "/online";

/** The meta tag a deployment (or the reverse proxy, or the image) can set to move it. */
export const SYNC_PATH_META = "character-sync-path";

/** Set this to an empty string to switch sync off outright, whatever else is configured. */
const _isDisabled = value => value === "" || value === "off" || value === "none";

/**
 * Normalise a configured path: leading slash, no trailing one, so joining is unambiguous.
 * @return {string|null} null when sync is switched off.
 */
export function normaliseSyncPath (raw) {
	if (raw == null) return null;
	const str = String(raw).trim();
	if (_isDisabled(str)) return null;

	// An absolute URL is allowed, but loses the same-origin cookie — the caller is told, not stopped
	if (/^https?:\/\//i.test(str)) return str.replace(/\/+$/, "");

	const withLead = str.startsWith("/") ? str : `/${str}`;
	const trimmed = withLead.replace(/\/+$/, "");
	return trimmed || null;
}

/** Whether a base path will carry the session cookie — i.e. whether it is same-origin. */
export function isSameOrigin (basePath) {
	return !!basePath && !/^https?:\/\//i.test(basePath);
}

/**
 * Where the account system is mounted, most specific source first:
 *   1. `window.CHARACTER_SYNC_PATH`  — set by a `config.js` the image can drop in
 *   2. `<meta name="character-sync-path" content="…">` — set in the page or by the proxy
 *   3. `/online`
 */
export function getSyncBasePath ({win = typeof window !== "undefined" ? window : null, doc = typeof document !== "undefined" ? document : null} = {}) {
	if (win && Object.prototype.hasOwnProperty.call(win, "CHARACTER_SYNC_PATH")) {
		return normaliseSyncPath(win.CHARACTER_SYNC_PATH);
	}
	const meta = doc?.querySelector?.(`meta[name="${SYNC_PATH_META}"]`);
	if (meta) return normaliseSyncPath(meta.getAttribute("content"));
	return normaliseSyncPath(SYNC_PATH_DEFAULT);
}

/** The script the account app serves, which defines the adapter. */
export function getSyncClientUrl (basePath) {
	return basePath ? `${basePath}/client.js` : null;
}

/** The endpoints the adapter is expected to talk to, for documentation and for the other repo. */
export function getSyncEndpoints (basePath) {
	if (!basePath) return null;
	return {
		whoami: `${basePath}/api/whoami`,
		login: `${basePath}/login`,
		logout: `${basePath}/logout`,
		characters: `${basePath}/api/characters`,
		character: id => `${basePath}/api/characters/${encodeURIComponent(id)}`,
	};
}

const _ADAPTER_METHODS = ["pWhoAmI", "pList", "pLoad", "pSave", "pDelete"];

/**
 * The campaign half of the contract.
 *
 * Optional as a *set*: an adapter either does tables or it does not, and a half-set would give the
 * pages a campaign list with no way to join one. Absent is a perfectly good answer — it is what
 * every deployment had until tables existed.
 */
const _ADAPTER_CAMPAIGN_METHODS = [
	"pListCampaigns",
	"pCreateCampaign",
	"pJoinCampaign",
	"pCreateInvite",
	"pListCampaignCharacters",
	"pSetCharacterCampaign",
];

export const hasCampaignSupport = adapter =>
	!!adapter && _ADAPTER_CAMPAIGN_METHODS.every(fn => typeof adapter[fn] === "function");

/** Sharing: a link somebody can be sent, and the means to take it back. Both, or neither. */
const _ADAPTER_SHARE_METHODS = ["pGetShare", "pCreateShare", "pRevokeShare"];

export const hasShareSupport = adapter =>
	!!adapter && _ADAPTER_SHARE_METHODS.every(fn => typeof adapter[fn] === "function");

/** History, likewise all-or-nothing: listing versions with no way to restore one is a tease. */
const _ADAPTER_HISTORY_METHODS = ["pListVersions", "pLoadVersion", "pRestoreVersion"];

export const hasHistorySupport = adapter =>
	!!adapter && _ADAPTER_HISTORY_METHODS.every(fn => typeof adapter[fn] === "function");

/**
 * Whether what turned up is usable. A half-implemented adapter is worse than none: it would take
 * the storage path over and then fail partway, so anything incomplete is refused outright.
 */
export function isAdapterValid (adapter) {
	if (!adapter || typeof adapter !== "object") return false;
	return _ADAPTER_METHODS.every(fn => typeof adapter[fn] === "function");
}

/** Which methods an otherwise plausible adapter is missing, so the reason can be reported. */
export function getMissingAdapterMethods (adapter) {
	if (!adapter || typeof adapter !== "object") return [..._ADAPTER_METHODS];
	return _ADAPTER_METHODS.filter(fn => typeof adapter[fn] !== "function");
}

/**
 * What an adapter says it can actually do today.
 *
 * Defining the five methods only proves an adapter has the right *shape*. An account system that is
 * still being built can be honestly connected — sign-in working — while character storage is not
 * open yet, and it should be able to say so rather than accept a save and fail. An adapter that
 * says nothing is taken at its word that everything works, which is the older contract unchanged.
 *
 * @return {{characters: boolean}}
 */
export function getSyncCapabilities (adapter) {
	let declared = null;
	try {
		declared = typeof adapter?.getCapabilities === "function" ? adapter.getCapabilities() : adapter?.capabilities;
	} catch (e) {
		declared = null;
	}
	return {
		characters: declared?.characters !== false,
		// Judged by what the adapter can actually do, not by what it claims: a service that says
		// `campaigns: true` without the methods would give the pages a table nobody could join
		campaigns: hasCampaignSupport(adapter) && declared?.campaigns !== false,
		history: hasHistorySupport(adapter) && declared?.history !== false,
		sharing: hasShareSupport(adapter) && declared?.sharing !== false,
	};
}

/**
 * The state of the connection, as something a badge can render and a person can read.
 *
 * Pure, and deliberately given plain facts rather than the adapter itself: the page gathers what it
 * knows (did the script load, is anything missing, who does the server say we are, what went wrong)
 * and this decides what that amounts to. `kind` is the whole answer; `lines` is what the popover
 * shows when it is clicked.
 *
 * `off` means show nothing at all. No account system deployed is the ordinary state of this repo —
 * a static build has no proxy in front of it — and decorating that page with a red badge would be
 * reporting the absence of a feature as a fault.
 */
export const SYNC_STATUS_KINDS = ["off", "error", "signedOut", "signedIn"];

export function getSyncStatus ({basePath = null, isLoaded = false, missingMethods = [], user = null, error = null, capabilities = null, pending = 0, isSaving = false} = {}) {
	const lines = [];
	if (basePath) lines.push({label: "Account system", value: basePath});

	if (!basePath || !isLoaded) return {kind: "off", label: "", tone: "", title: "", lines, canSignIn: false, canSignOut: false};

	if (missingMethods.length) {
		return {
			kind: "error",
			label: "Offline",
			tone: "bad",
			title: "The account system answered, but cannot be used",
			lines: [...lines, {label: "Problem", value: `the adapter is missing ${missingMethods.join(", ")}`}],
			canSignIn: false,
			canSignOut: false,
		};
	}

	if (error) {
		return {
			kind: "error",
			label: "Offline",
			tone: "bad",
			title: "The account system could not be reached",
			lines: [...lines, {label: "Error", value: String(error?.message || error)}],
			canSignIn: false,
			canSignOut: false,
		};
	}

	// Connected but not yet storing characters: say so plainly, or "online" would be a promise the
	// service has not made
	const isCharacters = capabilities?.characters !== false;
	const limited = isCharacters
		? []
		: [{label: "Characters", value: "not stored online yet — this browser is still the only copy"}];

	if (!user) {
		return {
			kind: "signedOut",
			label: "Signed out",
			tone: "warn",
			title: "An account system is connected, but nobody is signed in",
			lines: [...lines, ...limited],
			canSignIn: true,
			canSignOut: false,
		};
	}

	// Work still on its way up is the one thing worth saying instead of the name: closing the laptop
	// on an unsaved character is exactly what the badge is there to prevent
	const work = isSaving ? "Saving…" : (pending > 0 ? `Unsaved (${pending})` : null);

	return {
		kind: "signedIn",
		label: work || (user.name ? `Online — ${user.name}` : "Online"),
		tone: work && !isSaving ? "warn" : (isCharacters ? "ok" : "warn"),
		title: "Signed in to the account system",
		lines: [
			...lines,
			{label: "Signed in as", value: user.name || user.id || "(unnamed)"},
			...(user.role ? [{label: "Role", value: user.role}] : []),
			...(pending > 0 ? [{label: "Waiting to save", value: `${pending} character${pending === 1 ? "" : "s"}`}] : []),
			...limited,
		],
		canSignIn: false,
		canSignOut: true,
		pending,
		isSaving,
	};
}

/**
 * Raised by an adapter when the server holds a newer version than the one being written. Characters
 * are single-writer in practice, so the answer is to ask which to keep rather than to merge.
 */
export class SyncConflictError extends Error {
	constructor (message, {serverVersion = null, serverEnvelope = null} = {}) {
		super(message || "This character was changed elsewhere.");
		this.name = "SyncConflictError";
		this.serverVersion = serverVersion;
		this.serverEnvelope = serverEnvelope;
	}
}

export const isSyncConflict = err => err?.name === "SyncConflictError";

/* -------------------------------------------- Push and pull -------------------------------------------- */

/**
 * What the browser remembers about a character's online copy.
 *
 * Only the version it last agreed with. That single number is what makes a save able to say "I am
 * replacing version 4" and so what turns two devices editing one character into a question instead
 * of a silent loss. It lives beside the characters in the same store, keyed by the same id, because
 * a character and its version have to travel together.
 */
export const getSyncMeta = (store, id) => store?.syncMeta?.[id] || null;

export function setSyncMeta (store, id, meta) {
	if (!store) return store;
	store.syncMeta = store.syncMeta || {};
	store.syncMeta[id] = {...meta};
	return store;
}

export function deleteSyncMeta (store, id) {
	if (store?.syncMeta) delete store.syncMeta[id];
	return store;
}

/**
 * Line up what is in this browser against what is on the server.
 *
 * Deliberately does *not* try to work out which side is newer. There is no clock worth trusting
 * across two devices and a server, and a wrong guess here would overwrite somebody's evening. The
 * page offers the two directions and lets a person choose; `where` is the whole of the state.
 *
 * @return rows sorted by name — `where` is `"both"`, `"local"` (not uploaded yet) or `"online"`
 *         (not in this browser).
 */
export function planSync ({localCharacters = {}, remote = [], syncMeta = {}, fnLabel = () => "Unnamed Character"} = {}) {
	const byId = new Map();

	Object.entries(localCharacters).forEach(([id, envelope]) => {
		byId.set(id, {
			id,
			name: fnLabel(envelope),
			where: "local",
			localVersion: syncMeta?.[id]?.version ?? null,
			remoteVersion: null,
			isSidekick: !!(envelope?.state?.isSidekick),
		});
	});

	(remote || []).forEach(entry => {
		const row = byId.get(entry.id);
		if (row) {
			row.where = "both";
			row.remoteVersion = entry.version;
			// The server's label wins for a character that is only online; locally the store's is fresher
			return;
		}
		byId.set(entry.id, {
			id: entry.id,
			name: entry.name || "Unnamed Character",
			where: "online",
			localVersion: null,
			remoteVersion: entry.version,
			isSidekick: !!entry.isSidekick,
		});
	});

	return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Characters this browser has that the server has never seen — what a first sign-in offers to upload. */
export const getUnsyncedRows = rows => (rows || []).filter(it => it.where === "local");

/**
 * The name a "keep both" copy takes.
 *
 * Keeping both is the safety valve under every conflict, so it has to produce something a person can
 * tell apart at a glance in a character list, and it must not stack up suffixes on a second round.
 */
export function getKeptBothName (name) {
	const base = String(name || "Unnamed Character").replace(/ \(this device(?: \d+)?\)$/, "");
	return `${base} (this device)`;
}
