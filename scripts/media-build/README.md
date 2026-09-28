# Nico's Transcriber media tools, 9.0.2-nicos1

FFmpeg and ffprobe are built from the pinned, unmodified FFmpeg 9.0.2 source in
`sources.json`, with LAME 3.100 and zlib 1.3.2. No other optional third-party
libraries are enabled. LAME's source archive is byte-for-byte identical to the
upstream 3.100 tarball (also verified against the SHA-512 in vcpkg's mp3lame port).

FFmpeg is LGPL-2.1-or-later; LAME is LGPL-2.0-or-later; zlib uses the zlib license. License texts
are included. The Windows compiler runtime notices are included separately.
These programs run as separate processes; the app itself is MIT licensed.

The source bundle includes every input source archive, their URLs and hashes,
the complete build scripts, generated FFmpeg configuration, compiler/package
versions, and imported-DLL reports. There are no local patches. Network protocols
and hardware video acceleration are disabled; local media decoding, probing,
audio filters, FLAC and MP3 encoding remain available.

## Rebuild

Use Ubuntu 24.04 with Node.js 24, make, nasm, pkg-config, zip, and the MinGW-w64
x64 GCC and G++ packages (`gcc-mingw-w64-x86-64`, `g++-mingw-w64-x86-64`).
The exact package versions used are recorded in `toolchain.txt`. Git is optional
for standalone source-bundle builds; without a checkout, the rebuilt provenance
records a null commit.

From a checkout of Nico's Transcriber:

```bash
bash scripts/media-build/build.sh
```

From the extracted source bundle, create `scripts/media-build/` and copy
`build.sh`, `fetch.mjs`, `package.mjs`, `sources.json` and `README.md` there.
Copy `archives/` to `release/media-build/source-archives/` to build offline after
installing the compiler packages. Run the same command from that directory.
The workflow is `.github/workflows/media-tools.yml` in the repository.
It uploads both archives and checksums to a draft `media-tools-<build>` release,
verifies the uploaded digests, and leaves publication to the maintainer after
Windows validation. A build never overwrites an existing release.

The executables are not bound to the application. Replace
`resources/media-tools/bin/ffmpeg.exe` and `ffprobe.exe` with compatible builds,
or use `FFMPEG_PATH` and `FFPROBE_PATH`.
