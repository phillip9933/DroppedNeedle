import { expect, it } from 'vitest';
import { CALLBACK, openReply, readPairing, recipient, sealToken, startHandoff } from './handoff';

it('only the phone that started a pairing can recover its token from the callback', async () => {
	const phone = await startHandoff('A1B2C3D4');
	const other = await startHandoff('F0E1D2C3');
	const request = readPairing(new URLSearchParams({ ...phone.request }));
	expect(request).toEqual(phone.request);
	expect(
		readPairing(new URLSearchParams({ ...phone.request, started: String(Date.now() - 600_001) }))
	).toBeNull();
	const token = 'test-device-token';
	const address = await sealToken(phone.request, await recipient(phone.request), token);
	expect(address).not.toContain(token);
	expect(new URL(address).search).toBe('');
	expect(await openReply(address, phone.request.state, phone.privateKey)).toBe(token);
	expect(await openReply(address, other.request.state, phone.privateKey)).toBeNull();
	expect(
		await openReply(
			address.replace(CALLBACK, CALLBACK + '/another'),
			phone.request.state,
			phone.privateKey
		)
	).toBeNull();
	await expect(openReply(address, phone.request.state, other.privateKey)).rejects.toThrow();
});
