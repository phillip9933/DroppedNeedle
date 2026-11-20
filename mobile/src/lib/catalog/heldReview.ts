import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
import { getJson, postJson, type Session } from '../connection';
import { path } from './catalog';
import type { Viewer } from './requestActions';
type S = components['schemas'];
export type HeldEntry = S['HeldEntryResponse'];
export type HeldFile = S['HeldFileResponse'];
export type HeldAction = S['HeldFileAction'] | 'discard' | 'match';
export type MatchAlbum = Pick<S['SearchResultItem'], 'title' | 'artist' | 'year'> & {
	musicbrainz_id: string;
};
export const actionNames: Record<HeldAction, string> = {
	import: 'Import',
	retry: 'Retry import',
	use_this_version: 'Use this version',
	use_this_file: 'Use this file',
	recheck: 'Recheck fingerprint',
	get_from_album: 'Get from album',
	discard: 'Discard',
	match: 'Match to album'
};
export const curator = (viewer: Viewer) => viewer.role === 'admin' || viewer.role === 'trusted';
export function heldEntries(session: Session, viewer: Viewer, taskId?: string) {
	return getJson<S['HeldListResponse']>(
		session,
		path('/api/v3/held', {}, { task_id: taskId, all: viewer.role === 'admin' ? 'true' : undefined })
	);
}
export function entryTitle(entry: HeldEntry) {
	return (
		entry.album_title ||
		entry.files[0]?.original_name.split(/[\\/]/).filter(Boolean)[0] ||
		'Held files'
	);
}
export function offered(entry: HeldEntry, file: HeldFile, action: HeldAction, viewer: Viewer) {
	if (entry.state !== 'held') return false;
	if (action === 'discard') return true;
	if (action === 'match') return curator(viewer);
	if (action === 'get_from_album' && !(file.recording_mbid || entry.recording_mbid)) return false;
	return file.actions.includes(action);
}
export async function matchAlbums(session: Session, term: string) {
	const data = await getJson<S['SearchBucketResponse']>(
		session,
		path('/api/v3/search/{bucket}', { bucket: 'albums' }, { q: term.trim(), limit: 20, offset: 0 })
	);
	const seen = new Set<string>();
	return data.results.filter((item): item is typeof item & MatchAlbum => {
		if (!item.musicbrainz_id || seen.has(item.musicbrainz_id)) return false;
		seen.add(item.musicbrainz_id);
		return true;
	});
}
export async function actOnHeld(
	session: Session,
	viewer: Viewer,
	entry: HeldEntry,
	files: HeldFile[],
	action: HeldAction,
	album?: MatchAlbum
) {
	if (
		!files.length ||
		files.some(
			(f) => !entry.files.some((source) => source.id === f.id) || !offered(entry, f, action, viewer)
		)
	)
		throw Error('These files changed. Refresh the review.');
	if (action === 'get_from_album') {
		const id = files[0].recording_mbid ?? entry.recording_mbid;
		if (files.length !== 1 || !id) throw Error('Choose one recording.');
		const result = await postJson<S['ActionResponse']>(
			session,
			path('/api/v3/requests/tracks/{musicbrainz_id}/from-album', { musicbrainz_id: id })
		);
		if (!result.success) throw Error(result.message || 'DN could not request the recording.');
		return result.message || 'Requested from the album.';
	}
	const ids = files.map((f) => f.id);
	const params = { entry_id: String(entry.id) };
	let answer: S['HeldActionResponse'];
	if (action === 'match') {
		if (!album) throw Error('Choose an album.');
		answer = await postJson(session, path('/api/v3/held/{entry_id}/match', params), {
			file_ids: ids,
			release_group_mbid: album.musicbrainz_id
		} satisfies S['HeldMatchRequest']);
	} else {
		const route =
			action === 'discard'
				? '/api/v3/held/{entry_id}/discard'
				: action === 'recheck'
					? '/api/v3/held/{entry_id}/recheck'
					: '/api/v3/held/{entry_id}/import';
		answer = await postJson(session, path(route, params), {
			file_ids: ids
		} satisfies S['HeldFilesRequest']);
	}
	return formatHeldReceipt(answer);
}

export function formatHeldReceipt(answer: S['HeldActionResponse']) {
	const result =
		[
			answer.imported && answer.imported + ' imported',
			answer.discarded && answer.discarded + ' discarded',
			answer.already_owned && answer.already_owned + ' already owned',
			answer.still_held && answer.still_held + ' still held'
		]
			.filter(Boolean)
			.join(', ') || 'No files changed';
	return [result + '.', answer.message].filter(Boolean).join(' ');
}

export async function recheckEntries(session: Session, ids: number[]) {
	if (!ids.length) throw Error('No held files need a fingerprint check.');
	const { results } = await postJson<S['HeldRecheckAllResponse']>(
		session,
		path('/api/v3/held/recheck'),
		{ entry_ids: ids } satisfies S['HeldRecheckAllRequest']
	);
	if (!results.length) return 'No files needed a recheck.';
	const imported = results.filter((r) => r.status === 'imported').length,
		failed = results.filter((r) => r.status === 'error');
	return [
		formatHeldReceipt({
			imported,
			discarded: 0,
			already_owned: 0,
			still_held: results.length - imported - failed.length
		}),
		failed.length ? failed.length + ' checks failed. ' + (failed[0].message || '') : ''
	]
		.filter(Boolean)
		.join(' ');
}
