<script lang="ts">
	import { uiText, tr } from './i18n';

	import { prefersReducedMotion } from 'svelte/motion';
	import { lyricPhrases } from './player/lyricWords';
	import { soundSettings } from './player/sound';

	import type { components } from '../../../frontend/src/lib/api/v3/openapi';
	import type { Session } from './connection';
	import { trackLyrics } from './offline/lyrics';
	import { errorMessage } from './catalog/catalog';
	let {
		session,
		trackId,
		position,
		playing = false,
		sample = false,
		onseek
	}: {
		session: Session;
		trackId: string;
		position: number;
		playing?: boolean;
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
	let lines = $derived.by(() => {
		let next: number | undefined;
		return (lyrics?.lines ?? [])
			.slice()
			.reverse()
			.map((line) => {
				const phrases = lyricPhrases(line.text, line.start_seconds, next);
				if (line.start_seconds != null) next = line.start_seconds;
				return { ...line, phrases, display: phrases.map((p) => p.text).join('') };
			})
			.reverse();
	});
	const boundaries = $derived(
		[
			...new Set(
				lines.flatMap((line) =>
					line.phrases.flatMap((p) =>
						p.start === undefined ? [] : p.end === undefined ? [p.start] : [p.start, p.end]
					)
				)
			)
		].sort((a, b) => a - b)
	);
	let wordPosition = $state(0),
		rate = $state(1);
	$effect(() => {
		if (!boundaries.length) return;
		let active = true;
		function updateRate() {
			void soundSettings()
				.then((value) => {
					if (active) rate = value.speed;
				})
				.catch(() => {});
		}
		updateRate();
		window.addEventListener('dn-playback-speed', updateRate);
		return () => {
			active = false;
			window.removeEventListener('dn-playback-speed', updateRate);
		};
	});
	// Native snapshots arrive once a second. Wake only at upcoming word boundaries
	// between snapshots, and re-anchor immediately when playback pauses or seeks.
	$effect(() => {
		const base = position,
			stamps = boundaries,
			speed = rate;
		wordPosition = base;
		if (!playing || !stamps.length) return;
		const started = performance.now();
		let timer: ReturnType<typeof setTimeout>;
		let low = 0,
			high = stamps.length;
		while (low < high) {
			const mid = (low + high) >>> 1;
			if (stamps[mid] <= base) low = mid + 1;
			else high = mid;
		}
		function schedule(index: number) {
			const delay = ((stamps[index] - base) * 1000) / speed;
			if (index >= stamps.length || delay > 1200) return;
			timer = setTimeout(
				() => {
					wordPosition = Math.max(
						stamps[index],
						base + ((performance.now() - started) * speed) / 1000
					);
					schedule(index + 1);
				},
				Math.max(0, delay - (performance.now() - started))
			);
		}
		schedule(low);
		return () => clearTimeout(timer);
	});
	let current = $derived.by(() => {
		for (let i = lines.length - 1; i >= 0; i--) {
			const start = lines[i].start_seconds;
			if (start != null && start <= wordPosition) return i;
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

{#snippet words(line: (typeof lines)[number], row: number)}
	{#each line.phrases as phrase, n (n)}{#if phrase.start === undefined}{phrase.text}{:else}<span
				class="lyric-word"
				data-active-word={row === current &&
				wordPosition >= phrase.start &&
				(phrase.end === undefined || wordPosition < phrase.end)
					? ''
					: undefined}>{phrase.text}</span
			>{/if}{/each}
{/snippet}

<div class="lyrics-body" data-part="lyrics" data-gesture-scroll>
	{#if busy}<p role="status">{uiText('Loading lyrics…')}</p>{:else if error}<p role="alert">
			{error}
		</p>
		<button class="secondary" onclick={() => retry++}>{uiText('Try again')}</button>
	{:else if sample}<p class="plain">
			{tr('Our shadows cross the water', 'ふたりの影が水面を渡る')}<br />{tr(
				'Where the evening current turns',
				'夕暮れの流れが変わるところ'
			)}
		</p>{:else if lyrics?.is_synced && lyrics.lines?.length}<div
			class="lines"
			bind:this={linesPanel}
			use:watchReading
			role="region"
			aria-label={uiText('Timed lyrics')}
		>
			{#each lines as line, i (i)}<p
					class:active={i === current}
					aria-current={i === current ? 'true' : undefined}
				>
					{#if line.start_seconds != null && onseek}<button
							aria-label={tr('Seek to lyric ' + line.display, 'この歌詞に移動：' + line.display)}
							onclick={() => {
								following = true;
								onseek?.(line.start_seconds!);
							}}>{@render words(line, i)}</button
						>{:else}{@render words(line, i)}{/if}
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
				}}>{uiText('Follow current line')}</button
			>{/if}
	{:else if lyrics?.text}<p class="plain">{lyrics.text}</p>{:else}<p>
			{uiText('No lyrics available.')}
		</p>{/if}
	{#if !busy && !sample && !error && lyrics}<button class="text-button" onclick={() => retry++}
			>{uiText('Refresh lyrics')}</button
		>{/if}
</div>

<style>
	.active .lyric-word {
		color: var(--text);
	}
	.active [data-active-word] {
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 0.16em;
	}
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
