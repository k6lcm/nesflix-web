// converter.js
//
// Port of NESFlixTool by Batsly Adams, 2011, which produces CHR-ROM data
// for NESFlix by NO CARRIER.
//
// This module does NO DOM I/O. It takes a GIF ArrayBuffer in, returns a CHR
// Uint8Array out. UI is handled in app.js.
//
// Behavior is intentionally bug-compatible with the original Java tool.
// See README for documentation of the known quirks (per-frame color scan,
// non-cleared color array, padding by zero-fill).

'use strict';

// ---- Constants from nesflix_mmc3.asm ------------------------------------

const FRAME_BYTES   = 4096;          // one CHR page = 256 tiles * 16 bytes
const MAX_FRAMES    = 64;            // MMC3 max; engine has fcount hardcoded
const CHR_BYTES     = FRAME_BYTES * MAX_FRAMES;   // 262144 = 256 KiB
const TEMPLATE_BYTES = 32784;        // 16-byte iNES header + 32 KiB PRG
const NES_BYTES     = TEMPLATE_BYTES + CHR_BYTES; // 294928

const WIDTH  = 128;
const HEIGHT = 128;

// ---- Colour packing ------------------------------------------------------
//
// Java's PImage.pixels[] stores colors as signed 32-bit ARGB ints. For an
// opaque pixel that's 0xFFRRGGBB which is negative in two's-complement.
// Arrays.sort on int[] sorts ascending signed, so empty (zero) slots in the
// 4-entry colorArray sort AFTER real pixels. We must preserve that here.
//
// `| 0` coerces to int32, which gives us signed-int semantics for sort.

function argbKey(r, g, b) {
  return ((0xFF << 24) | (r << 16) | (g << 8) | b) | 0;
}

// ---- GIF parsing + frame compositing -------------------------------------
//
// gifuct gives us each frame's "patch" (an RGBA rectangle at some offset
// inside the logical screen) along with disposal/dims metadata. The Java
// tool used Processing's gifAnimation, which returns full composited frames.
// We replicate that by walking gifuct's output and applying GIF disposal
// methods to a running canvas, snapshotting it after every frame.

function compositeGifFrames(arrayBuffer) {
  const gif    = window.gifuct.parseGIF(arrayBuffer);
  const frames = window.gifuct.decompressFrames(gif, true);   // true => build RGBA patches

  const W = gif.lsd.width;
  const H = gif.lsd.height;
  if (W !== WIDTH || H !== HEIGHT) {
    throw new Error(`GIF must be ${WIDTH}x${HEIGHT} (got ${W}x${H})`);
  }
  if (frames.length === 0) throw new Error('GIF contains no frames');

  // Canvas starts transparent. The Java tool didn't see a transparent area
  // in adorn.gif because its frame-0 patch covers the whole screen; we keep
  // the same default but also handle Photoshop's typical "do not dispose"
  // case where later patches are sub-rectangles.
  let canvas = new Uint8ClampedArray(W * H * 4);
  let saved  = null;     // for disposal type 3 ("restore to previous")
  const composited = [];

  for (const frame of frames) {
    if (frame.disposalType === 3) saved = new Uint8ClampedArray(canvas);

    // Paint this frame's RGBA patch into the running canvas. Skip pixels
    // marked transparent in the patch (alpha == 0).
    const { top, left, width: pw, height: ph } = frame.dims;
    const patch = frame.patch;
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const pi = (y * pw + x) * 4;
        if (patch[pi + 3] === 0) continue;
        const ci = ((top + y) * W + (left + x)) * 4;
        canvas[ci]     = patch[pi];
        canvas[ci + 1] = patch[pi + 1];
        canvas[ci + 2] = patch[pi + 2];
        canvas[ci + 3] = 255;
      }
    }

    // Snapshot the composited full-screen state as this frame's output.
    composited.push(new Uint8ClampedArray(canvas));

    // Apply disposal to prepare the canvas for the NEXT frame.
    if (frame.disposalType === 2) {
      // Clear this frame's region (background color ~ transparent here).
      for (let y = 0; y < ph; y++) {
        for (let x = 0; x < pw; x++) {
          const ci = ((top + y) * W + (left + x)) * 4;
          canvas[ci] = canvas[ci + 1] = canvas[ci + 2] = canvas[ci + 3] = 0;
        }
      }
    } else if (frame.disposalType === 3 && saved) {
      canvas = new Uint8ClampedArray(saved);
    }
    // disposal 0 / 1 ("no disposal" / "do not dispose"): leave canvas as-is.
  }

  return composited;   // array of Uint8ClampedArray, each WIDTH*HEIGHT*4 bytes RGBA
}

