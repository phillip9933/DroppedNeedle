<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import type { Session } from '../connection';
	import {
		accountId,
		loadLayout,
		saveLayout,
		savedSections,
		type LayoutTarget,
		type Section
	} from './layout';
	import type { FilterSection } from './filteredSections';
	import PlayerComposer from '../player/PlayerComposer.svelte';
	import LayoutEditor from './LayoutEditor.svelte';
	let {
		board,
		session,
		menuToggle,
		onback
	}: { board: LayoutTarget; session: Session; menuToggle: Snippet; onback: () => void } = $props();
	let filters = $state<FilterSection[]>([]);
	let owner = $state(''),
		sections = $state<Section[]>([]),
		error = $state('');
	async function read() {
		error = '';
		try {
			owner = await accountId(session);
			if (board !== 'player') filters = savedSections(session.serverUrl, owner);
			sections = loadLayout(session.serverUrl, owner, board);
		} catch {
			error = 'Could not load this layout.';
		}
	}
	function save(items: Section[], custom?: FilterSection[]) {
		saveLayout(
			session.serverUrl,
			owner,
			board,
			items,
			custom ? { before: filters, after: custom } : undefined
		);
		onback();
	}
	onMount(() => {
		void read();
	});
</script>

{#if error}<p role="alert">{error}</p>
	<button class="text-button" onclick={read}>Try again</button><button
		class="text-button"
		onclick={onback}>Back</button
	>
{:else if owner}{#if board === 'player'}<PlayerComposer
			{sections}
			{menuToggle}
			{onback}
			onsave={save}
		/>
	{:else}<LayoutEditor {board} {sections} {filters} {onback} onsave={save} />{/if}
{:else}<p role="status">Loading layout…</p>{/if}
