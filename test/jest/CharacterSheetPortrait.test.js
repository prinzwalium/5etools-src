import {describe, expect, it} from "@jest/globals";
import {
	PORTRAIT_MAX_BYTES,
	PORTRAIT_MAX_PX,
	getDataUrlBytes,
	getPortraitTargetSize,
	isPortraitTooLarge,
} from "../../js/charactersheet/charactersheet-portrait.js";

/** A data URL whose payload is `n` bytes, near enough for the size check. */
const mkDataUrl = n => `data:image/jpeg;base64,${"A".repeat(Math.ceil(n / 3) * 4)}`;

describe("Character Sheet — portrait sizing", () => {
	describe("getPortraitTargetSize", () => {
		it("Should leave an image that is already small enough alone", () => {
			expect(getPortraitTargetSize(120, 90)).toEqual({width: 120, height: 90});
			expect(getPortraitTargetSize(PORTRAIT_MAX_PX, 100)).toEqual({width: PORTRAIT_MAX_PX, height: 100});
		});

		it("Should scale a large image down by its longest edge, keeping the shape", () => {
			const out = getPortraitTargetSize(4000, 3000);
			expect(out.width).toBe(PORTRAIT_MAX_PX);
			expect(out.height).toBe(Math.round(PORTRAIT_MAX_PX * 0.75));
		});

		it("Should scale by the height when the image is portrait-shaped", () => {
			const out = getPortraitTargetSize(3000, 4000);
			expect(out.height).toBe(PORTRAIT_MAX_PX);
			expect(out.width).toBe(Math.round(PORTRAIT_MAX_PX * 0.75));
		});

		it("Should never scale an edge away to nothing", () => {
			const out = getPortraitTargetSize(10000, 3);
			expect(out.width).toBe(PORTRAIT_MAX_PX);
			expect(out.height).toBeGreaterThanOrEqual(1);
		});

		it("Should honour a caller's own maximum", () => {
			expect(getPortraitTargetSize(1000, 500, {maxPx: 100})).toEqual({width: 100, height: 50});
		});

		it("Should return nothing for an image with no size", () => {
			expect(getPortraitTargetSize(0, 0)).toEqual({width: 0, height: 0});
			expect(getPortraitTargetSize(null, undefined)).toEqual({width: 0, height: 0});
		});
	});

	describe("getDataUrlBytes", () => {
		it("Should measure the payload, not the whole string", () => {
			// "AAAA" of base64 is three bytes
			expect(getDataUrlBytes("data:image/jpeg;base64,AAAA")).toBe(3);
		});

		it("Should allow for padding", () => {
			expect(getDataUrlBytes("data:image/jpeg;base64,AAA=")).toBe(2);
			expect(getDataUrlBytes("data:image/jpeg;base64,AA==")).toBe(1);
		});

		it("Should be zero for something that is not a data URL", () => {
			expect(getDataUrlBytes("")).toBe(0);
			expect(getDataUrlBytes(null)).toBe(0);
			expect(getDataUrlBytes("nonsense")).toBe(0);
		});
	});

	// Every character in the store shares one localStorage quota, so an unbounded portrait would
	// break saving for all of them, not just the one it was added to
	describe("isPortraitTooLarge", () => {
		it("Should accept a portrait within the budget", () => {
			expect(isPortraitTooLarge(mkDataUrl(PORTRAIT_MAX_BYTES - 1024))).toBe(false);
		});

		it("Should refuse one over it", () => {
			expect(isPortraitTooLarge(mkDataUrl(PORTRAIT_MAX_BYTES + 1024))).toBe(true);
		});

		it("Should honour a caller's own budget", () => {
			expect(isPortraitTooLarge(mkDataUrl(2048), {maxBytes: 1024})).toBe(true);
		});

		it("Should treat nothing as small enough", () => {
			expect(isPortraitTooLarge("")).toBe(false);
		});
	});
});
