# nesflix-web

In-browser port of **NESFlix** (2011) by NO CARRIER and Batsly Adams. The output is a
playable NES ROM that you can run on any MMC3-capable cartridge, flash cart
(PowerPak, Everdrive N8), or emulator.

The original tool utilizes a Java app that has become increasingly
hard to run on modern systems. This is a re-implementation in JavaScript that runs 
entirely in a browser.

## Try it

<https://k6lcm.github.io/nesflix-web/>

## Credits and licence

- **NESFlix** (the NES engine and assembly source) by NO CARRIER, 2011.
  <https://no-carrier.com> · <https://github.com/no-carrier/NESFlix>
- **NESFlixTool** (the conversion algorithm) by Batsly Adams.
- **Web port** by Levi C. Maaia (2026).
  <https://www.youtube.com/@levimaaia>
- Distributed under **GPL v3 or later**, matching the original. See `LICENSE`.

## Usage

1. Prep your GIF following Batsly Adams' [original Photoshop
   tutorial](https://github.com/no-carrier/NESFlix/blob/master/NESFlixTool/NESFlixTool_readme/NESFlixTool_readme.html)
   or Levi's Digital Voyage [video tutorial using Ezgif.com](https://youtu.be/4-w5C875O34) (just come back
   here before venturing off into the original NESFlix Java app): loop trim,
   resize to 128×128, reduce to 4 colors, uncheck transparency, save as GIF.
   The file must end up exactly 128×128 with no more than 64 frames and
   exactly 4 distinct colors.
2. Go to <https://k6lcm.github.io/nesflix-web/>.
3. Choose your GIF. Optionally tick "delete first tile" if your video should
   sit inside a solid border (this matches the original tool's checkbox).
4. Click **convert** then **download**. A `.nes` file downloads.
5. Play it on hardware (PowerPak, Everdrive N8, ReproPak) or in an emulator
   (Nestopia, FCEUX, Mesen).

Controller mapping is the same as the original NESFlix ROM. See the
original `readme.txt` in NO CARRIER's repo for the full controls list.

## Scope of v1

In scope:

- MMC3 path, up to 64 frames
- Optional "delete first tile" behavior, identical to the original
- The same validation errors the original tool reports

Out of scope (for now):

- **MMC5 path** (up to 256 frames). Different `.asm`, different banking.
  Can be added later; not required for the common case.
- **AUTOCONVERT.** The experimental "feed it any GIF and we'll grayscale-
  and-posterize it" mode. Batsly Adams himself documented it as "works on
  some GIFs." If you want reliable results, do the Photoshop prep.

## Known quirks (carried over from the original)

This is a port, not a fix. Behavior is intentionally bug-for-bug
compatible with NESFlixTool. Two things to be aware of:

1. **Per-frame palette sort.** The original tool scans each frame
   independently for its distinct colors and sorts them by ARGB integer
   value. The pixel value 0 to 3 in the resulting CHR is the color's rank
   in that sorted list. For grayscale content this is darkest-to-lightest.
   For color content it's R, then G, then B order. The engine then maps
   values 0 to 3 through one of 8 NES palettes (default is black / dark gray
   / light gray / white).
2. **Non-cleared color array.** The 4-slot palette array is not reset
   between frames. If a frame uses fewer than 4 of the GIF's distinct
   colors, stale entries from a prior frame remain in the array and get
   sorted in. On unusual GIFs this can show up as one or two frames with
   their colors rearranged mid-playback. Properly-prepped GIFs where
   every frame uses all 4 palette colors are unaffected. NO CARRIER's
   distributed `adorn.gif` is one such GIF, which is why our `test.html`
   passes byte-exact on it.

A future version may offer an opt-in "global palette" mode that fixes
quirk 2. v1 does not, on purpose.

## Developing locally

Clone the repo and serve it with any small HTTP server. The browser
won't load the bundled `assets/` and `test/` files from a `file://` URL
because of the same-origin policy, so a server is required even for
read-only inspection.

```sh
git clone https://github.com/k6lcm/nesflix-web
cd nesflix-web
python3 -m http.server 8000
```

Then open <http://localhost:8000/> for the converter, or
<http://localhost:8000/test/test.html> for the fidelity test.

The fidelity test runs the in-browser converter on the `adorn.gif` that
ships with NO CARRIER's original distribution and compares the resulting
CHR-ROM byte for byte against the canonical `mmc3.chr` from that same
distribution. A pass means the JavaScript port produces bit-identical
output to the 2011 Java tool on the same input.

Expected SHA-256 of the CHR section:
`c698380daa7a7677c55c75542ef60ca2e42276337486c7c9967b770880b320e0`

Expected SHA-256 of the full `.nes` produced from `adorn.gif`:
`ecf177f84db8a76e3768341e3e5ed202ccdf87d472332e0e52ab8b8319b842cf`

## Project layout

```
nesflix-web/
  index.html               main UI
  app.js                   UI glue
  converter.js             the algorithm (~280 lines, commented)
  style.css
  assets/
    template.bin           assembled PRG from nesflix_mmc3.asm (32,784 bytes)
    adorn.gif              NO CARRIER's sample input
  vendor/
    gifuct.js              vendored gifuct-js, MIT, ~7.5 KB
  test/
    test.html              byte-identity fidelity test
    adorn_reference.chr    NO CARRIER's mmc3.chr, the canonical output
  LICENSE                  GPL v3
  README.md
```

## Rebuilding the template

`assets/template.bin` is the assembled output of `asm6 nesflix_mmc3.asm`
from NO CARRIER's repo. It is a static asset baked into the project. To
reproduce it from source:

```sh
git clone https://github.com/no-carrier/NESFlix
cd NESFlix
asm6 nesflix_mmc3.asm template.bin
```

The result should be exactly 32,784 bytes with SHA-256
`42db193dec37efcb606faa770001323bf57c367a93622ec421e663e7eed058a0`.

(asm6 by loopy is available from a few public mirrors; asm6f is a
backwards-compatible fork that produces identical output for this `.asm`.)
