import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import {
	CALLBACK,
	freshPairing,
	openReply,
	startHandoff
} from '../../../../frontend/src/routes/connect/mobile/handoff';
import {
	readSecret,
	removeSecret,
	serverAddress,
	useToken,
	writeSecret,
	type Session
} from '../connection';

const PENDING = 'dn.mobile.pending';
const DEVICE = 'dn.mobile.device';
interface Pending {
	server: string;
	state: string;
	key: JsonWebKey;
	started: number;
}

export function cancelPairing() {
	return removeSecret(PENDING);
}

export async function openSignIn(address: string) {
	const server = serverAddress(address);
	let device = await readSecret<string>(DEVICE);
	if (!device) {
		device = crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
		await writeSecret(DEVICE, device);
	}
	const { request, privateKey } = await startHandoff(device);
	await writeSecret(PENDING, {
		server,
		state: request.state,
		key: privateKey,
		started: Number(request.started)
	} satisfies Pending);
	const url = new URL(server + '/connect/mobile');
	url.search = new URLSearchParams({ ...request }).toString();
	try {
		await Browser.open({ url: url.href });
	} catch (error) {
		await cancelPairing();
		throw error;
	}
}

export async function watchSignIn(
	connected: (session: Session) => void,
	failed: (cause: unknown) => void
) {
	if (!Capacitor.isNativePlatform()) return () => {};
	const saved = await readSecret<Pending>(PENDING);
	if (saved && !freshPairing(saved.started)) await cancelPairing();
	let working = false;
	let closed = false;
	async function receive({ url }: { url: string }) {
		if (!url.startsWith(CALLBACK + '#') || working || closed) return;
		working = true;
		try {
			const pending = await readSecret<Pending>(PENDING);
			if (!pending) return;
			if (!freshPairing(pending.started)) {
				await cancelPairing();
				throw new Error('This sign-in has expired. Start again.');
			}
			const token = await openReply(url, pending.state, pending.key);
			if (!token) return;
			// Keep the key until verification succeeds in case the phone is briefly offline.
			const session = await useToken(pending.server, token);
			await cancelPairing();
			if (Capacitor.getPlatform() === 'ios') await Browser.close().catch(() => {});
			if (!closed) connected(session);
		} catch (cause) {
			if (!closed) failed(cause);
		} finally {
			working = false;
		}
	}
	const listener = await App.addListener('appUrlOpen', receive);
	const launch = await App.getLaunchUrl();
	if (launch) await receive(launch);
	return () => {
		closed = true;
		void listener.remove();
	};
}
