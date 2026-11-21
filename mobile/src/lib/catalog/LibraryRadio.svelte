<script lang="ts">
	import { tr, uiText } from '../i18n';
	import { Radio } from '@lucide/svelte';
	import type { Session } from '../connection';
	import { errorMessage, type OnPlay } from './catalog';
	import { libraryRadio, type RadioSeed } from './discovery';
	import { accountId } from '../boards/layout';
	import { collectionKey, rememberPlan, stationPin } from './homePins';
	import HomePinButton from './HomePinButton.svelte';
	import type { PlayerTrack } from '../player';
	let {
		session,
		seedType,
		seedId,
		seedTitle,
		showPin = true,
		label,
		onstart,
		onplan,
		onplay
	}: {
		session: Session;
		seedType: RadioSeed;
		seedId: string;
		seedTitle: string;
		showPin?: boolean;
		label?: string;
		onstart?: () => void;
		onplan?: (tracks: PlayerTrack[]) => void;
		onplay: OnPlay;
	} = $props();
	const pin = $derived(stationPin(seedType, seedId, seedTitle));
	let previous = $state.raw<PlayerTrack[]>([]);
	let busy = $state(false),
		notice = $state('');
	let generation = 0;
	$effect(() => {
		void session;
		void seedType;
		void seedId;
		previous = [];
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
			if (tracks.length) {
				previous = tracks;
				onplan?.(tracks);
				const server = session.serverUrl,
					target = pin;
				void accountId(session)
					.then((ownerId) => rememberPlan(collectionKey(server, ownerId), target, tracks))
					.catch(() => {});
				await onplay(tracks, 0);
				if (owner === generation) onstart?.();
			} else notice = 'No playable library tracks for this station.';
		} catch (cause) {
			if (owner === generation) notice = errorMessage(cause);
		} finally {
			if (owner === generation) busy = false;
		}
	}
</script>

<button class="secondary" data-part="library-radio" disabled={busy} onclick={play}
	><Radio size={16} aria-hidden="true" />{busy
		? uiText('Starting radio…')
		: (label ?? tr('Play station', 'ステーションを再生'))}</button
>
{#if showPin}<HomePinButton {session} {pin} tracks={previous} />{/if}
{#if notice}<p role="status">{notice}</p>{/if}
