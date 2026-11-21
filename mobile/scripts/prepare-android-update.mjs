import { execFileSync } from 'node:child_process';
import { constants, copyFileSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

function prepare(input, directory) {
	if (!input || !directory || process.argv.length !== 4) {
		throw new Error('Usage: pnpm android:prepare-update <signed APK> <output directory>');
	}

	const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
	if (!sdk) throw new Error('Set ANDROID_HOME to the Android SDK directory.');
	const toolsRoot = join(sdk, 'build-tools');
	const toolsVersion = readdirSync(toolsRoot)
		.filter((name) => /^\d+\.\d+\.\d+$/.test(name))
		.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))[0];
	if (!toolsVersion) throw new Error('Install Android SDK Build Tools first.');
	const tools = join(toolsRoot, toolsVersion);
	const apk = resolve(input);
	const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
	const badging = execFileSync(
		join(tools, process.platform === 'win32' ? 'aapt.exe' : 'aapt'),
		['dump', 'badging', apk],
		{ encoding: 'utf8' }
	);
	const pkg = badging.split('\n').find((line) => line.startsWith('package:')) ?? '';
	if (
		!pkg.includes(" name='app.droppedneedle.mobile'") ||
		!pkg.includes(` versionName='${version}'`)
	) {
		throw new Error(`Expected app.droppedneedle.mobile version ${version}.`);
	}
	if (
		!/ versionCode='[1-9]\d*'/.test(pkg) ||
		/ split=/.test(pkg) ||
		/^uses-split:/m.test(badging)
	) {
		throw new Error('Choose the standalone APK with a positive version code.');
	}
	if (/^application-debuggable(?:\s|$)/m.test(badging)) {
		throw new Error('The APK is debuggable. Choose the signed release build.');
	}
	if (statSync(apk).size > 512 * 1024 * 1024)
		throw new Error('The updater accepts APKs up to 512 MiB.');
	execFileSync('java', ['-jar', join(tools, 'lib', 'apksigner.jar'), 'verify', apk], {
		stdio: 'inherit'
	});

	const asset = `droppedneedle-android-${version}.apk`;
	mkdirSync(directory, { recursive: true });
	const output = resolve(directory, asset);
	if (apk !== output) copyFileSync(apk, output, constants.COPYFILE_EXCL);
	console.log(`GitHub tag: android-v${version}\nRelease asset: ${output}`);
}

try {
	prepare(process.argv[2], process.argv[3]);
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
