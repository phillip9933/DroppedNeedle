<script lang="ts">
	import { onMount } from 'svelte';
	import type { Session } from '../connection';
	import { accountId, loadLayout, saveLayout, type LayoutTarget, type Section } from './layout';
	import PlayerComposer from '../player/PlayerComposer.svelte';
	import LayoutEditor from './LayoutEditor.svelte';
	let { board, session, onback }: { board: LayoutTarget; session: Session; onback: () => void } =
		$props();
	let owner = $state(''),
		sections = $state<Section[]>([]),
		error = $state('');
	async function read() {
		error = '';
		try {
			owner = await accountId(session);
			sections = loadLayout(session.serverUrl, owner, board);
		} catch {
			error = 'Could not load this layout.';
		}
	}
	function save(items: Section[]) {
		saveLayout(session.serverUrl, owner, board, items);
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
{:else if owner}{#if board === 'player'}<PlayerComposer {sections} {onback} onsave={save} />
	{:else}<LayoutEditor {board} {sections} {onback} onsave={save} />{/if}
{:else}<p role="status">Loading layout…</p>{/if}
