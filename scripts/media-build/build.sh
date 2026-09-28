#!/usr/bin/env bash
# Run from the repository root on Ubuntu 24.04; also works via: cat this-file | bash
set -uo pipefail
run() { "$@" || { status=$?; echo "Build command failed ($status): $*" >&2; exit "$status"; }; }
root="$(pwd)"
work="$root/release/media-build"
prefix="$work/prefix"
jobs="$(nproc 2>/dev/null || true)"
jobs="${jobs:-2}"
run node scripts/media-build/fetch.mjs
run mkdir -p "$work/src/ffmpeg" "$work/src/lame" "$work/src/zlib" "$prefix/include" "$prefix/lib" "$work/output/ffmpeg-9.0.2-nicos2/bin" "$work/source-package/archives" "$work/source-package/build"
run tar -xzf "$work/source-archives/ffmpeg-9.0.2.tar.gz" -C "$work/src/ffmpeg" --strip-components=1
run tar -xzf "$work/source-archives/lame-3.100.tar.gz" -C "$work/src/lame" --strip-components=1
run tar -xzf "$work/source-archives/zlib-1.3.2.tar.gz" -C "$work/src/zlib" --strip-components=1

run cd "$work/src/lame"
run ./configure --host=x86_64-w64-mingw32 --prefix="$prefix" --enable-static --disable-shared --disable-frontend --disable-gtktest --disable-decoder
run make -j"$jobs"
run make install

run cd "$work/src/zlib"
run make -f win32/Makefile.gcc PREFIX=x86_64-w64-mingw32- -j"$jobs" libz.a
run cp libz.a "$prefix/lib/"
run cp zlib.h zconf.h "$prefix/include/"

run cd "$work/src/ffmpeg"
# GitHub source archives lack VERSION. Pin it so version.sh cannot inherit the enclosing app repository's Git tag/hash.
run cp RELEASE VERSION
version="$(sh ffbuild/version.sh .)" || exit 1
if [ "$version" != "9.0.2" ]; then echo "Unexpected FFmpeg source version: $version" >&2; exit 1; fi
export PKG_CONFIG_LIBDIR="$prefix/lib/pkgconfig"
run ./configure --prefix="$prefix" --arch=x86_64 --target-os=mingw32 \
  --cross-prefix=x86_64-w64-mingw32- --enable-cross-compile \
  --extra-version=nicos2 --disable-autodetect --disable-gpl --disable-nonfree --disable-version3 \
  --enable-static --disable-shared --disable-debug --disable-doc --disable-ffplay \
  --disable-network --disable-dxva2 --disable-d3d11va --disable-d3d12va \
  --disable-mediafoundation --enable-libmp3lame --enable-zlib \
  --extra-cflags="-I$prefix/include" --extra-ldflags="-L$prefix/lib -static -static-libgcc" \
  --pkg-config=pkg-config --pkg-config-flags=--static
run make -j"$jobs" ffmpeg.exe ffprobe.exe
run grep -Fx '#define FFMPEG_VERSION "9.0.2-nicos2"' libavutil/ffversion.h
run cp ffmpeg.exe ffprobe.exe "$work/output/ffmpeg-9.0.2-nicos2/bin/"
run cp COPYING.LGPLv2.1 "$work/output/ffmpeg-9.0.2-nicos2/LICENSE"
run cp ffbuild/config.log ffbuild/config.mak config.h VERSION libavutil/ffversion.h "$work/source-package/build/"
run cp "$work/src/lame/COPYING" "$work/output/ffmpeg-9.0.2-nicos2/LAME-LICENSE.txt"
run cp "$work/src/zlib/LICENSE" "$work/output/ffmpeg-9.0.2-nicos2/ZLIB-LICENSE.txt"

run cd "$root"
run cp scripts/media-build/build.sh scripts/media-build/fetch.mjs scripts/media-build/sources.json scripts/media-build/README.md "$work/source-package/"
run cp "$work/source-archives/ffmpeg-9.0.2.tar.gz" "$work/source-archives/lame-3.100.tar.gz" "$work/source-archives/zlib-1.3.2.tar.gz" "$work/source-package/archives/"
run cp "$work/output/ffmpeg-9.0.2-nicos2/LICENSE" "$work/output/ffmpeg-9.0.2-nicos2/LAME-LICENSE.txt" "$work/output/ffmpeg-9.0.2-nicos2/ZLIB-LICENSE.txt" "$work/source-package/"
run node scripts/media-build/package.mjs
