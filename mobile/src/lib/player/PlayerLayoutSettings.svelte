<script lang="ts">
	import type { Session } from '../connection';
	import LayoutEditor from '../boards/LayoutEditor.svelte';
	import { accountId, loadLayout, saveLayout, type Section } from '../boards/layout';
	let { session, onback }: { session: Session; onback: () => void } = $props();
	let owner = $state(''),
		sections = $state<Section[] | null>(null),
		error = $state(''),
		retry = $state(0);
	$effect(() => {
		const current = session;
		void retry;
		let active = true;
		sections = null;
		error = '';
		accountId(current)
			.then((id) => {
				if (!active) return;
				owner = id;
				sections = loadLayout(current.serverUrl, id, 'player');
			})
			.catch(() => {
				if (active) error = 'Could not load your Now Playing layout.';
			});
		return () => {
			active = false;
		};
	});
	function save(items: Section[]) {
		saveLayout(session.serverUrl, owner, 'player', items);
		onback();
	}
</script>

{#if sections}
	<LayoutEditor board="player" {sections} onsave={save} {onback} />
{:else}
	<button class="text-button" onclick={onback}>Cancel</button>
	{#if error}<p role="alert">{error}</p>
		<button class="secondary" onclick={() => retry++}>Try again</button>
	{:else}<p role="status">Loading Now Playing layout…</p>{/if}
{/if}
