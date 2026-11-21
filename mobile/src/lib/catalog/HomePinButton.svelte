<script lang="ts">
	import { Pin, PinOff } from '@lucide/svelte';
	import { tr } from '../i18n';
	import type { Session } from '../connection';
	import type { PlayerTrack } from '../player';
	import { accountId } from '../boards/layout';
	import {
		collectionKey,
		pinKey,
		setPinned,
		watchHome,
		rememberPlan,
		type HomePin
	} from './homePins';
	import { errorMessage } from './catalog';
	import { observePlaylistMembership } from './playlists';
	import { rememberedPlaylistTrackIds } from './playlistOffline';
	import { offlineSupported, preferredOffline } from '../offline/media';

	let {
		session,
		pin,
		tracks,
		compact = false,
		iconOnly = false,
		labels,
		ondone
	}: {
		session: Session;
		pin?: HomePin;
		tracks?: PlayerTrack[];
		compact?: boolean;
		iconOnly?: boolean;
		labels?: { add: string; remove: string };
		ondone?: () => void;
	} = $props();
	let key = $state(''),
		pinned = $state(false),
		error = $state('');
	$effect(() => {
		const account = session,
			target = pin;
		let active = true,
			stop: (() => void) | undefined;
		key = '';
		pinned = false;
		error = '';
		if (target)
			void accountId(account)
				.then((owner) => {
					if (!active) return;
					const k = collectionKey(account.serverUrl, owner);
					stop = watchHome(k, (data) => {
						pinned = data.pins.some((p) => pinKey(p) === pinKey(target));
					});
					key = k;
				})
				.catch((cause) => {
					if (active) error = errorMessage(cause);
				});
		return () => {
			active = false;
			stop?.();
		};
	});
	const label = $derived(
		labels
			? pinned
				? labels.remove
				: labels.add
			: pin?.kind === 'station'
				? pinned
					? tr('Unpin station from Home', 'ホームからステーションを外す')
					: tr('Pin station to Home', 'ステーションをホームにピン留め')
				: pinned
					? tr('Unpin from Home', 'ホームからピン留めを外す')
					: tr('Pin to Home', 'ホームにピン留め')
	);
	function change() {
		if (!pin || !key) return;
		try {
			const add = !pinned;
			setPinned(key, pin, add);
			if (
				add &&
				pin.kind === 'playlist' &&
				navigator.onLine &&
				!rememberedPlaylistTrackIds(session, pin.id)
			) {
				const account = session,
					id = pin.id;
				void (async () => {
					if (offlineSupported && account.userId && (await preferredOffline(account))) return;
					await observePlaylistMembership(account, id);
				})().catch(() => {
					/* Opening the playlist refreshes its membership after reconnecting. */
				});
			}
			if (add && tracks?.length) rememberPlan(key, pin, tracks);
			ondone?.();
		} catch (cause) {
			error = errorMessage(cause);
		}
	}
</script>

{#if pin}
	<button
		class:icon-button={iconOnly}
		aria-label={label}
		title={iconOnly ? label : undefined}
		class:secondary={!compact && !iconOnly}
		class:plain={compact}
		aria-pressed={pinned}
		disabled={!key}
		onclick={change}
	>
		{#if pinned}<PinOff size={16} />{:else}<Pin size={16} />{/if}{#if !iconOnly}{label}{/if}
	</button>
	{#if error}<p role="alert">{error}</p>{/if}
{/if}

<style>
	.plain {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		min-height: 44px;
		padding: 0.3rem;
		text-align: start;
	}
</style>
