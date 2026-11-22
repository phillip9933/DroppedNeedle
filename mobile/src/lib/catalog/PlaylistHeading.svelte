<script lang="ts">
	import { tr } from '../i18n';
	import type { Session } from '../connection';
	import PlaylistCover from './PlaylistCover.svelte';
	import PlaylistCoverPicker from './PlaylistCoverPicker.svelte';
	import PlaylistDialog from './PlaylistDialog.svelte';
	let {
		session,
		id,
		title,
		covers,
		cacheOnly = false
	}: {
		session: Session;
		id: string;
		title: string;
		covers?: string[];
		cacheOnly?: boolean;
	} = $props();
	let editing = $state(false);
</script>

<div class="playlist-heading">
	<button
		type="button"
		aria-label={tr('Change playlist artwork', 'プレイリストの画像を変更')}
		onclick={() => (editing = true)}
	>
		<PlaylistCover {session} {id} {covers} {cacheOnly} />
	</button>
	<h1>{title}</h1>
</div>
{#if editing}
	<PlaylistDialog
		title={tr('Playlist artwork', 'プレイリストの画像')}
		onclose={() => (editing = false)}
	>
		<div class="options">
			<PlaylistCoverPicker {session} {id} ondone={() => (editing = false)} />
		</div>
		<button type="button" class="text-button" onclick={() => (editing = false)}
			>{tr('Done', '完了')}</button
		>
	</PlaylistDialog>
{/if}

<style>
	.playlist-heading {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		margin-block: 0.5rem 1rem;
	}
	.playlist-heading button {
		width: clamp(3rem, 15vw, 5rem);
		flex: none;
		padding: 0;
	}
	h1 {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.options {
		display: grid;
	}
</style>
