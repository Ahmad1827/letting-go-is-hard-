// electron-builder afterPack: put the PC icon and the app's name into the
// Windows .exe. electron-builder only does this through Wine when building on
// Linux; rcedit.exe runs natively on Windows and through WSL's interop.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function winIcon({ electronPlatformName, appOutDir, packager }) {
  if (electronPlatformName !== 'win32') return;
  const name = packager.appInfo.productFilename;
  const version = packager.appInfo.version;
  const bin = path.join(path.dirname(require.resolve('rcedit')), '..', 'bin', 'rcedit-x64.exe');
  // under WSL the .exe needs Windows paths
  const win = (p) => (process.platform === 'win32' ? p : execFileSync('wslpath', ['-w', p], { encoding: 'utf8' }).trim());
  execFileSync(bin, [
    win(path.join(appOutDir, `${name}.exe`)),
    '--set-icon', win(path.resolve('build/icon.ico')),
    '--set-version-string', 'ProductName', name,
    '--set-version-string', 'FileDescription', name,
    '--set-version-string', 'OriginalFilename', `${name}.exe`,
    '--set-file-version', version,
    '--set-product-version', version,
  ], { stdio: 'inherit' });
};
