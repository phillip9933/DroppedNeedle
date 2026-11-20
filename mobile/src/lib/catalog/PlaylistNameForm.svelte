<script lang="ts">
	import { onMount } from 'svelte';
	import { errorMessage } from './catalog';
	let {
		initial = '',
		action,
		onsubmit,
		oncancel,
		busy = $bindable(false)
	}: {
		initial?: string;
		action: string;
		onsubmit: (name: string) => Promise<void>;
		oncancel: () => void;
		busy?: boolean;
	} = $props();
	let name = $state('');
	let error = $state('');
	onMount(() => {
		name = initial;
	});
	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (busy || !name.trim()) return;
		busy = true;
		error = '';
		try {
			await onsubmit(name.trim());
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			busy = false;
		}
	}
</script>

<form onsubmit={save}>
	<label>Playlist name<input required bind:value={name} disabled={busy} /></label>
	{#if error}<p role="alert">{error}</p>{/if}
	<div class="actions">
		<button class="primary" disabled={busy || !name.trim()}>{action}</button>
		<button type="button" class="secondary" disabled={busy} onclick={oncancel}>Cancel</button>
	</div>
</form>