// ---- ScanColors ----------------------------------------------------------
//
// Direct port of NESMovieConverterFinal3.ScanColors(PImage).
// Walks pixels in raster order, collecting distinct ARGB values into the
// caller-supplied array (capacity 4). Returns the total distinct-color
// count (which may exceed 4; the original uses this for the validation
// error "More than 4 colors found").
//
// IMPORTANT: this does NOT clear slots beyond the first n that get written.
// The original Java code has the same property and the modernized port
// keeps it for bug-for-bug fidelity.

function scanColors(pixelsRGBA, arr) {
  let n = 0;
  let count = 0;
  for (let i = 0; i < pixelsRGBA.length; i += 4) {
    const k = argbKey(pixelsRGBA[i], pixelsRGBA[i + 1], pixelsRGBA[i + 2]);
    let found = false;
    for (let j = 0; j < n; j++) {
      if (arr[j] === k) { found = true; break; }
    }
    if (!found) {
      if (n < 4) { arr[n] = k; n++; }
      count++;
    }
  }
  return count;
}

// ---- ImageToCHR ----------------------------------------------------------
//
// Direct port of NESMovieConverterFinal3.ImageToCHR(PImage).
// Walks the 128x128 image as a 16x16 grid of 8x8 tiles in row-major order
// and emits standard NES 2BPP: for each tile, 8 bytes of low bitplane
// (one byte per row, MSB = leftmost pixel) followed by 8 bytes of high
// bitplane.

function imageToCHR(pixelsRGBA, sortedColorArray) {
  const out = new Uint8Array(FRAME_BYTES);

  // Per-pixel lookup: map ARGB key -> index 0..3. Pixels whose color isn't
  // in the array (shouldn't happen for valid 4-color input) default to 0.
  const idxOf = new Map();
  for (let i = 0; i < sortedColorArray.length; i++) {
    idxOf.set(sortedColorArray[i], i);
  }

  for (let ty = 0; ty < 16; ty++) {
    for (let tx = 0; tx < 16; tx++) {
      const tileOffset = ty * 256 + tx * 16;
      for (let row = 0; row < 8; row++) {
        let b1 = 0;   // low bitplane (bit 0 of palette index)
        let b2 = 0;   // high bitplane (bit 1)
        for (let col = 0; col < 8; col++) {
          const x = col + tx * 8;
          const y = row + ty * 8;
          const pi = (y * WIDTH + x) * 4;
          const k = argbKey(pixelsRGBA[pi], pixelsRGBA[pi + 1], pixelsRGBA[pi + 2]);
          const v = idxOf.has(k) ? idxOf.get(k) : 0;
          b1 = ((b1 << 1) | (v & 1)) & 0xFF;
          b2 = ((b2 << 1) | ((v >> 1) & 1)) & 0xFF;
        }
        out[tileOffset + row]     = b1;
        out[tileOffset + row + 8] = b2;
      }
    }
  }
  return out;
}

// ---- Top-level conversion ------------------------------------------------
//
// Mirrors the flow of NESMovieConverterFinal3.OpenFile() for the MMC3 path,
// minus the AUTOCONVERT branch (out of scope for v1; users are expected to
// pre-process GIFs in Photoshop per Batsly Adams' tutorial).
//
// Returns: { chr, nes, frameCount, colorCount }

