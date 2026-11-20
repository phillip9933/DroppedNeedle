import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { SecureStorage, KeychainAccess } from '@aparajita/capacitor-secure-storage';

export interface Session {
	serverUrl: string;
	token: string;
	displayName: string;
}

export class DnError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code = ''
	) {
		super(message);
	}
}

export function serverAddress(value: string): string {
	const input = value.trim();
	if (!input) throw new Error('Enter your DroppedNeedle server address.');
	let url: URL;
	try {
		url = new URL(input.includes('://') ? input : 'https://' + input);
	} catch {
		throw new Error('Enter a valid DroppedNeedle server address.');
	}
	const loopback = ['localhost', '[::1]', '127.0.0.1'].includes(url.hostname);
	if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
		throw new Error('Use the HTTPS address of your DroppedNeedle server.');
	}
	if (url.username || url.password || url.search || url.hash)
		throw new Error('Use the server address without credentials, a query, or a fragment.');
	return url.origin + url.pathname.replace(/\/+$/, '');
}

function apiAddress(server: string, path: string) {
	const base = serverAddress(server);
	if (
		!path.startsWith('/api/v3/') ||
		path.includes('\\') ||
		/%(?:2e|2f|5c)/i.test(path.split('?')[0])
	) {
		throw new Error('Invalid DroppedNeedle API address.');
	}
	const target = new URL(base + path);
	if (target.hash || !target.href.startsWith(base + '/api/v3/'))
		throw new Error('Invalid DroppedNeedle API address.');
	return target.href;
}

const memory = new Map<string, string>();
export async function readSecret<T>(key: string): Promise<T | null> {
	const text = Capacitor.isNativePlatform()
		? await SecureStorage.get(key, false, false)
		: memory.get(key);
	return typeof text === 'string' ? (JSON.parse(text) as T) : null;
}
export async function writeSecret(key: string, value: unknown) {
	const text = JSON.stringify(value);
	if (Capacitor.isNativePlatform()) {
		await SecureStorage.set(key, text, false, false, KeychainAccess.whenUnlockedThisDeviceOnly);
	} else {
		memory.set(key, text);
	}
}
export async function removeSecret(key: string) {
	if (Capacitor.isNativePlatform()) await SecureStorage.remove(key, false);
	memory.delete(key);
}

async function request<T>(
	server: string,
	path: string,
	options: {
		session?: Session;
		method?: 'GET' | 'POST';
		body?: unknown;
		artwork?: boolean;
	} = {}
): Promise<T> {
	const { session, method = 'GET', body, artwork } = options;
	const url = apiAddress(server, path);
	const headers: Record<string, string> = { Accept: artwork ? 'image/*' : 'application/json' };
	if (session) headers.Authorization = 'Bearer ' + session.token;
	if (body !== undefined) headers['Content-Type'] = 'application/json';
	let status: number;
	let data: unknown;
	let contentType: string;
	if (Capacitor.isNativePlatform()) {
		const result = await CapacitorHttp.request({
			method,
			url,
			headers,
			data: body,
			disableRedirects: true,
			responseType: artwork ? 'arraybuffer' : 'json',
			connectTimeout: 10_000,
			readTimeout: 30_000
		});
		status = result.status;
		data = result.data;
		contentType =
			Object.entries(result.headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
	} else {
		const response = await fetch(url, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
			credentials: 'omit',
			redirect: 'error',
			cache: 'no-store',
			signal: AbortSignal.timeout(30_000)
		});
		status = response.status;
		contentType = response.headers.get('content-type') ?? '';
		if (response.ok && artwork) {
			const blob = await response.blob();
			data = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
				reader.onerror = () => reject(new Error('Could not read artwork.'));
				reader.readAsDataURL(blob);
			});
		} else if (contentType.includes('json')) {
			data = await response.json();
		}
	}
	if (status < 200 || status >= 300) {
		const problem = (data as { error?: { code?: string; message?: string } } | null)?.error;
		if (session && status === 401 && problem?.code === 'UNAUTHORIZED') {
			window.dispatchEvent(new CustomEvent('dn-session-expired', { detail: session }));
		}
		throw new DnError(
			problem?.message ?? 'DroppedNeedle returned HTTP ' + status + '.',
			status,
			problem?.code
		);
	}
	if (artwork) {
		const mime = contentType.split(';')[0].trim().toLowerCase();
		if (
			!['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'].includes(mime) ||
			typeof data !== 'string'
		) {
			throw new Error('This artwork format is unavailable.');
		}
		return ('data:' + mime + ';base64,' + data) as T;
	}
	if (status !== 204 && !contentType.toLowerCase().includes('json')) {
		throw new Error('This address did not return a DroppedNeedle API response.');
	}
	return data as T;
}

