<script lang="ts">
	import type { DrawerControl } from '../NavigationDrawer.svelte';
	import { onMount } from 'svelte';
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
	import { openPlayerDraft, type PlayerDraft } from '../player/playerDraft';
	import LayoutEditor from './LayoutEditor.svelte';
	let {
		board,
		session,
		navigation,
		onback
	}: { board: LayoutTarget; session: Session; navigation: DrawerControl; onback: () => void } =
		$props();
	let filters = $state<FilterSection[]>([]);
	let recovery = $state.raw<PlayerDraft>();
	let owner = $state(''),
		sections = $state<Section[]>([]),
		error = $state('');
	async function read() {
		error = '';
		try {
			owner = await accountId(session);
			if (board !== 'player') filters = savedSections(session.serverUrl, owner);
			sections = loadLayout(session.serverUrl, owner, board);
			if (board === 'player') recovery = await openPlayerDraft(session.serverUrl, owner, sections);
		} catch {
			error = 'Could not load this layout.';
		}
	}
	function persist(items: Section[], custom?: FilterSection[]) {
		saveLayout(
			session.serverUrl,
			owner,
			board,
			items,
			custom ? { before: filters, after: custom } : undefined
		);
	}
	function save(items: Section[], custom?: FilterSection[]) {
		persist(items, custom);
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
{:else if board === 'player' && recovery}
	<PlayerComposer {recovery} {navigation} {onback} onsave={persist} />
{:else if board !== 'player' && owner}
	<LayoutEditor {board} {sections} {filters} {onback} onsave={save} />
{:else}<p role="status">Loading layout…</p>{/if}
