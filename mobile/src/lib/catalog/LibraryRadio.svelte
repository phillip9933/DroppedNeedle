<script lang="ts">
	import { Radio } from '@lucide/svelte';
	import type { Session } from '../connection';
	import { errorMessage, type OnPlay } from './catalog';
	import { libraryRadio, type RadioSeed } from './discovery';
	let {
		session,
		seedType,
		seedId,
		onplay
	}: { session: Session; seedType: RadioSeed; seedId: string; onplay: OnPlay } = $props();
	let busy = $state(false),
		notice = $state('');
	let generation = 0;
	$effect(() => {
		void session;
		void seedType;
		void seedId;
		busy = false;
		notice = '';
		return () => {
			generation++;
		};
	});
	async function play() {
		if (busy) return;
		const owner = generation;
		busy = true;
		notice = '';
		try {
			const tracks = await libraryRadio(session, seedType, seedId);
			if (owner !== generation) return;
			if (tracks.length) await onplay(tracks, 0);
			else notice = 'No playable library tracks for this station.';
		} catch (cause) {
			if (owner === generation) notice = errorMessage(cause);
		} finally {
			if (owner === generation) busy = false;
		}
	}
</script>

<button class="secondary" data-part="library-radio" disabled={busy} onclick={play}
	><Radio size={16} aria-hidden="true" />{busy ? 'Starting radio…' : 'Library radio'}</button
>
{#if notice}<p role="status">{notice}</p>{/if}
