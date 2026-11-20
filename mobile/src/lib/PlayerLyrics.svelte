<script lang="ts">
	import type { components } from '../../../frontend/src/lib/api/v3/openapi';
	import { getJson, DnError, type Session } from './connection';
	import { path, errorMessage } from './catalog/catalog';
	let { session, trackId, position }: { session: Session; trackId: string; position: number } =
		$props();
	let open = $state(false),
		lyrics = $state<components['schemas']['LyricsView'] | null>(null),
		error = $state(''),
		busy = $state(false),
		retry = $state(0);
	let current = $derived.by(() => {
		const lines = lyrics?.lines ?? [];
		for (let i = lines.length - 1; i >= 0; i--) {
			const start = lines[i].start_seconds;
			if (start != null && start <= position) return i;
		}
		return -1;
	});
	$effect(() => {
		const id = trackId,
			account = session;
		void retry;
		if (!open) return;
		let active = true;
		busy = true;
		error = '';
		lyrics = null;
		getJson<components['schemas']['LyricsView']>(
			account,
			path('/api/v3/library/tracks/{id}/lyrics', { id })
		)
			.then(
				(v) => {
					if (active) lyrics = v;
				},
				(e) => {
					if (active && !(e instanceof DnError && e.status === 404)) error = errorMessage(e);
				}
			)
			.finally(() => {
				if (active) busy = false;
			});
		return () => {
			active = false;
		};
	});
</script>

<details bind:open data-part="lyrics">
	<summary>Lyrics</summary>
	{#if busy}<p role="status">Loading lyrics…</p>{:else if error}<p role="alert">{error}</p>
		<button class="secondary" onclick={() => retry++}>Try again</button>
	{:else if lyrics?.is_synced && lyrics.lines?.length}<div class="lines">
			{#each lyrics.lines as line, i (i)}<p
					class:active={i === current}
					aria-current={i === current ? 'true' : undefined}
				>
					{line.text}
				</p>{/each}
		</div>
	{:else if lyrics?.text}<p class="plain">{lyrics.text}</p>{:else}<p>No lyrics available.</p>{/if}
</details>

<style>
	details {
		width: 100%;
		text-align: left;
	}
	summary {
		cursor: pointer;
		padding: 0.65rem 0;
		font-weight: 600;
	}
	.lines,
	.plain {
		max-height: 45dvh;
		overflow: auto;
		white-space: pre-wrap;
	}
	.lines p {
		margin: 0.3rem 0;
		color: var(--muted);
	}
	.lines p.active {
		color: var(--accent);
		font-weight: 700;
	}
</style>
