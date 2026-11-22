<script lang="ts">
	import type { Session } from '../connection';
	import { tr } from '../i18n';
	import { errorMessage } from './catalog';
	import {
		coverFromFile,
		playlistCoverOverride,
		savePlaylistCover
	} from './playlistCoverOverrides';

	let { session, id, ondone }: { session: Session; id: string; ondone: () => void } = $props();
	const cover = $derived(playlistCoverOverride(session, id));
	let input: HTMLInputElement;
	let busy = $state(false);
	let error = $state('');
	async function save(file?: File) {
		const account = session,
			playlist = id;
		busy = true;
		error = '';
		try {
			await savePlaylistCover(account, playlist, file ? await coverFromFile(file) : undefined);
			ondone();
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			busy = false;
		}
	}
</script>

<input
	hidden
	bind:this={input}
	type="file"
	accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
	onchange={() => {
		const file = input.files?.[0];
		input.value = '';
		if (file) void save(file);
	}}
/>
<button class="art-action" type="button" disabled={busy} onclick={() => input.click()}>
	{tr('Choose artwork on this device', 'この端末の画像を選択')}
</button>
{#if $cover}<button class="art-action" type="button" disabled={busy} onclick={() => save()}>
		{tr('Use automatic artwork', '自動アートワークに戻す')}
	</button>{/if}
{#if error}<p role="alert">{error}</p>{/if}

<style>
	.art-action {
		min-height: 44px;
		padding: 0.4rem 0.3rem;
		text-align: start;
		border-bottom: 1px solid var(--line);
	}
</style>
