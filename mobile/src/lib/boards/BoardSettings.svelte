<script lang="ts">
	import { onMount } from 'svelte';
	import type { Session } from '../connection';
	import { accountId, loadLayout, saveLayout, type LayoutTarget, type Section } from './layout';
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
	onMount(() => {
		void read();
	});
</script>

{#if error}<p role="alert">{error}</p>
	<button class="text-button" onclick={read}>Try again</button><button
		class="text-button"
		onclick={onback}>Back</button
	>
{:else if owner}<LayoutEditor
		{board}
		{sections}
		{onback}
		onsave={(items) => {
			saveLayout(session.serverUrl, owner, board, items);
			onback();
		}}
	/>
{:else}<p role="status">Loading layout…</p>{/if}
