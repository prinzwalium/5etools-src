/**
 * Portrait sizing.
 *
 * A portrait is stored as a data URL in `localStorage`, beside the character and every other
 * character in the store — so a phone photo dropped in at full size would be several megabytes of a
 * quota measured in single-digit ones, and would take the whole store down with it. Every import is
 * therefore downscaled and re-encoded before it is stored.
 *
 * Pure: the sizing decision lives here and is tested; the canvas work that carries it out belongs to
 * the page.
 */

/** Longest edge, in pixels, that a stored portrait may have. Ample for the box it is shown in. */
export const PORTRAIT_MAX_PX = 400;

/** A re-encoded portrait above this is refused rather than quietly filling the store. */
export const PORTRAIT_MAX_BYTES = 512 * 1024;

/** JPEG rather than PNG: a photograph at this size is several times smaller, and the box is small. */
export const PORTRAIT_MIME = "image/jpeg";
export const PORTRAIT_QUALITY = 0.82;

/**
 * The size to draw an image at: scaled down to fit `maxPx` on its longest edge, keeping its aspect
 * ratio. An image already small enough is left alone rather than upscaled.
 */
export function getPortraitTargetSize (width, height, {maxPx = PORTRAIT_MAX_PX} = {}) {
	const w = Math.max(0, Math.floor(Number(width) || 0));
	const h = Math.max(0, Math.floor(Number(height) || 0));
	if (!w || !h) return {width: 0, height: 0};

	const longest = Math.max(w, h);
	if (longest <= maxPx) return {width: w, height: h};

	const scale = maxPx / longest;
	return {
		width: Math.max(1, Math.round(w * scale)),
		height: Math.max(1, Math.round(h * scale)),
	};
}

/** Roughly how many bytes a data URL's payload occupies, without decoding it. */
export function getDataUrlBytes (dataUrl) {
	const ix = String(dataUrl ?? "").indexOf(",");
	if (ix < 0) return 0;
	const b64 = dataUrl.slice(ix + 1);
	const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
	return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

export function isPortraitTooLarge (dataUrl, {maxBytes = PORTRAIT_MAX_BYTES} = {}) {
	return getDataUrlBytes(dataUrl) > maxBytes;
}
