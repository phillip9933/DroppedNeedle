import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
import { getJson, mutateJson, postJson, type Session } from '../connection';
import { path } from './catalog';
import type { Action, Viewer } from './requestActions';

type S = components['schemas'];
export type Watch = S['WantedItem'];
export function wanted(session: Session) {
	return getJson<S['WantedResponse']>(session, path('/api/v3/requests/wanted'));
}
export function watchActions(session: Session, viewer: Viewer | null, item: Watch): Action[] {
	if (!viewer?.id || (item.user_id && item.user_id !== viewer.id && viewer.role !== 'admin'))
		return [];
	const id = { musicbrainz_id: item.musicbrainz_id };
	const options: Action[] = [];
	function change(
		label: string,
		effect: string,
		route:
			| '/api/v3/requests/wanted/{musicbrainz_id}/stop'
			| '/api/v3/requests/wanted/{musicbrainz_id}/resume'
			| '/api/v3/requests/wanted/{musicbrainz_id}/seen',
		receipt: string
	) {
		options.push({
			label,
			effect,
			async run() {
				const reply = await postJson<S['WantedActionResponse']>(session, path(route, id));
				if (!reply.success) throw new Error('This watch changed. Check its current state.');
				return receipt;
			}
		});
	}
	if (item.state === 'watching') {
		change(
			'Check now',
			'Ask DroppedNeedle to check for this album again soon.',
			'/api/v3/requests/wanted/{musicbrainz_id}/resume',
			'Check requested.'
		);
		change(
			'Stop watching',
			'Pause future checks for this album. You can resume them later.',
			'/api/v3/requests/wanted/{musicbrainz_id}/stop',
			'Watch stopped.'
		);
	} else if (item.state === 'stopped') {
		change(
			'Resume watching',
			'Ask DroppedNeedle to start checking for this album again.',
			'/api/v3/requests/wanted/{musicbrainz_id}/resume',
			'Watch resumed.'
		);
	}
	if (item.new_candidate_count > 0)
		change(
			'Mark matches as seen',
			'Clear the new match count for this album.',
			'/api/v3/requests/wanted/{musicbrainz_id}/seen',
			'Matches marked as seen.'
		);
	options.push({
		label: 'Remove watch',
		effect: 'Remove this album from the watchlist. DroppedNeedle will stop checking for it.',
		async run() {
			const reply = await mutateJson<S['WantedRemovalResponse']>(
				session,
				path('/api/v3/requests/wanted/{musicbrainz_id}', id),
				'DELETE'
			);
			if (!reply.removed) throw new Error('This watch has already changed.');
			return 'Watch removed.';
		}
	});
	return options;
}
export function clearFinished(session: Session, viewer: Viewer): Action {
	return {
		label: 'Clear finished watches',
		effect:
			viewer.role === 'admin'
				? 'Remove stopped and fulfilled watches for everyone on this server? Active watches will keep running.'
				: 'Remove your stopped and fulfilled watches? Your active watches will keep running.',
		async run() {
			const reply = await postJson<S['WantedRemovalResponse']>(
				session,
				path('/api/v3/requests/wanted/clear-finished')
			);
			return (
				reply.removed + ' finished ' + (reply.removed === 1 ? 'watch' : 'watches') + ' removed.'
			);
		}
	};
}
