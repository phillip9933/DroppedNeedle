<script lang="ts">
	import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
	import { SvelteSet } from 'svelte/reactivity';
	import { tr } from '../i18n';
	import { getJson, type Session } from '../connection';
	import { localAlbum, path, errorMessage, type Album } from './catalog';
	import { loadNearEnd } from './browseViewport';
	import Albums from './Albums.svelte';

	type Schema = components['schemas'];
	let {
		session,
		artistId,
		artistMbid,
		kind,
		active,
		onopen
	}: {
		session: Session;
		artistId: string;
		artistMbid?: string | null;
		kind: 'album' | 'ep' | 'single' | 'other' | 'unknown';
		active: boolean;
		onopen: (a: Album) => void;
	} = $props();
	let groups = $state.raw<Record<string, Album[]>>({}),
		busy = $state(true),
		error = $state(''),
		partial = $state(false),
		revision = $state(0),
		limit = $state(30);
	$effect(() => {
		void kind;
		limit = 30;
	});
	$effect(() => {
		const account = session,
			id = artistId,
			mbid = artistMbid;
		void revision;
		const job = new AbortController();
		busy = true;
		error = '';
		groups = {};
		partial = false;
		async function read() {
			// Owned release types are independent of the server's Discover release visibility preferences.
			const metadata = mbid
				? await getJson<Schema['OwnedReleases']>(
						account,
						path('/api/v3/artists/{artist_mbid}/owned-releases', { artist_mbid: mbid }),
						job.signal
					)
				: undefined;
			if (job.signal.aborted) return;
			const types = new Map(metadata?.items.map((r) => [r.id.toLowerCase(), r]));
			partial = metadata?.complete === false;
			const result: Record<string, Album[]> = {
				album: [],
				ep: [],
				single: [],
				other: [],
				unknown: []
			};
			const seenAlbums = new SvelteSet<string>(),
				seenCursors = new SvelteSet<string>();
			let cursor: string | undefined;
			do {
				const page = await getJson<Schema['AlbumPage']>(
					account,
					path('/api/v3/library/artists/{id}/albums', { id }, { limit: 100, after: cursor }),
					job.signal
				);
				if (job.signal.aborted) return;
				for (const album of page.items) {
					if (seenAlbums.has(album.id)) continue;
					seenAlbums.add(album.id);
					const type = types.get(album.release_group_mbid?.toLowerCase() ?? ''),
						primary = type?.primary_type?.toLowerCase();
					const section =
						album.is_compilation || type?.secondary_types.length
							? 'other'
							: !primary
								? 'unknown'
								: ['album', 'ep', 'single'].includes(primary)
									? primary
									: 'other';
					result[section].push(localAlbum(album));
				}
				groups = Object.fromEntries(Object.entries(result).map(([k, v]) => [k, [...v]]));
				cursor = page.next ?? undefined;
				if (cursor && seenCursors.has(cursor))
					throw Error(
						tr(
							'DroppedNeedle returned a repeated album page.',
							'DroppedNeedleから同じアルバムページが返されました。'
						)
					);
				if (cursor) seenCursors.add(cursor);
			} while (cursor);
		}
		void read()
			.catch((e) => {
				if (!job.signal.aborted) error = errorMessage(e);
			})
			.finally(() => {
				if (!job.signal.aborted) busy = false;
			});
		return () => job.abort();
	});
	const matches = $derived(groups[kind] ?? []);
	function more() {
		limit += 30;
	}
</script>

{#if matches.length}<Albums {session} albums={matches.slice(0, limit)} {onopen} />{/if}
{#if matches.length > limit}<button
		class="secondary"
		data-selection-more
		use:loadNearEnd={{ active, enabled: true, load: more }}
		onclick={more}>{tr('More albums', 'さらにアルバムを表示')}</button
	>{/if}
{#if busy}<p role="status">{tr('Checking library releases…', 'ライブラリのリリースを確認中…')}</p>
{:else if error}<p role="alert">{error}</p>
	<button class="text-button" onclick={() => revision++}
		>{tr('Retry releases', 'リリースを再読み込み')}</button
	>
{:else}
	{#if !matches.length}<p>
			{tr('No library releases of this type.', 'この種類のリリースはライブラリにありません。')}
		</p>{/if}
	{#if partial}<p>
			{tr(
				'DroppedNeedle is still identifying releases. Unclassified titles appear under Unknown.',
				'DroppedNeedleでリリースを識別中です。未分類のタイトルは「不明」に表示されます。'
			)}
		</p>
		<button class="text-button" onclick={() => revision++}
			>{tr('Refresh release types', 'リリースの種類を更新')}</button
		>{/if}
{/if}
