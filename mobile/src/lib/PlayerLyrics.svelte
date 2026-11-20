<script lang="ts">
	import { prefersReducedMotion } from 'svelte/motion';
	import type { components } from '../../../frontend/src/lib/api/v3/openapi';
	import type { Session } from './connection';
	import { trackLyrics } from './offline/lyrics';
	import { errorMessage } from './catalog/catalog';
	let {
		session,
		trackId,
		position,
		sample = false,
		onseek
	}: {
		session: Session;
		trackId: string;
		position: number;
		sample?: boolean;
		onseek?: (position: number) => void;
	} = $props();
	let lyrics = $state<components['schemas']['LyricsView'] | null>(null),
		error = $state(''),
		busy = $state(false),
		retry = $state(0);
	let handledRetry = 0;
	let linesPanel = $state<HTMLDivElement>();
	let following = $state(true);
	let current = $derived.by(() => {
		const lines = lyrics?.lines ?? [];
		for (let i = lines.length - 1; i >= 0; i--) {
			const start = lines[i].start_seconds;
			if (start != null && start <= position) return i;
		}
		return -1;
	});
	$effect(() => {
		const box = linesPanel;
		if (!following || current < 0 || !box) return;
		const row = box.children.item(current);
		if (!(row instanceof HTMLElement)) return;
		box.scrollTo({
			top: row.offsetTop + (row.offsetHeight - box.clientHeight) / 2,
			behavior: prefersReducedMotion.current ? 'instant' : 'smooth'
		});
	});
	function readAhead() {
		if (!following || !linesPanel || linesPanel.scrollHeight <= linesPanel.clientHeight) return;
		linesPanel.scrollTo({ top: linesPanel.scrollTop, behavior: 'instant' });
		following = false;
	}
	function watchReading(node: HTMLElement) {
		const keyboard = (e: KeyboardEvent) => {
			if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', 'Tab'].includes(e.key))
				readAhead();
		};
		const scrollbar = (e: PointerEvent) => {
			if (e.pointerType === 'mouse' && e.target === node) readAhead();
		};
		node.addEventListener('wheel', readAhead, { passive: true });
		node.addEventListener('touchmove', readAhead, { passive: true });
		node.addEventListener('keydown', keyboard);
		node.addEventListener('pointerdown', scrollbar);
		return {
			destroy() {
				node.removeEventListener('wheel', readAhead);
				node.removeEventListener('touchmove', readAhead);
				node.removeEventListener('keydown', keyboard);
				node.removeEventListener('pointerdown', scrollbar);
			}
		};
	}
	$effect(() => {
		const id = trackId,
			account = session;
		const attempt = retry;
		if (sample) return;
		const force = attempt !== handledRetry;
		handledRetry = attempt;
		const controller = new AbortController();
		following = true;
		busy = true;
		error = '';
		lyrics = null;
		trackLyrics(account, id, controller.signal, force)
			.then(
				(v) => {
					if (!controller.signal.aborted) lyrics = v;
				},
				(e) => {
					if (!controller.signal.aborted) error = errorMessage(e);
				}
			)
			.finally(() => {
				if (!controller.signal.aborted) busy = false;
			});
		return () => {
			controller.abort();
		};
	});
</script>

<div class="lyrics-body" data-part="lyrics" data-gesture-scroll>
	{#if busy}<p role="status">Loading lyrics…</p>{:else if error}<p role="alert">{error}</p>
		<button class="secondary" onclick={() => retry++}>Try again</button>
	{:else if sample}<p class="plain">
			Our shadows cross the water<br />Where the evening current turns
		</p>{:else if lyrics?.is_synced && lyrics.lines?.length}<div
			class="lines"
			bind:this={linesPanel}
			use:watchReading
			role="region"
			aria-label="Timed lyrics"
		>
			{#each lyrics.lines as line, i (i)}<p
					class:active={i === current}
					aria-current={i === current ? 'true' : undefined}
				>
					{#if line.start_seconds != null && onseek}<button
							aria-label={'Seek to lyric ' + line.text}
							onclick={() => {
								following = true;
								onseek?.(line.start_seconds!);
							}}>{line.text}</button
						>{:else}{line.text}{/if}
				</p>{/each}
		</div>
		{#if !following && current >= 0}<button
				class="text-button"
				onclick={(event) => {
					if (event.currentTarget.matches(':focus-visible'))
						linesPanel
							?.querySelector<HTMLButtonElement>('[aria-current=true] button')
							?.focus({ preventScroll: true });
					following = true;
				}}>Follow current line</button
			>{/if}
	{:else if lyrics?.text}<p class="plain">{lyrics.text}</p>{:else}<p>No lyrics available.</p>{/if}
	{#if !busy && !sample && !error && lyrics}<button class="text-button" onclick={() => retry++}
			>Refresh lyrics</button
		>{/if}
</div>

<style>
	.lines button {
		text-align: var(--cell-align, start);
		padding: 0.4rem 0;
		width: 100%;
		color: inherit;
	}
	.lyrics-body {
		display: flex;
		flex-direction: column;
		min-height: 0;
		flex: 1;
		height: 100%;
		gap: 0.4rem;
	}
	.lyrics-body > button {
		align-self: start;
		flex: none;
	}
	.lines,
	.plain {
		min-height: 0;
		flex: 1;
		overscroll-behavior: contain;
		scrollbar-width: thin;
		overflow: auto;
		white-space: pre-wrap;
	}
	.lines {
		position: relative;
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
