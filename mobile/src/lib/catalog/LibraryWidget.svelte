<script lang="ts">
	import type { Preview } from '../boards/display';
	import type { Session } from '../connection';
	import type { Album, OnPlay } from './catalog';
	import type { Playlist } from './playlists';
	import Library from './Library.svelte';
	import Playlists from './Playlists.svelte';
	import RecentlyPlayed from './RecentlyPlayed.svelte';

	let {
		id,
		display,
		session,
		onopen,
		onartist,
		onplaylist,
		onplay,
		active = true,
		expanded = false
	}: {
		id: string;
		session: Session;
		display: Preview;
		onopen: (album: Album) => void;
		onartist: (artist: { id: string; name: string }) => void;
		onplaylist: (playlist: Playlist) => void;
		onplay: OnPlay;
		active?: boolean;
		expanded?: boolean;
		onexpand: () => void;
	} = $props();
</script>

{#key id}
	{#if id === 'library-recently-played'}
		<RecentlyPlayed {display} {session} {onplay} {active} />
	{:else if id === 'library-playlists'}
		<Playlists {display} {active} {session} onopen={onplaylist} preview={!expanded} />
	{:else if id === 'library-recently-added' || id === 'library-albums' || id === 'library-artists' || id === 'library-tracks'}
		<Library
			{display}
			{active}
			{session}
			{onopen}
			{onartist}
			{onplay}
			kind={id === 'library-artists' ? 'artists' : id === 'library-tracks' ? 'songs' : 'albums'}
			recent={id === 'library-recently-added'}
			preview={!expanded}
		/>
	{/if}
{/key}
