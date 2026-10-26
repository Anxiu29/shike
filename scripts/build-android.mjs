/** 默认生成内置页面的独立 APK；--preview 显式保留局域网开发模式。 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, readdir, copyFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('..', import.meta.url));
const appRelease = JSON.parse(await readFile(join(root, 'config/app-release.json'), 'utf8'));
const web = join(root, 'packages/web'), android = join(web, 'android'), cache = join(root, '.data-cache/android');
const args = process.argv.slice(2);
const previewIndex = args.indexOf('--preview');
if (previewIndex >= 0) args.splice(previewIndex, 1);
const index = args.indexOf('--url');
const preview = previewIndex >= 0 || index >= 0;
const addresses = Object.entries(networkInterfaces()).flatMap(([name, list]) => (list ?? []).filter(item => item.family === 'IPv4' && !item.internal && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(item.address)).map(item => ({ name, ip: item.address })));
const wifi = addresses.filter(item => /wi-?fi|wlan|无线/i.test(item.name));
const physical = addresses.filter(item => !/virtual|vethernet|vmware|docker|vpn|wsl|tailscale|zerotier/i.test(item.name));
const candidates = wifi.length ? wifi : physical;
const selected = index >= 0 ? args[index + 1] : process.env.SHIKE_APP_PREVIEW_URL ?? (candidates.length === 1 ? `http://${candidates[0].ip}:5180/` : undefined);
if (args.length && (index !== 0 || args.length !== 2)) throw new Error('用法：npm run android:apk -- --url http://电脑局域网IP:5180/');
if (preview && !selected) throw new Error('没有唯一的局域网地址，请通过 --url 指定。');
const url = preview ? new URL(selected) : null;
if (url && (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)) throw new Error('测试地址必须为无凭据、无路径的 HTTP(S) 来源。');
if (url?.protocol === 'http:' && !addresses.some(item => item.ip === url.hostname)) throw new Error('HTTP 联调地址必须使用此电脑当前的局域网 IP，不能使用手机自身的 localhost。');
const origin = url ? url.origin + '/' : undefined;
// 开发服务可能正在因类型构建／依赖更新重启，不把一次短暂 503 当成地址错误。
let serviceReady = false;
for (let attempt = 0; origin && attempt < 15; attempt++) {
  try {
    const health = await fetch(new URL('api/health', origin), { signal: AbortSignal.timeout(1500) });
    if (health.ok && (await health.json()).status === 'ok') { serviceReady = true; break; }
  } catch { /* 启动／重启期间继续等待。 */ }
  await new Promise(done => setTimeout(done, 500));
}
if (preview && !serviceReady) throw new Error('食刻测试服务未就绪，请确认 npm run dev:lan 正在运行且地址正确。');

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
const env = { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, ANDROID_USER_HOME: join(cache, 'user-home'), GRADLE_USER_HOME: join(cache, 'gradle'), JAVA_TOOL_OPTIONS: `${process.env.JAVA_TOOL_OPTIONS ?? ''} -Duser.home="${userHome}"`.trim() };
delete env.SHIKE_APP_PREVIEW_URL;
delete env.VITE_APP_STANDALONE;
if (preview) env.SHIKE_APP_PREVIEW_URL = origin;
else env.VITE_APP_STANDALONE = 'true';
const npm = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
// npm 工作区的开发依赖可能提升到根目录，也可能留在 web/node_modules。
const capPackagePath = createRequire(join(web, 'package.json')).resolve('@capacitor/cli/package.json');
const capPackage = JSON.parse(await readFile(capPackagePath, 'utf8'));
const cap = resolve(dirname(capPackagePath), capPackage.bin.capacitor);
function run(file, arguments_, cwd, childEnv = env) {
  return new Promise((done, reject) => {
    const child = spawn(file, arguments_, { cwd, env: childEnv, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? done() : reject(new Error(`构建命令失败，退出码 ${code}`)));
  });
}
console.log(preview ? `生成局域网联调 APK，连接 ${origin}` : '生成独立 APK：内置页面，可在手机设置多组模型与 API Key，无需自建后端。');
// 先构建正常H5，再单独生成App资源，避免APK构建让npm start继续提供旧网页。
const webEnv = { ...env }; delete webEnv.VITE_APP_STANDALONE;
await run(process.execPath, [npm, 'run', 'build'], root, webEnv);
if (!preview) await run(process.execPath, [npm, 'run', 'build', '-w', '@shike/web'], root);
const fallbackPath = join(web, preview ? 'dist/app-connection-error.html' : 'dist-android/app-connection-error.html');
const fallback = await readFile(fallbackPath, 'utf8');
if (origin) await writeFile(fallbackPath, fallback.replace('const target = null', `const target = ${JSON.stringify(origin).replace(/</g, '\\u003c')}`));
if (!existsSync(android)) await run(process.execPath, [cap, 'add', 'android'], web);
await run(process.execPath, [cap, 'sync', 'android'], web);
// Windows 的 java @argfile 使用系统代码页；中文路径时让 Gradle 按该代码页写文件。
// 源码编译编码仍在 build.gradle 中显式固定 UTF-8。
if (process.platform === 'win32') await run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'gradlew.bat :app:testDebugUnitTest :app:assembleDebug --no-daemon --console=plain -Dorg.gradle.jvmargs=-Dfile.encoding=COMPAT'], android);
else await run(join(android, 'gradlew'), [':app:testDebugUnitTest', ':app:assembleDebug', '--no-daemon', '--console=plain'], android);
const basename = preview ? 'shike-preview' : 'shike';
const output = resolve(root, `artifacts/android/${basename}.apk`);
await mkdir(dirname(output), { recursive: true });
await copyFile(join(android, 'app/build/outputs/apk/debug/app-debug.apk'), output + '.tmp');
await rename(output + '.tmp', output);
const tools = join(sdk, 'build-tools/36.0.0/lib/apksigner.jar');
if (!existsSync(tools)) throw new Error('缺少 build-tools 36.0.0，无法验证 APK 签名。');
await run(java, ['-jar', tools, 'verify', '--verbose', output], root);
const bytes = await readFile(output);
const { builtinPackagedFoods, foods, catalogFoods, recipes, updateManifestSchema } = await import('../packages/shared/dist/index.js');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const metadata = { appId: 'cn.anxiu29.shike', versionCode: appRelease.versionCode, versionName: appRelease.versionName, packagedFoodCount: builtinPackagedFoods.length, foodCount: foods.length, catalogFoodCount: catalogFoods.length, chineseFoodCount: foods.filter(food => food.source.dataset === 'TFDA 食品营养成分').length, recipeCount: recipes.length, mode: preview ? 'LAN preview' : 'standalone', server: origin ?? null, bytes: bytes.length, sha256 };
await writeFile(join(dirname(output), `${basename}.json`), JSON.stringify(metadata, null, 2) + '\n');
if (!preview) {
  const variables = await readFile(join(android, 'variables.gradle'), 'utf8');
  const manifest = updateManifestSchema.parse({ schemaVersion: 1, appId: metadata.appId, versionCode: appRelease.versionCode, versionName: appRelease.versionName, releasedAt: new Date().toISOString(), minSdk: Number(/minSdkVersion\s*=\s*(\d+)/.exec(variables)?.[1]), bytes: bytes.length, sha256, notes: appRelease.notes });
  await writeFile(join(dirname(output), 'shike-update.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(output + '.sha256', `${sha256}  ${basename}.apk\n`);
  const versioned = join(dirname(output), `shike-${appRelease.versionName}`);
  if (existsSync(versioned + '.apk') && createHash('sha256').update(await readFile(versioned + '.apk')).digest('hex') !== sha256) throw new Error('该版本已有不同的APK，请递增config/app-release.json版本后重新构建，不覆盖旧发布文件。');
  await copyFile(output, versioned + '.apk');
  await writeFile(versioned + '.json', JSON.stringify(metadata, null, 2) + '\n');
  await writeFile(versioned + '.apk.sha256', `${sha256}  shike-${appRelease.versionName}.apk\n`);
  await copyFile(join(dirname(output), 'shike-update.json'), versioned + '-update.json');
  console.log('Gitee / GitHub Releases发布文件已准备：shike.apk、shike-update.json、shike.apk.sha256；此命令不会自动上传。');
}
console.log(`\nAPK 已生成并验签：${output}\n${preview ? '联调模式需要电脑服务。' : '独立模式：设置 → 手机自配 Key → 添加模型配置 → 测试并保存，即可联网识别。'}\n这是调试签名测试包，不是商店发行版。`);
if (candidates.length === 1) console.log(`一次性下载安装（需局域网开发服务运行）：http://${candidates[0].ip}:5180/downloads/${basename}.apk`);
