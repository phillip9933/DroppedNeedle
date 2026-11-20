<script lang="ts">
	import { untrack } from 'svelte';
	import type { components } from '../../../frontend/src/lib/api/v3/openapi';
	import { getJson, DnError, type Session } from './connection';
	import { path, errorMessage } from './catalog/catalog';
	let {
		session,
		trackId,
		position,
		title = 'Lyrics',
		startOpen = false,
		onseek
	}: {
		session: Session;
		trackId: string;
		position: number;
		title?: string;
		startOpen?: boolean;
		onseek?: (position: number) => void;
	} = $props();
	let open = $state(untrack(() => startOpen)),
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
	<summary>{title}</summary>
	{#if busy}<p role="status">Loading lyrics…</p>{:else if error}<p role="alert">{error}</p>
		<button class="secondary" onclick={() => retry++}>Try again</button>
	{:else if lyrics?.is_synced && lyrics.lines?.length}<div class="lines">
			{#each lyrics.lines as line, i (i)}<p
					class:active={i === current}
					aria-current={i === current ? 'true' : undefined}
				>
					{#if line.start_seconds != null && onseek}<button
							aria-label={'Seek to lyric ' + line.text}
							onclick={() => onseek?.(line.start_seconds!)}>{line.text}</button
						>{:else}{line.text}{/if}
				</p>{/each}
		</div>
	{:else if lyrics?.text}<p class="plain">{lyrics.text}</p>{:else}<p>No lyrics available.</p>{/if}
</details>

<style>
	.lines button {
		text-align: var(--cell-align, start);
		padding: 0.4rem 0;
		width: 100%;
		color: inherit;
	}
	details {
		width: 100%;
		text-align: var(--cell-align, start);
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
