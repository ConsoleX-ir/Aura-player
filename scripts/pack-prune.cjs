// afterPack hook:
//   1. prune files that are never needed at runtime (installer size < 90 MB)
//   2. patch the app .exe resources — icon + version info — because
//      electron-builder's rcedit step needs Windows/wine and is skipped when
//      packaging from Linux. `resedit` is pure JS, so it runs everywhere.
const fs = require('fs');
const path = require('path');

// Files deleted unconditionally (dead weight inside the installer).
const PRUNE_ALWAYS = [
  'LICENSES.chromium.html', // ~12 MB of bundled third-party license text
  'LICENSE.electron.txt',
  'LICENSE',
  'LICENSES',
  'README.md',
  'resources/app.asar.unpacked', // nothing unpacked (no native modules)
];

// Large DLLs pruned to stay under the 90 MB installer budget.
// d3dcompiler_47.dll is KEPT — it is the shader-compiler fallback used when
// dxcompiler.dll is absent. libEGL/libGLES/swiftshader kept for GPU-less VMs.
const OPTIONAL_GPU_FALLBACKS = [
  'dxcompiler.dll', // 25.6 MB — ANGLE DXC path; falls back to d3dcompiler_47.dll
  'dxil.dll',       //  1.5 MB — only used together with dxcompiler.dll
];

function rm(p) {
  try {
    const st = fs.lstatSync(p);
    if (st.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
    else fs.unlinkSync(p);
    return true;
  } catch {
    return false;
  }
}

function prune(context) {
  const out = context.appOutDir;
  for (const name of PRUNE_ALWAYS) {
    if (rm(path.join(out, name))) console.log(`[pack-prune] removed ${name}`);
  }
  for (const name of OPTIONAL_GPU_FALLBACKS) {
    if (rm(path.join(out, name))) console.log(`[pack-prune] removed ${name}`);
  }
  console.log(`[pack-prune] prune done (out=${out})`);
}

// ---- exe resource patch (icon + version) ----------------------------------

function patchExe(context) {
  const out = context.appOutDir;
  const pkg = context.packager.appInfo; // electron-builder app metadata
  const exePath = path.join(out, `${pkg.productFilename}.exe`);
  if (process.platform === 'win32' || !fs.existsSync(exePath)) {
    // On Windows electron-builder's rcedit already handles the icon.
    return;
  }

  let resedit;
  try {
    // resedit is ESM; load via dynamic import from CJS hook
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    resedit = require('resedit');
  } catch (e) {
    console.warn('[pack-prune] resedit not available, exe icon NOT patched:', e.message);
    return;
  }

  const exeBuf = fs.readFileSync(exePath);
  const exe = resedit.NtExecutable.from(exeBuf);
  const res = resedit.NtExecutableResource.from(exe);

  // 1) icon — replace icon group #1 (the application icon) from public/icon.ico
  const icoPath = path.join(context.packager.projectDir, 'public', 'icon.ico');
  if (fs.existsSync(icoPath)) {
    const iconFile = resedit.Data.IconFile.from(fs.readFileSync(icoPath));
    // resedit >= 3: IconFile.icons are {width,height,...,data:IconItem|RawIconItem}
    const icons = iconFile.icons.map((i) => (typeof i.create === 'function' ? i.create() : i.data));
    resedit.Resource.IconGroupEntry.replaceIconsForResource(
      res.entries,
      1,
      1033,
      icons
    );
    console.log('[pack-prune] exe icon patched from public/icon.ico');
  }

  // 2) version info
  const verQuad = pkg.version.split('.').length === 3 ? `${pkg.version}.0` : pkg.version;
  const viList = resedit.Resource.VersionInfo.fromEntries(res.entries); // resedit >= 3 API
  const strings = {
    ProductName: pkg.productName,
    FileDescription: pkg.productName,
    CompanyName: pkg.companyName,
    LegalCopyright: `Copyright © ${new Date().getFullYear()} ${pkg.companyName}`,
    ProductVersion: pkg.version,
    FileVersion: pkg.version,
    OriginalFilename: `${pkg.productFilename}.exe`,
  };
  if (viList.length === 0) {
    const vi = resedit.Resource.VersionInfo.createEmpty();
    vi.setStringValues({ lang: 1033, codepage: 1200 }, strings);
    vi.setFileVersion(verQuad);
    vi.setProductVersion(verQuad);
    vi.outputToResourceEntries(res.entries);
  } else {
    for (const vi of viList) {
      vi.setStringValues({ lang: 1033, codepage: 1200 }, strings);
      vi.setFileVersion(verQuad);
      vi.setProductVersion(verQuad);
      vi.outputToResourceEntries(res.entries);
    }
  }
  console.log('[pack-prune] exe version info patched');

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate())); // pe-library >= 2 API
  console.log('[pack-prune] exe resources written:', exePath);
}

exports.default = function afterPack(context) {
  prune(context);
  patchExe(context);
};
