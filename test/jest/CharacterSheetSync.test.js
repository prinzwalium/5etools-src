import {describe, expect, it} from "@jest/globals";
import {
	SYNC_PATH_DEFAULT,
	SYNC_PATH_META,
	SyncConflictError,
	getMissingAdapterMethods,
	getSyncBasePath,
	getSyncCapabilities,
	getSyncClientUrl,
	getSyncEndpoints,
	getSyncStatus,
	getKeptBothName,
	getSyncMeta,
	getUnsyncedRows,
	hasGmWriteSupport,
	hasSidekickControlSupport,
	planSync,
	setSyncMeta,
	isAdapterValid,
	isSameOrigin,
	isSyncConflict,
	normaliseSyncPath,
} from "../../js/charactersheet/charactersheet-sync.js";

/** A document stub with (or without) the configuration meta tag. */
const mkDoc = content => ({
	querySelector: sel => sel === `meta[name="${SYNC_PATH_META}"]` && content !== undefined
		? {getAttribute: () => content}
		: null,
});

const mkAdapter = (overrides = {}) => ({
	pWhoAmI: () => null,
	pList: () => [],
	pLoad: () => null,
	pSave: () => null,
	pDelete: () => null,
	...overrides,
});

describe("Character Sheet — the account-system seam", () => {
	describe("normaliseSyncPath", () => {
		it("Should add the leading slash and drop a trailing one", () => {
			expect(normaliseSyncPath("online")).toBe("/online");
			expect(normaliseSyncPath("/online/")).toBe("/online");
			expect(normaliseSyncPath("  /online  ")).toBe("/online");
		});

		it("Should keep a nested path intact", () => {
			expect(normaliseSyncPath("/tools/online")).toBe("/tools/online");
		});

		it("Should allow an absolute URL, for a deployment that is not behind the same proxy", () => {
			expect(normaliseSyncPath("https://accounts.example.com/")).toBe("https://accounts.example.com");
		});

		// A deployment must be able to say "no account system", not just "somewhere else"
		it("Should treat an empty or explicit off value as switched off", () => {
			expect(normaliseSyncPath("")).toBeNull();
			expect(normaliseSyncPath("   ")).toBeNull();
			expect(normaliseSyncPath("off")).toBeNull();
			expect(normaliseSyncPath("none")).toBeNull();
			expect(normaliseSyncPath("/")).toBeNull();
			expect(normaliseSyncPath(null)).toBeNull();
		});
	});

	describe("getSyncBasePath", () => {
		it("Should default to /online when nothing is configured", () => {
			expect(getSyncBasePath({win: {}, doc: mkDoc(undefined)})).toBe("/online");
			expect(SYNC_PATH_DEFAULT).toBe("/online");
		});

		it("Should take the meta tag over the default", () => {
			expect(getSyncBasePath({win: {}, doc: mkDoc("/accounts")})).toBe("/accounts");
		});

		it("Should take the window variable over the meta tag", () => {
			expect(getSyncBasePath({win: {CHARACTER_SYNC_PATH: "/from-config"}, doc: mkDoc("/from-meta")}))
				.toBe("/from-config");
		});

		it("Should let either source switch sync off entirely", () => {
			expect(getSyncBasePath({win: {CHARACTER_SYNC_PATH: ""}, doc: mkDoc("/accounts")})).toBeNull();
			expect(getSyncBasePath({win: {}, doc: mkDoc("")})).toBeNull();
		});
	});

	describe("Derived URLs", () => {
		it("Should put the client script under the configured path", () => {
			expect(getSyncClientUrl("/online")).toBe("/online/client.js");
			expect(getSyncClientUrl("/tools/accounts")).toBe("/tools/accounts/client.js");
		});

		it("Should have no client to load when sync is off", () => {
			expect(getSyncClientUrl(null)).toBeNull();
			expect(getSyncEndpoints(null)).toBeNull();
		});

		it("Should hang every endpoint off the same base", () => {
			const eps = getSyncEndpoints("/online");
			expect(eps.whoami).toBe("/online/api/whoami");
			expect(eps.login).toBe("/online/login");
			expect(eps.characters).toBe("/online/api/characters");
			expect(eps.character("abc")).toBe("/online/api/characters/abc");
		});

		it("Should escape an id rather than paste it into the URL", () => {
			expect(getSyncEndpoints("/online").character("a b/c")).toBe("/online/api/characters/a%20b%2Fc");
		});
	});

	// Same-origin is the whole point: it is what lets the session cookie authenticate each call
	describe("isSameOrigin", () => {
		it("Should be true for a path, false for another origin", () => {
			expect(isSameOrigin("/online")).toBe(true);
			expect(isSameOrigin("https://accounts.example.com")).toBe(false);
			expect(isSameOrigin(null)).toBe(false);
		});
	});

	describe("isAdapterValid", () => {
		it("Should accept an adapter implementing the whole contract", () => {
			expect(isAdapterValid(mkAdapter())).toBe(true);
			expect(getMissingAdapterMethods(mkAdapter())).toEqual([]);
		});

		// Half an adapter would take storage over and then fail partway — worse than none at all
		it("Should refuse one that is missing a method, and say which", () => {
			const partial = mkAdapter();
			delete partial.pSave;
			delete partial.pDelete;
			expect(isAdapterValid(partial)).toBe(false);
			expect(getMissingAdapterMethods(partial)).toEqual(["pSave", "pDelete"]);
		});

		it("Should refuse anything that is not an object of functions", () => {
			expect(isAdapterValid(null)).toBe(false);
			expect(isAdapterValid("yes")).toBe(false);
			expect(isAdapterValid({pWhoAmI: "not a function"})).toBe(false);
			expect(getMissingAdapterMethods(null)).toHaveLength(5);
		});
	});

	describe("SyncConflictError", () => {
		it("Should carry what the server holds, so the user can be asked which to keep", () => {
			const err = new SyncConflictError("changed elsewhere", {serverVersion: 7, serverEnvelope: {name: "Theirs"}});
			expect(isSyncConflict(err)).toBe(true);
			expect(err.serverVersion).toBe(7);
			expect(err.serverEnvelope.name).toBe("Theirs");
		});

		it("Should not mistake an ordinary failure for a conflict", () => {
			expect(isSyncConflict(new Error("network down"))).toBe(false);
			expect(isSyncConflict(null)).toBe(false);
		});
	});

	describe("getSyncCapabilities", () => {
		// Every campaign method, so an adapter can be built that really does tables
		const withCampaigns = extra => ({
			pListCampaigns: () => {},
			pCreateCampaign: () => {},
			pJoinCampaign: () => {},
			pCreateInvite: () => {},
			pListCampaignCharacters: () => {},
			pSetCharacterCampaign: () => {},
			...extra,
		});

		it("Should assume everything works when an adapter says nothing", () => {
			expect(getSyncCapabilities({}).characters).toBe(true);
			expect(getSyncCapabilities(null).characters).toBe(true);
		});

		it("Should believe an adapter that says character storage is not open yet", () => {
			expect(getSyncCapabilities({getCapabilities: () => ({characters: false})}).characters).toBe(false);
			expect(getSyncCapabilities({capabilities: {characters: false}}).characters).toBe(false);
		});

		// A throwing adapter must not take the page down on the way to drawing a badge
		it("Should treat a broken declaration as no declaration", () => {
			expect(getSyncCapabilities({getCapabilities: () => { throw new Error("nope"); }}).characters).toBe(true);
		});

		// Tables are optional as a *set*: half of them would give the pages a table nobody could join
		it("Should report tables only when every campaign method is there", () => {
			expect(getSyncCapabilities({}).campaigns).toBe(false);
			expect(getSyncCapabilities({pListCampaigns: () => {}}).campaigns).toBe(false);
			expect(getSyncCapabilities(withCampaigns()).campaigns).toBe(true);
		});

		// Judged by what it can do, not by what it claims
		it("Should not believe a claim of tables without the methods", () => {
			expect(getSyncCapabilities({getCapabilities: () => ({campaigns: true})}).campaigns).toBe(false);
		});

		it("Should let an adapter with the methods still switch tables off", () => {
			expect(getSyncCapabilities(withCampaigns({getCapabilities: () => ({campaigns: false})})).campaigns).toBe(false);
		});

		// A loan a player gives their DM, and a switch that must not appear where it would 404
		it("Should report lending a character to the GM on its own", () => {
			expect(hasGmWriteSupport(withCampaigns())).toBe(false);
			expect(getSyncCapabilities(withCampaigns()).gmWrite).toBe(false);

			const withLoan = withCampaigns({pSetCharacterGmWrite: () => {}});
			expect(hasGmWriteSupport(withLoan)).toBe(true);
			expect(getSyncCapabilities(withLoan).gmWrite).toBe(true);
			// The two are separate questions, and separate methods
			expect(getSyncCapabilities(withLoan).sidekickControl).toBe(false);
		});

		// One method, and its own capability: a service with tables but not this is an ordinary
		// older deployment, and the page should offer what is there
		it("Should report handing a sidekick over on its own", () => {
			expect(hasSidekickControlSupport(withCampaigns())).toBe(false);
			expect(getSyncCapabilities(withCampaigns()).sidekickControl).toBe(false);

			const withControl = withCampaigns({pSetCharacterControl: () => {}});
			expect(hasSidekickControlSupport(withControl)).toBe(true);
			expect(getSyncCapabilities(withControl).sidekickControl).toBe(true);
		});
	});

	describe("getSyncStatus", () => {
		// A static build has no account system, and decorating it with a red badge would report the
		// absence of a feature as a fault
		it("Should be off, and so invisible, when nothing is deployed", () => {
			expect(getSyncStatus({}).kind).toBe("off");
			expect(getSyncStatus({basePath: "/online", isLoaded: false}).kind).toBe("off");
		});

		it("Should report a half-implemented adapter as an error, naming what is missing", () => {
			const status = getSyncStatus({basePath: "/online", isLoaded: true, missingMethods: ["pSave", "pDelete"]});
			expect(status.kind).toBe("error");
			expect(status.tone).toBe("bad");
			expect(status.lines.some(l => /pSave, pDelete/.test(l.value))).toBe(true);
		});

		it("Should carry the failure's own message, so the popover can show it", () => {
			const status = getSyncStatus({basePath: "/online", isLoaded: true, error: new Error("502 Bad Gateway")});
			expect(status.kind).toBe("error");
			expect(status.lines.some(l => l.value === "502 Bad Gateway")).toBe(true);
		});

		it("Should offer a sign-in when connected but signed out", () => {
			const status = getSyncStatus({basePath: "/online", isLoaded: true, user: null});
			expect(status.kind).toBe("signedOut");
			expect(status.canSignIn).toBe(true);
			expect(status.canSignOut).toBe(false);
		});

		it("Should name whoever is signed in, and their role", () => {
			const status = getSyncStatus({basePath: "/online", isLoaded: true, user: {id: "u1", name: "Ada", role: "admin"}});
			expect(status.kind).toBe("signedIn");
			expect(status.tone).toBe("ok");
			expect(status.label).toBe("Online \u2014 Ada");
			expect(status.lines.some(l => l.label === "Role" && l.value === "admin")).toBe(true);
			expect(status.canSignOut).toBe(true);
		});

		// Signed in to a service that does not store characters yet is not "online" in the sense a
		// player would read it, so it must not look like it
		it("Should say plainly when characters are not stored online yet", () => {
			const status = getSyncStatus({basePath: "/online", isLoaded: true, user: {name: "Ada"}, capabilities: {characters: false}});
			expect(status.kind).toBe("signedIn");
			expect(status.tone).toBe("warn");
			expect(status.lines.some(l => l.label === "Characters" && /only copy/.test(l.value))).toBe(true);
		});

		it("Should always say where it looked", () => {
			expect(getSyncStatus({basePath: "/accounts", isLoaded: true, user: null}).lines[0])
				.toEqual({label: "Account system", value: "/accounts"});
		});
	});

	describe("planSync", () => {
		const label = envelope => envelope?.state?.name || "Unnamed Character";

		it("Should line up what is here against what is online", () => {
			const rows = planSync({
				localCharacters: {a: {state: {name: "Ada"}}, b: {state: {name: "Bob"}}},
				remote: [{id: "b", name: "Bob", version: 3}, {id: "c", name: "Cleo", version: 1}],
				syncMeta: {b: {version: 3}},
				fnLabel: label,
			});

			expect(rows.map(it => [it.name, it.where])).toEqual([["Ada", "local"], ["Bob", "both"], ["Cleo", "online"]]);
			expect(rows.find(it => it.id === "b").remoteVersion).toBe(3);
			expect(rows.find(it => it.id === "c").localVersion).toBeNull();
		});

		// Guessing which side is newer would mean trusting clocks across two devices and a server
		it("Should not try to decide which side is newer", () => {
			const rows = planSync({
				localCharacters: {a: {state: {name: "Ada"}}},
				remote: [{id: "a", name: "Ada", version: 9}],
				syncMeta: {a: {version: 2}},
				fnLabel: label,
			});
			expect(rows[0].where).toBe("both");
			expect(Object.keys(rows[0])).not.toContain("isNewer");
		});

		it("Should cope with nothing on either side", () => {
			expect(planSync({})).toEqual([]);
		});

		// This is what a first sign-in offers to upload
		it("Should pick out what has never been uploaded", () => {
			const rows = planSync({
				localCharacters: {a: {state: {name: "Ada"}}, b: {state: {name: "Bob"}}},
				remote: [{id: "b", name: "Bob", version: 1}],
				fnLabel: label,
			});
			expect(getUnsyncedRows(rows).map(it => it.id)).toEqual(["a"]);
		});

		// A sidekick handed to a table is listed for everybody at it, and the page must be able to say
		// so: it is theirs to play, not theirs to give away
		it("Should mark what belongs to somebody else, and assume anything unsaid is mine", () => {
			const rows = planSync({
				localCharacters: {a: {state: {name: "Ada"}}},
				remote: [
					{id: "a", name: "Ada", version: 1},
					{id: "s", name: "Sir Braun", version: 2, isSidekick: true, isMine: false},
					{id: "o", name: "Old Server", version: 1},
				],
				fnLabel: label,
			});

			expect(rows.find(it => it.id === "s").isMine).toBe(false);
			expect(rows.find(it => it.id === "a").isMine).toBe(true);
			expect(rows.find(it => it.id === "o").isMine).toBe(true);
		});

		// A local copy of a sidekick that has since been shared must pick that up on the next listing
		it("Should take the server's word for it on a character that is on both sides", () => {
			const rows = planSync({
				localCharacters: {s: {state: {name: "Sir Braun", isSidekick: true}}},
				remote: [{id: "s", name: "Sir Braun", version: 2, isSidekick: true, isMine: false}],
				fnLabel: label,
			});
			expect(rows[0].where).toBe("both");
			expect(rows[0].isMine).toBe(false);
		});

		it("Should carry the sidekick flag, so each page can list its own kind", () => {
			const rows = planSync({
				localCharacters: {a: {state: {name: "Sid", isSidekick: true}}},
				remote: [{id: "b", name: "Kid", version: 1, isSidekick: true}],
				fnLabel: label,
			});
			expect(rows.every(it => it.isSidekick)).toBe(true);
		});
	});

	describe("the remembered online version", () => {
		it("Should be stored beside the characters, keyed the same way", () => {
			const store = {characters: {}};
			setSyncMeta(store, "a", {version: 4, at: 123});
			expect(getSyncMeta(store, "a")).toEqual({version: 4, at: 123});
			expect(getSyncMeta(store, "b")).toBeNull();
			expect(getSyncMeta(null, "a")).toBeNull();
		});
	});

	describe("getKeptBothName", () => {
		it("Should mark the copy so it can be told apart in a list", () => {
			expect(getKeptBothName("Ada")).toBe("Ada (this device)");
		});

		// Two conflicts in a row must not produce "Ada (this device) (this device)"
		it("Should not stack up suffixes", () => {
			expect(getKeptBothName("Ada (this device)")).toBe("Ada (this device)");
		});

		it("Should still name an unnamed character", () => {
			expect(getKeptBothName("")).toBe("Unnamed Character (this device)");
		});
	});
});
