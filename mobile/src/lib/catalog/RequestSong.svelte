<script lang="ts">
	import { Download, Check } from '@lucide/svelte';
	import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
	import { postJson, type Session } from '../connection';
	import { path, errorMessage } from './catalog';
	type S = components['schemas'];
	let {
		session,
		song,
		requested = false
	}: { session: Session; song: S['TrackIntake']; requested?: boolean } = $props();
	let receipt = $state(''),
		error = $state(''),
		busy = $state(false);
	async function submit() {
		if (busy || receipt || requested) return;
		busy = true;
		error = '';
		try {
			const result = await postJson<S['TrackIntakeResponse']>(
				session,
				path('/api/v3/requests/tracks'),
				song
			);
			receipt = result.status === 'awaiting_approval' ? 'Awaiting approval' : 'Requested';
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
</script>

<button
	class="icon-button"
	disabled={busy || !!receipt || requested}
	aria-label={(receipt || requested ? 'Requested ' : 'Request song ') + song.track_title}
	title={receipt || 'Request song'}
	onclick={submit}
>
	{#if receipt || requested}<Check size={17} />{:else}<Download size={17} />{/if}
</button>
{#if receipt}<small role="status">{receipt}</small>{/if}{#if error}<p role="alert">{error}</p>{/if}
