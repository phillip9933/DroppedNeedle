import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
import { DnError, putJson, type Session } from '../connection';
import { path } from '../catalog/catalog';
import { offlineInventory, offlineSupported, preferredOffline } from './media';
import {
	notifyFeedback,
	feedbackRows,
	feedbackScope,
	writeFeedback,
	settleFeedback,
	takeLease,
	releaseLease,
	type FeedbackField,
	type FeedbackValue,
	type FeedbackRecord
} from './feedbackStore';

type Models = components['schemas'];
type Active = { session: Session; scope: string; request: (manual?: boolean) => Promise<void> };
let active: Active | undefined;
const policyChanged = 'dn-offline-policy';
async function put(
	session: Session,
	id: string,
	field: FeedbackField,
	value: FeedbackValue
): Promise<FeedbackValue> {
	if (field === 'favorite') {
		const response = await putJson<Models['FavoriteStatusResponse']>(
			session,
			path('/api/v3/favorites/{kind}/{item_id}', { kind: 'track', item_id: id }),
			{ favorited: value }
		);
		if (typeof response?.favorited !== 'boolean') throw Error('DN did not confirm the favorite.');
		return response.favorited;
	}
	const response = await putJson<Models['RatingStatusResponse']>(
		session,
		path('/api/v3/ratings/{kind}/{item_id}', { kind: 'track', item_id: id }),
		{ rating: value }
	);
	if (!Number.isInteger(response?.rating) || response.rating < 0 || response.rating > 5)
		throw Error('DN did not confirm the track rating.');
	return response.rating;
}
export async function changeTrackFeedback(
	session: Session,
	id: string,
	field: FeedbackField,
	value: FeedbackValue
) {
	if (
		field === 'favorite'
			? typeof value !== 'boolean'
			: typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 5
	)
		throw Error('Choose a valid track preference.');
	const scope = feedbackScope(session);
	if (active && active.scope !== scope) throw Error('This track belongs to a different account.');
	const local =
		scope && offlineSupported ? await offlineInventory(session).catch(() => undefined) : undefined;
	if (!local?.byId.has(id)) {
		const offlineOnly = local?.offlineOnly ?? (await preferredOffline(session).catch(() => true));
		if (!navigator.onLine || offlineOnly)
			throw Error('Save this song offline before editing it without DN.');
		return put(session, id, field, value);
	}
	const record = await writeFeedback(scope, id, field, value);
	notifyFeedback(record, true);
	if (active?.scope === scope) void active.request().catch(() => {});
	return value;
}
export function retryTrackFeedback(session: Session) {
	if (active?.scope !== feedbackScope(session)) return Promise.resolve();
	return active.request(true);
}
export function connectTrackFeedback(session: Session) {
	const scope = feedbackScope(session);
	if (!scope || !offlineSupported) return () => {};
	const owner = crypto.randomUUID();
	let live = true,
		again = false,
		manual = false,
		pending: Promise<void> | undefined,
		wake: ReturnType<typeof setTimeout> | undefined;
	const allowed = async () =>
		live && navigator.onLine && !(await preferredOffline(session).catch(() => true)) && live;
	const deferred = () => {
		if (live && wake === undefined)
			wake = setTimeout(() => {
				wake = undefined;
				void request().catch(() => {});
			}, 3000);
	};
	async function flush(explicit: boolean) {
		if (!(await allowed())) return;
		const eligible = (r: FeedbackRecord) =>
			r.state === 'pending' || (explicit && r.state === 'blocked');
		if (!(await feedbackRows(scope)).some(eligible)) return;
		if (!(await takeLease(scope, owner))) {
			deferred();
			return;
		}
		const tried = new Set<string>();
		try {
			while (live && (await allowed())) {
				const row = (await feedbackRows(scope)).find((r) => eligible(r) && !tried.has(r.revision));
				if (!row) return;
				tried.add(row.revision);
				if (!(await takeLease(scope, owner))) {
					deferred();
					return;
				}
				if (!live) return;
				try {
					const accepted = await put(session, row.id, row.field, row.value);
					const next = await settleFeedback(row, accepted === row.value ? 'confirmed' : 'blocked');
					if (next && live) {
						notifyFeedback(next);
						if (next.state === 'confirmed' && next.field === 'favorite')
							window.dispatchEvent(
								new CustomEvent('dnfavoritechange', {
									detail: { kind: 'track', id: next.id, value: next.value }
								})
							);
					}
				} catch (cause) {
					if (!live) return;
					const blocked =
						cause instanceof DnError &&
						cause.status >= 400 &&
						cause.status < 500 &&
						![401, 408, 425, 429].includes(cause.status);
					const next = await settleFeedback(row, blocked ? 'blocked' : 'pending');
					if (next) notifyFeedback(next);
					if (!blocked) return;
				}
			}
		} finally {
			await releaseLease(scope, owner);
		}
	}
	function request(explicit = false): Promise<void> {
		again = true;
		manual ||= explicit;
		if (pending) return pending;
		pending = (async () => {
			while (live && again) {
				again = false;
				const force = manual;
				manual = false;
				await flush(force);
			}
		})().finally(() => {
			pending = undefined;
			if (live && again) void request().catch(() => {});
		});
		return pending;
	}
	const trigger = () => {
		if (!document.hidden) void request().catch(() => {});
	};
	const instance = { session, scope, request };
	active = instance;
	window.addEventListener('online', trigger);
	window.addEventListener(policyChanged, trigger);
	document.addEventListener('visibilitychange', trigger);
	trigger();
	return () => {
		live = false;
		if (active === instance) active = undefined;
		if (wake !== undefined) clearTimeout(wake);
		window.removeEventListener('online', trigger);
		window.removeEventListener(policyChanged, trigger);
		document.removeEventListener('visibilitychange', trigger);
	};
}