export function getJson<T>(session: Session, path: string): Promise<T> {
	return request(session.serverUrl, path, { session });
}
export function postJson<T>(session: Session, path: string, body?: unknown): Promise<T> {
	return request(session.serverUrl, path, { session, method: 'POST', body });
}
export function getArtwork(session: Session, path: string): Promise<string> {
	return request(session.serverUrl, path, { session, artwork: true });
}

const SESSION_KEY = 'dn.mobile.session';

export function restoreSession() {
	return readSecret<Session>(SESSION_KEY);
}
export function forgetSession() {
	return removeSecret(SESSION_KEY);
}
export async function signOut(session: Session) {
	await forgetSession();
	await postJson(session, '/api/v3/auth/logout');
}

export async function verifyToken(address: string, raw: string): Promise<Session> {
	const token = raw.trim();
	if (!token || /\s/.test(token)) throw new Error('Enter a DroppedNeedle device session token.');
	const session = { serverUrl: serverAddress(address), token, displayName: '' };
	const me = await getJson<{ display_name: string; username?: string | null; id: string }>(
		session,
		'/api/v3/me'
	);
	if (typeof me.display_name !== 'string' || typeof me.id !== 'string')
		throw new Error('This server did not return a DroppedNeedle profile.');
	session.displayName = me.display_name || me.username || me.id;
	return session;
}

export async function saveSession(session: Session) {
	await writeSecret(SESSION_KEY, session);
	return session;
}

export async function useToken(address: string, raw: string) {
	return saveSession(await verifyToken(address, raw));
}

export async function usePassword(
	server: string,
	username: string,
	password: string,
	jellyfin: boolean
) {
	const url = serverAddress(server);
	const path = jellyfin ? '/api/v3/auth/jellyfin/login' : '/api/v3/auth/login';
	const response = await request<{ token: string }>(url, path, {
		method: 'POST',
		body: { username, password, transport: 'bearer' }
	});
	if (!response.token) throw new Error('The server did not return a DroppedNeedle session.');
	return useToken(url, response.token);
}

export interface LoginMethods {
	local: boolean;
	jellyfin: boolean;
	oidc: boolean;
	plex: boolean;
	pairing: boolean;
}
export async function loginMethods(address: string): Promise<LoginMethods> {
	const server = serverAddress(address);
	const methods = await request<LoginMethods>(server, '/api/v3/auth/providers');
	if (typeof methods?.local !== 'boolean' || typeof methods.oidc !== 'boolean')
		throw new Error('Enter the address of a DroppedNeedle v3 server.');
	let pairing = false;
	if (Capacitor.isNativePlatform()) {
		try {
			const result = await CapacitorHttp.get({
				url: server + '/mobile-pairing.json',
				disableRedirects: true,
				connectTimeout: 5_000,
				readTimeout: 5_000
			});
			pairing = result.status === 200 && result.data?.droppedneedle_mobile_pairing === 1;
		} catch {
			/* Older servers do not publish the mobile pairing page. */
		}
	}
	return { ...methods, pairing };
}
