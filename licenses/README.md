# Supplemental dependency notices

These version-specific files cover packages that omit license texts from their
npm tarballs. `scripts/prepare-legal.mjs` requires a new review when their versions
change; it does not silently reuse an older fallback.

- `lazy-val@1.0.5`: its package metadata at upstream commit
  `b69ad4119f1b19bdab13c61ee2fcc88d46b89071` declares MIT and names Vladimir
  Krivosheev as author. Neither the npm package nor that repository supplies a
  separate license file. The notice attributes the author and reproduces the
  standard MIT terms, without inventing a copyright year.
- `standardwebhooks@1.1.1`: npm declares MIT. The repository root LICENSE at
  commit `b4d2c14fc5b4ccff3ff271e3b087dff812254c59` contains Apache-2.0 instead.
  The notice preserves both declarations and the verbatim repository license;
  it does not claim upstream resolved the discrepancy.

Source URLs are included in each notice. Other dependencies' license files are
copied directly from the installed packages during the build.