function convertGifToChr(arrayBuffer, options) {
  options = options || {};
  const deleteFirstTile = !!options.deleteFirstTile;

  const composited = compositeGifFrames(arrayBuffer);

  if (composited.length > MAX_FRAMES) {
    throw new Error(
      `GIF has ${composited.length} frames; MMC3 maximum is ${MAX_FRAMES}`
    );
  }

  // DELETE FIRST TILE: scan frame 0, sort, overwrite the top-left 8x8 of
  // every frame with the lowest-sorted color. Lets the NES engine use
  // modes where the video sits inside a solid border (tile 0 fills it).
  if (deleteFirstTile) {
    const arr = [0, 0, 0, 0];
    scanColors(composited[0], arr);
    arr.sort((a, b) => a - b);
    const fillKey = arr[0];
    const fr = (fillKey >> 16) & 0xFF;
    const fg = (fillKey >>  8) & 0xFF;
    const fb =  fillKey        & 0xFF;
    for (const f of composited) {
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const pi = (y * WIDTH + x) * 4;
          f[pi] = fr; f[pi + 1] = fg; f[pi + 2] = fb; f[pi + 3] = 255;
        }
      }
    }
  }

  // Validate color count on frame 0 (matches original's check).
  {
    const tmp = [0, 0, 0, 0];
    const cnt = scanColors(composited[0], tmp);
    if (cnt > 4) {
      throw new Error(`Frame 0 has ${cnt} distinct colors; maximum is 4`);
    }
  }

  // The output buffer is allocated full-size and zero-filled. If the GIF
  // has fewer than MAX_FRAMES frames, the trailing region stays all zeros,
  // which is exactly the "automatic padding" the original tool's UI
  // documentation describes.
  const chr = new Uint8Array(CHR_BYTES);

  // colorArray is length 4 and NOT cleared between per-frame ScanColors
  // calls. This is the documented quirk of the original tool.
  const colorArrayState = [0, 0, 0, 0];

  let lastFrameColorCount = 0;
  for (let f = 0; f < composited.length; f++) {
    lastFrameColorCount = scanColors(composited[f], colorArrayState);

    // Sort the full 4-entry array ascending as signed int32. Unused slots
    // (value 0) sort AFTER real ARGB-with-alpha=255 pixels (which are
    // negative), so the live colors occupy the low indices.
    const sorted = colorArrayState.slice().sort((a, b) => a - b);

    const page = imageToCHR(composited[f], sorted);
    chr.set(page, f * FRAME_BYTES);
  }

  return {
    chr,
    frameCount: composited.length,
    colorCount: lastFrameColorCount,
  };
}

// ---- ROM packaging -------------------------------------------------------
//
// The original build script (mmc3_compile.sh) concatenates the assembled
// PRG (header + 32 KiB code) with the 256 KiB CHR. We do exactly that:
// the template.bin shipped in assets/ IS the assembled PRG, byte for byte.

function buildNesRom(templateBytes, chrBytes) {
  if (templateBytes.byteLength !== TEMPLATE_BYTES) {
    throw new Error(
      `Template size is ${templateBytes.byteLength}, expected ${TEMPLATE_BYTES}`
    );
  }
  if (chrBytes.byteLength !== CHR_BYTES) {
    throw new Error(
      `CHR size is ${chrBytes.byteLength}, expected ${CHR_BYTES}`
    );
  }
  const out = new Uint8Array(NES_BYTES);
  out.set(new Uint8Array(templateBytes), 0);
  out.set(new Uint8Array(chrBytes), TEMPLATE_BYTES);
  return out;
}

// Expose as a global namespace. Plain script, no module system, on purpose.
window.NESFlix = {
  convertGifToChr,
  buildNesRom,
  // exported constants for the UI / test page
  FRAME_BYTES, MAX_FRAMES, CHR_BYTES, TEMPLATE_BYTES, NES_BYTES,
  WIDTH, HEIGHT,
};
