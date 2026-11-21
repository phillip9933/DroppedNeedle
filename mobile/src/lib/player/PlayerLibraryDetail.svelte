<script lang="ts">
	import { uiText } from '../i18n';
	import { onMount } from 'svelte';
	import type { Session } from '../connection';
	import { errorMessage, type CatalogTab, type OnPlay } from '../catalog/catalog';
	import Catalog from '../catalog/Catalog.svelte';
	import LibraryGroup from '../catalog/LibraryGroup.svelte';
	import { librarySelectionBack } from '../catalog/librarySelection.svelte';
	import { resolveCredit, type PlayerCredit, type RelatedItem } from './related';
	let {
		session,
		credit,
		onplay,
		onback,
		onnavigate
	}: {
		session: Session;
		credit: PlayerCredit;
		onplay: OnPlay;
		onback: () => void;
		onnavigate: (tab: CatalogTab) => void;
	} = $props();
	let detail = $state<RelatedItem>(),
		busy = $state(true),
		issue = $state(''),
		revision = $state(0);
	const dismiss = librarySelectionBack();
	$effect(() => {
		const target = credit,
			owner = session;
		void revision;
		const controller = new AbortController();
		detail = undefined;
		issue = '';
		busy = true;
		void resolveCredit(owner, target, controller.signal)
			.then((result) => {
				if (!controller.signal.aborted) detail = result;
			})
			.catch((cause) => {
				if (!controller.signal.aborted) issue = errorMessage(cause);
			})
			.finally(() => {
				if (!controller.signal.aborted) busy = false;
			});
		return () => controller.abort();
	});
	onMount(() => {
		const refresh = () => revision++;
		function back(e: Event) {
			if (detail?.kind === 'saved' && !e.defaultPrevented && dismiss()) e.preventDefault();
		}
		window.addEventListener('dn-back', back);
		window.addEventListener('dn-offline-policy', refresh);
		window.addEventListener('online', refresh);
		window.addEventListener('offline', refresh);
		return () => {
			window.removeEventListener('dn-back', back);
			window.removeEventListener('dn-offline-policy', refresh);
			window.removeEventListener('online', refresh);
			window.removeEventListener('offline', refresh);
		};
	});
</script>

{#if detail && detail.kind !== 'saved'}
	<Catalog
		{session}
		active
		tab="library"
		initialCredit={detail}
		onreturn={onback}
		{onplay}
		{onnavigate}
	/>
{:else}
	<button class="text-button" onclick={onback}>{uiText('Back to Now Playing')}</button>
	{#if busy}<p role="status">{uiText('Opening')} {credit.kind}…</p>
	{:else if issue}<p role="alert">{issue}</p>
		<button class="secondary" onclick={() => revision++}>{uiText('Try again')}</button>
	{:else if detail?.kind === 'saved'}
		<small>{uiText('On this device')}</small>
		<LibraryGroup
			{session}
			item={detail.item}
			tracks={detail.item.localTracks ?? []}
			offline
			active
			{onplay}
		/>
	{:else}
		<h1>{credit.track[credit.kind]}</h1>
		<p>{uiText('This track has no available')} {credit.kind} {uiText('link in this library.')}</p>
	{/if}
{/if}
