import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
import { getJson, type Session } from '../connection';
import { path } from './catalog';
import { libraryPlan } from './discovery';
import { mbid, type Mix, type MixSeed } from './homePins';

type Schema = components['schemas'];
export async function findMixSeeds(
	session: Session,
	mode: Mix['mode'],
	q: string,
	signal: AbortSignal,
	after?: string
) {
	const params = { q: q.trim(), limit: 40, after };
	if (mode === 'artists') {
		const page = await getJson<Schema['ArtistPage']>(
			session,
			path('/api/v3/library/artists', {}, params),
			signal
		);
		return {
			seeds: page.items.flatMap((a): MixSeed[] =>
				a.artist_mbid &&
				mbid.test(a.artist_mbid) &&
				a.artist_mbid.toLowerCase() !== '89ad4ac3-39f7-470e-963a-56509c546377'
					? [{ id: a.artist_mbid, title: a.name, artist: a.name, artistMbid: a.artist_mbid }]
					: []
			),
			next: page.next
		};
	}
	const page = await getJson<Schema['AlbumPage']>(
		session,
		path('/api/v3/library/albums', {}, params),
		signal
	);
	return {
		seeds: page.items.flatMap((a): MixSeed[] =>
			a.release_group_mbid && mbid.test(a.release_group_mbid)
				? [
						{
							id: a.release_group_mbid,
							title: a.title,
							artist: a.artist_name,
							artistMbid: a.artist_mbid ?? ''
						}
					]
				: []
		),
		next: page.next
	};
}
export function mixRequest(mix: Pick<Mix, 'mode' | 'seeds'>) {
	return {
		seed_type: 'items' as const,
		items: mix.seeds.map((s) => ({
			artist_mbid: s.artistMbid,
			artist_name: s.artist,
			album_mbid: mix.mode === 'albums' ? s.id : undefined,
			album_name: mix.mode === 'albums' ? s.title : undefined
		}))
	};
}
export function playMix(session: Session, mix: Pick<Mix, 'mode' | 'seeds'>, signal: AbortSignal) {
	return libraryPlan(session, mixRequest(mix), signal);
}
