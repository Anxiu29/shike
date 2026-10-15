/** 安卓联调包：复用已运行的局域网页面，构建工具与签名仅存项目缓存。 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, readdir, copyFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('..', import.meta.url));
const web = join(root, 'packages/web'), android = join(web, 'android'), cache = join(root, '.data-cache/android');
const args = process.argv.slice(2);
const index = args.indexOf('--url');
const addresses = Object.entries(networkInterfaces()).flatMap(([name, list]) => (list ?? []).filter(item => item.family === 'IPv4' && !item.internal && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(item.address)).map(item => ({ name, ip: item.address })));
const wifi = addresses.filter(item => /wi-?fi|wlan|无线/i.test(item.name));
const physical = addresses.filter(item => !/virtual|vethernet|vmware|docker|vpn|wsl|tailscale|zerotier/i.test(item.name));
const candidates = wifi.length ? wifi : physical;
const selected = index >= 0 ? args[index + 1] : process.env.SHIKE_APP_PREVIEW_URL ?? (candidates.length === 1 ? `http://${candidates[0].ip}:5180/` : undefined);
if (args.length && (index !== 0 || args.length !== 2)) throw new Error('用法：npm run android:apk -- --url http://电脑局域网IP:5180/');
if (!selected) throw new Error('没有唯一的局域网地址，请通过 --url 指定。');
const url = new URL(selected);
if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('测试地址必须为无凭据、无路径的 HTTP(S) 来源。');
if (url.protocol === 'http:' && !addresses.some(item => item.ip === url.hostname)) throw new Error('HTTP 联调地址必须使用此电脑当前的局域网 IP，不能使用手机自身的 localhost。');
const origin = url.origin + '/';
// 开发服务可能正在因类型构建／依赖更新重启，不把一次短暂 503 当成地址错误。
let serviceReady = false;
for (let attempt = 0; attempt < 15; attempt++) {
  try {
    const health = await fetch(new URL('api/health', origin), { signal: AbortSignal.timeout(1500) });
    if (health.ok && (await health.json()).status === 'ok') { serviceReady = true; break; }
  } catch { /* 启动／重启期间继续等待。 */ }
  await new Promise(done => setTimeout(done, 500));
}
if (!serviceReady) throw new Error('食刻测试服务未就绪，请确认 npm run dev:lan 正在运行且地址正确。');

const localJava = existsSync(join(cache, 'java')) ? (await readdir(join(cache, 'java'))).map(name => join(cache, 'java', name)).find(path => existsSync(join(path, 'bin/java.exe'))) : undefined;
const javaHome = process.env.JAVA_HOME ?? localJava;
const sdk = process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME ?? join(cache, 'sdk');
if (!javaHome || !existsSync(sdk)) throw new Error('缺少 Java 21 或 Android SDK，请按 docs/android-app.md 配置 JAVA_HOME 和 ANDROID_HOME。');
const java = join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
const version = spawnSync(java, ['-version'], { encoding: 'utf8', windowsHide: true });
const major = /version "(\d+)/.exec(version.stderr ?? '')?.[1];
if (version.error || major !== '21') throw new Error('当前安卓构建流程固定使用 JDK 21，请检查 JAVA_HOME。');
const userHome = join(cache, 'java-home');
await mkdir(userHome, { recursive: true });
const env = { ...process.env, SHIKE_APP_PREVIEW_URL: origin, JAVA_HOME: javaHome, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, ANDROID_USER_HOME: join(cache, 'user-home'), GRADLE_USER_HOME: join(cache, 'gradle'), JAVA_TOOL_OPTIONS: `${process.env.JAVA_TOOL_OPTIONS ?? ''} -Duser.home="${userHome}"`.trim() };
const npm = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
// npm 工作区的开发依赖可能提升到根目录，也可能留在 web/node_modules。
const capPackagePath = createRequire(join(web, 'package.json')).resolve('@capacitor/cli/package.json');
const capPackage = JSON.parse(await readFile(capPackagePath, 'utf8'));
const cap = resolve(dirname(capPackagePath), capPackage.bin.capacitor);
function run(file, arguments_, cwd) {
  return new Promise((done, reject) => {
    const child = spawn(file, arguments_, { cwd, env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? done() : reject(new Error(`构建命令失败，退出码 ${code}`)));
  });
}
console.log(`生成安卓测试 APK，连接 ${origin}；不会将模型密钥放入 App。`);
await run(process.execPath, [npm, 'run', 'build'], root);
const fallbackPath = join(web, 'dist/app-connection-error.html');
const fallback = await readFile(fallbackPath, 'utf8');
await writeFile(fallbackPath, fallback.replace('const target = null', `const target = ${JSON.stringify(origin).replace(/</g, '\\u003c')}`));
if (!existsSync(android)) await run(process.execPath, [cap, 'add', 'android'], web);
await run(process.execPath, [cap, 'sync', 'android'], web);
if (process.platform === 'win32') await run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'gradlew.bat assembleDebug --no-daemon --console=plain'], android);
else await run(join(android, 'gradlew'), ['assembleDebug', '--no-daemon', '--console=plain'], android);
const output = resolve(root, 'artifacts/android/shike-preview.apk');
await mkdir(dirname(output), { recursive: true });
await copyFile(join(android, 'app/build/outputs/apk/debug/app-debug.apk'), output + '.tmp');
await rename(output + '.tmp', output);
const tools = join(sdk, 'build-tools/36.0.0/lib/apksigner.jar');
if (!existsSync(tools)) throw new Error('缺少 build-tools 36.0.0，无法验证 APK 签名。');
await run(java, ['-jar', tools, 'verify', '--verbose', output], root);
const bytes = await readFile(output);
await writeFile(join(dirname(output), 'shike-preview.json'), JSON.stringify({ appId: 'cn.anxiu29.shike', mode: 'LAN preview', server: origin, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, null, 2) + '\n');
console.log(`\nAPK 已生成并验签：${output}\n手机下载：${new URL('downloads/shike-preview.apk', origin)}\n电脑需保持 npm run dev:lan 运行；这是调试包，不是商店发行版。`);
