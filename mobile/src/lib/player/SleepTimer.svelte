<script lang="ts">
	import { Moon, Timer } from '@lucide/svelte';
	import type { Section } from '../boards/layout';
	import { player, type SleepTimerState } from '../player';
	import PlayerActionFace from './PlayerActionFace.svelte';
	import PlayerSheet from './PlayerSheet.svelte';
	let {
		section,
		timer,
		sample = false,
		queueControl = false,
		open = $bindable(false),
		hideTrigger = false
	}: {
		section?: Section;
		timer?: SleepTimerState | null;
		sample?: boolean;
		queueControl?: boolean;
		open?: boolean;
		hideTrigger?: boolean;
	} = $props();
	let mode = $state<'minutes' | 'track'>('minutes'),
		minutes = $state<number | undefined>(15),
		tracks = $state<number | undefined>(1),
		finishTrack = $state(false),
		busy = $state(false),
		error = $state('');
	let now = $state(Date.now());
	const left = $derived(
		timer?.mode === 'minutes' ? Math.max(1, Math.ceil((timer.endsAt - now) / 60000)) : 0
	);
	const count = $derived(timer?.mode === 'track' ? (timer.remaining ?? 1) : 0);
	const short = $derived(count === 1 ? 'End of track' : count ? count + ' tracks' : left + ' min');
	const status = $derived(
		timer?.mode === 'track'
			? count === 1
				? 'Playback will pause at the end of this track.'
				: 'Playback will pause after ' + count + ' tracks.'
			: timer?.mode === 'minutes'
				? timer.finishTrack
					? 'The last track will finish when the ' + left + '-minute countdown ends.'
					: 'Playback will pause in ' + left + (left === 1 ? ' minute.' : ' minutes.')
				: 'The sleep timer is off.'
	);
	const value = $derived(mode === 'minutes' ? minutes : tracks),
		max = $derived(mode === 'minutes' ? 240 : 99);
	$effect(() => {
		if (timer?.mode !== 'minutes') return;
		now = Date.now();
		const id = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(id);
	});
	function set(value: number | undefined) {
		if (mode === 'minutes') minutes = value;
		else tracks = value;
	}
	// A fixed center tick makes a one-unit adjustment possible even on a small phone.
	const tickSpacing = 14;
	const offsets = Array.from({ length: 81 }, (_, i) => i - 40);
	let rulerDrag: { x: number; start: number; id: number } | undefined;
	function rulerDown(event: PointerEvent & { currentTarget: HTMLInputElement }) {
		if (!event.isPrimary || event.button !== 0) return;
		event.preventDefault();
		event.currentTarget.focus({ preventScroll: true });
		event.currentTarget.setPointerCapture(event.pointerId);
		rulerDrag = { x: event.clientX, start: value ?? 1, id: event.pointerId };
	}
	function rulerMove(event: PointerEvent) {
		if (!rulerDrag || rulerDrag.id !== event.pointerId) return;
		const delta = Math.round((rulerDrag.x - event.clientX) / tickSpacing);
		set(Math.min(max, Math.max(1, rulerDrag.start + delta)));
	}
	function rulerUp(event: PointerEvent & { currentTarget: HTMLInputElement }) {
		if (!rulerDrag || rulerDrag.id !== event.pointerId) return;
		if (Math.abs(event.clientX - rulerDrag.x) < 5) {
			const rect = event.currentTarget.getBoundingClientRect();
			const ticks = Math.round((event.clientX - rect.left - rect.width / 2) / tickSpacing);
			set(Math.min(max, Math.max(1, rulerDrag.start + ticks)));
		} else rulerMove(event);
		rulerDrag = undefined;
	}
	function close() {
		if (!busy) {
			open = false;
			error = '';
		}
	}
	async function apply(cancel = false) {
		if (busy || (!cancel && (!value || value < 1 || value > max || !Number.isInteger(value))))
			return;
		busy = true;
		error = '';
		try {
			if (cancel) await player.cancelSleepTimer();
			else if (mode === 'minutes') await player.setSleepMinutes(value!, finishTrack);
			else await player.sleepAfterTrack(value!);
			open = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not change the sleep timer.';
		} finally {
			busy = false;
		}
	}
</script>

