import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('此构建用于 Apple 芯片 Mac。');
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, '.local/macos-build');
const name = '附中影像审核.app', app = path.join(directory, name), contents = path.join(app, 'Contents'), resources = path.join(contents, 'Resources');
const version = '22.23.3', runtimeName = `node-v${version}-darwin-arm64`;
const archive = path.join(directory, 'runtime-download/node.tar.gz');
const expected = '23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53';
await fs.mkdir(path.dirname(archive), { recursive: true });
try { await fs.access(archive); }
catch { execFileSync('curl', ['-fsSL', '--max-time', '180', `https://nodejs.org/dist/v${version}/${runtimeName}.tar.gz`, '-o', archive], { stdio: 'inherit' }); }
if (crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex') !== expected) throw new Error('Node 运行组件校验失败，请重新下载。');
try { await fs.access(path.join(directory, runtimeName, 'bin/node')); }
catch { execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', directory]); }
// Only replace this script's own reproducible build, never the content library.
await fs.rm(app, { recursive: true, force: true });
await fs.mkdir(path.join(contents, 'MacOS'), { recursive: true });
await fs.mkdir(resources, { recursive: true });
await fs.cp(path.join(directory, runtimeName), path.join(resources, 'runtime'), { recursive: true, verbatimSymlinks: true });
await fs.copyFile(path.join(root, 'desktop/bootstrap.mjs'), path.join(resources, 'bootstrap.mjs'));
await fs.writeFile(path.join(resources, 'project.json'), JSON.stringify({ root }) + '\n');
await fs.writeFile(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>附中影像审核</string><key>CFBundleDisplayName</key><string>附中影像审核</string>
<key>CFBundleIdentifier</key><string>com.drivinggodj.nsfz-review</string><key>CFBundleExecutable</key><string>CampusReview</string>
<key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>1.0</string><key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>13.0</string><key>NSHighResolutionCapable</key><true/>
<key>NSPrincipalClass</key><string>NSApplication</string><key>CFBundleIconFile</key><string>AppIcon</string>
<key>NSDocumentsFolderUsageDescription</key><string>读取并保存附中影像的照片、审核记录和网站内容库。</string>
<key>NSDownloadsFolderUsageDescription</key><string>导入下载的照片和投稿审核包。</string>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>\n`);
const iconset = path.join(directory, 'AppIcon.iconset'); await fs.mkdir(iconset, { recursive: true });
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect x="48" y="48" width="928" height="928" rx="210" fill="#344f3e"/><g fill="none" stroke="#f7f7ef" stroke-width="38" stroke-linejoin="round"><path d="M310 320h100l45-66h120l45 66h94q54 0 54 54v326q0 54-54 54H310q-54 0-54-54V374q0-54 54-54z"/><circle cx="512" cy="510" r="122"/></g><circle cx="729" cy="751" r="119" fill="#f7f7ef"/><path d="M670 752l42 43 80-89" fill="none" stroke="#344f3e" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/></svg>');
for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) await sharp(svg).resize(size * scale).png().toFile(path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`));
execFileSync('/usr/bin/iconutil', ['-c', 'icns', '-o', path.join(resources, 'AppIcon.icns'), iconset]);
execFileSync('/usr/bin/swiftc', ['-parse-as-library', '-O', '-target', 'arm64-apple-macos13.0', '-framework', 'AppKit', '-framework', 'WebKit', '-framework', 'UniformTypeIdentifiers', path.join(root, 'desktop/ReviewApp.swift'), '-o', path.join(contents, 'MacOS/CampusReview')], { stdio: 'inherit' });
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
console.log('已生成：' + app);
if (process.argv.includes('--install')) {
  const installed = path.join('/Applications', name);
  try {
    await fs.access(installed);
    const identifier = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleIdentifier', path.join(installed, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
    if (identifier !== 'com.drivinggodj.nsfz-review') throw new Error('目标位置有另一个应用，不覆盖。');
    const backup = path.join(directory, 'previous', new Date().toISOString().replaceAll(':', '-'), name);
    await fs.mkdir(path.dirname(backup), { recursive: true });
    await fs.cp(installed, backup, { recursive: true, verbatimSymlinks: true });
    await fs.rm(installed, { recursive: true });
    console.log('上一版应用已备份：' + backup);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.cp(app, installed, { recursive: true, verbatimSymlinks: true });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', installed]);
  console.log('已安装到应用程序：' + installed);
}
