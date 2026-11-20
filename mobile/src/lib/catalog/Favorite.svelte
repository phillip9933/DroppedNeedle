<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Heart } from '@lucide/svelte';
	import { putJson, type Session } from '../connection';
	import { path, errorMessage } from './catalog';
	let {
		session,
		kind,
		id,
		value,
		onchange,
		face
	}: {
		session: Session;
		kind: 'track' | 'album' | 'artist';
		id: string;
		value: boolean;
		onchange?: (value: boolean) => void;
		face?: Snippet<[boolean]>;
	} = $props();
	let saved = $state<boolean>(),
		busy = $state(false),
		error = $state('');
	let active = $derived(saved ?? value);
	async function toggle() {
		if (busy) return;
		busy = true;
		error = '';
		try {
			const r = await putJson<{ favorited: boolean }>(
				session,
				path('/api/v3/favorites/{kind}/{item_id}', { kind, item_id: id }),
				{ favorited: !active }
			);
			saved = r.favorited;
			onchange?.(r.favorited);
			window.dispatchEvent(
				new CustomEvent('dnfavoritechange', { detail: { kind, id, value: r.favorited } })
			);
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

<button
	class="icon-button"
	class:custom-face={!!face}
	disabled={busy}
	aria-pressed={active}
	aria-label={active ? 'Remove ' + kind + ' from favorites' : 'Favorite ' + kind}
	title={active ? 'Remove from favorites' : 'Add to favorites'}
	onclick={toggle}
	>{#if face}{@render face(active)}{:else}<Heart
			size={18}
			fill={active ? 'currentColor' : 'none'}
		/>{/if}</button
>
{#if error}<p role="alert">{error}</p>{/if}

<style>
	button.custom-face {
		width: auto;
		min-width: min(44px, 100%);
		height: auto;
		min-height: 44px;
		max-width: 100%;
	}
</style>