{#if !hideTrigger}<button
		class="secondary sleep"
		class:player-control={!!section || queueControl}
		class:queue-control={queueControl}
		class:active={!!timer}
		aria-label="Sleep timer"
		aria-haspopup="dialog"
		onclick={() => {
			if (!sample) open = true;
		}}
	>
		<PlayerActionFace
			{section}
			glyph={Moon}
			size={19}
			label="Sleep timer"
			defaultLabel={!section}
		/>
		{#if timer}<small>{short}</small>{/if}
	</button>{/if}
{#if open}
	<PlayerSheet title="Sleep timer" {busy} onclose={close}>
		<form
			class="timer"
			onsubmit={(e) => {
				e.preventDefault();
				void apply();
			}}
		>
			<div class="modes" role="group" aria-label="Timer mode">
				<button type="button" aria-pressed={mode === 'minutes'} onclick={() => (mode = 'minutes')}
					>Duration</button
				>
				<button type="button" aria-pressed={mode === 'track'} onclick={() => (mode = 'track')}
					>Tracks</button
				>
			</div>
			<label class="amount">
				<input
					type="number"
					aria-label={mode === 'minutes' ? 'Minutes' : 'Number of tracks'}
					min="1"
					{max}
					required
					value={value ?? ''}
					oninput={(e) =>
						set(
							Number.isNaN(e.currentTarget.valueAsNumber)
								? undefined
								: e.currentTarget.valueAsNumber
						)}
				/>
				<span
					>{mode === 'minutes'
						? value === 1
							? 'minute'
							: 'minutes'
						: value === 1
							? 'track'
							: 'tracks'}</span
				>
			</label>
			<div class="ruler">
				<div class="marks" aria-hidden="true">
					{#each offsets as offset (offset)}
						{@const tick = (value ?? 1) + offset}
						{#if tick >= 1 && tick <= max}
							<span
								class:major={tick % 5 === 0}
								class:current={offset === 0}
								style:left={'calc(50% + ' + offset * tickSpacing + 'px)'}
							>
								{#if tick % 5 === 0 || (offset === 0 && tick === 1)}<small>{tick}</small>{/if}
							</span>
						{/if}
					{/each}
				</div>
				<input
					aria-label={mode === 'minutes' ? 'Timer duration' : 'Tracks before sleep'}
					type="range"
					min="1"
					{max}
					step="1"
					value={value ?? 1}
					oninput={(e) => set(e.currentTarget.valueAsNumber)}
					onpointerdown={rulerDown}
					onpointermove={rulerMove}
					onpointerup={rulerUp}
					onpointercancel={() => (rulerDrag = undefined)}
					onlostpointercapture={() => (rulerDrag = undefined)}
				/>
			</div>
			{#if mode === 'minutes'}<label class="finish"
					>Finish last track <input
						type="checkbox"
						role="switch"
						bind:checked={finishTrack}
					/></label
				>{/if}
			<p role="status" class="status"><Timer size={15} aria-hidden="true" />{status}</p>
			{#if error}<p role="alert">{error}</p>{/if}
			<div class="actions">
				{#if timer}<button
						class="text-button"
						type="button"
						disabled={busy}
						onclick={() => apply(true)}>Cancel timer</button
					>{/if}
				<button class="primary" type="submit" disabled={busy} aria-label="Start timer">Start</button
				>
			</div>
		</form>
	</PlayerSheet>
{/if}

<style>
	.sleep {
		max-width: 100%;
		flex-wrap: wrap;
	}
	.sleep.active {
		color: var(--accent);
	}
	.queue-control {
		flex-direction: column;
		gap: 0.2rem;
	}
	.timer {
		display: grid;
		gap: clamp(12px, 2.8dvh, 22px);
		color: var(--text);
	}
	.modes {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 4px;
	}
	.modes button {
		min-height: 44px;
		background: transparent;
		color: var(--text);
		border: 0;
		border-radius: 999px;
	}
	.modes [aria-pressed='true'] {
		background: var(--accent);
		color: var(--on-accent);
	}
	.amount {
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 0.3em;
		font-size: 1.45rem;
	}
	.amount input {
		font: inherit;
		color: inherit;
		background: transparent;
		border: 0;
		border-bottom: 1px solid var(--line);
		text-align: end;
		min-width: 0;
		width: 3.3ch;
		appearance: textfield;
		border-radius: 0;
		padding: 0;
	}
	.amount input::-webkit-inner-spin-button {
		appearance: none;
	}
	.ruler {
		position: relative;
		height: 64px;
		overflow: hidden;
	}
	.ruler:focus-within {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		border-radius: 6px;
	}
	.marks {
		position: absolute;
		inset: 0;
		pointer-events: none;
		mask-image: linear-gradient(to right, transparent, #000 10%, #000 90%, transparent);
	}
	.marks span {
		position: absolute;
		top: 12px;
		height: 19px;
		width: 2px;
		background: var(--line);
		transform: translateX(-50%);
	}
	.marks .major {
		top: 8px;
		height: 28px;
		background: var(--muted);
	}
	.marks .current {
		top: 6px;
		height: 31px;
		background: var(--text);
	}
	.marks .current::before {
		content: '';
		position: absolute;
		top: -6px;
		left: 50%;
		transform: translateX(-50%);
		border: 4px solid transparent;
		border-top-color: var(--text);
	}
	.marks small {
		width: max-content;
		white-space: nowrap;
		position: absolute;
		top: 34px;
		left: 50%;
		transform: translateX(-50%);
		font-size: 0.73rem;
		color: var(--muted);
	}
	.ruler input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		margin: 0;
		padding: 0;
		cursor: ew-resize;
		touch-action: pan-y;
	}
	.finish,
	.status,
	.actions {
		display: flex;
		align-items: center;
	}
	.finish {
		justify-content: space-between;
	}
	.status {
		color: var(--muted);
		font-size: 0.83rem;
	}
	.status {
		gap: 0.45em;
		margin: 0;
	}
	.finish {
		min-height: 44px;
	}
	.finish input {
		appearance: none;
		position: relative;
		width: 45px;
		height: 26px;
		border: 1px solid var(--muted);
		border-radius: 20px;
		background: var(--surface);
		padding: 0;
	}
	.finish input::after {
		content: '';
		position: absolute;
		top: 3px;
		left: 3px;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--muted);
	}
	.finish input:checked {
		background: var(--accent);
		border-color: var(--accent);
	}
	.finish input:checked::after {
		transform: translateX(19px);
		background: var(--on-accent);
	}
	.actions {
		justify-content: flex-end;
		gap: 1rem;
	}
	.actions .primary {
		min-width: 76px;
		border-radius: 999px;
	}
</style>
