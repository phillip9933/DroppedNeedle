import assert from 'node:assert/strict';
import test from 'node:test';
import {
	checkPublishedVersion,
	releaseRepositories,
	signerFingerprint
} from './prepare-android-update.mjs';

test('only the verified APK signer identifies the distribution certificate', () => {
	const digest = 'ab'.repeat(32);
	const signer = 'Signer #1 certificate SHA-256 digest: ' + digest;
	assert.equal(signerFingerprint('Signer #1 certificate DN: CN=fixture\n' + signer), digest);
	assert.throws(() =>
		signerFingerprint('Source Stamp Signer certificate SHA-256 digest: ' + digest)
	);
	assert.throws(() => signerFingerprint(signer + '\n' + signer.replace('#1', '#2')));
});

test('both feeds participate through the final 1.0.0 release', () => {
	const both = ['phillip9933/OtoHari', 'phillip9933/DroppedNeedle'];
	for (const version of ['0.9.1', '0.10.0-beta.1', '1.0.0-beta.1', '1.0.0']) {
		assert.deepEqual(releaseRepositories(version), both);
	}
	for (const version of ['1.0.1-beta.1', '1.1.0', '2.0.0']) {
		assert.deepEqual(releaseRepositories(version), ['phillip9933/OtoHari']);
	}
	for (const version of ['not-a-version', '00.9.0', '1.0.1+build', '1.0.0-beta.01']) {
		assert.throws(() => releaseRepositories(version));
	}
});

test('a new release must upgrade the previous Android build code on each feed', () => {
	const source = 'phillip9933/DroppedNeedle';
	const previous = { code: 29, version: '0.9.0', digest: 'a'.repeat(64) };
	const next = { code: 30, version: '0.9.1', digest: 'b'.repeat(64) };
	checkPublishedVersion(next, previous, source);
	assert.throws(() => checkPublishedVersion(next, { ...previous, code: 30 }, source));
	assert.throws(() => checkPublishedVersion(next, { ...previous, code: 31 }, source));
});

test('a mirror retry can reuse only the original signed bytes for a published version', () => {
	const source = 'phillip9933/OtoHari';
	const published = { code: 30, version: '0.9.1', digest: 'a'.repeat(64) };
	checkPublishedVersion(published, published, source);
	assert.throws(() =>
		checkPublishedVersion({ ...published, digest: 'b'.repeat(64) }, published, source)
	);
});
