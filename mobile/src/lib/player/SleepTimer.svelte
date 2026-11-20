<script lang="ts">
	import { tick } from 'svelte';
	import { Moon } from '@lucide/svelte';
	import ReviewSheet from '../catalog/ReviewSheet.svelte';
	import type { Section } from '../boards/layout';
	import { player, type SleepTimerState } from '../player';
	import PlayerActionFace from './PlayerActionFace.svelte';
	let {
		section,
		timer,
		sample = false
	}: { section?: Section; timer?: SleepTimerState | null; sample?: boolean } = $props();
	let open = $state(false),
		busy = $state(false),
		error = $state(''),
		minutes = $state<number | undefined>(30),
		trigger = $state<HTMLButtonElement>();
	let now = $state(Date.now());
	$effect(() => {
		if (timer?.mode !== 'minutes') return;
		now = Date.now();
		const timerId = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timerId);
	});
	const left = $derived(
		timer?.mode === 'minutes' ? Math.max(1, Math.ceil((timer.endsAt - now) / 60000)) : 0
	);
	const status = $derived(
		timer?.mode === 'track'
			? 'Playback will pause at the end of this track.'
			: timer?.mode === 'minutes'
				? `Playback will pause in ${left} ${left === 1 ? 'minute' : 'minutes'}.`
				: 'The sleep timer is off.'
	);
	function close() {
		open = false;
		void tick().then(() => trigger?.focus({ preventScroll: true }));
	}
	async function apply(set: () => Promise<void>) {
		if (busy) return;
		busy = true;
		error = '';
		try {
			await set();
			close();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not change the sleep timer.';
		} finally {
			busy = false;
		}
	}
</script>

<button
	class="secondary sleep"
	class:active={!!timer}
	bind:this={trigger}
	aria-label="Sleep timer"
	aria-haspopup="dialog"
	onclick={() => {
		if (!sample) {
			error = '';
			open = true;
		}
	}}
>
	<PlayerActionFace {section} glyph={Moon} size={19} label="Sleep timer" defaultLabel />
	{#if timer}<small>{timer.mode === 'track' ? 'End of track' : left + ' min'}</small>{/if}
</button>
{#if open}<ReviewSheet title="Sleep timer" onback={close} {busy}>
		<div class="timer">
			<p role="status">{status}</p>
			<div class="presets" role="group" aria-label="Timer duration">
				{#each [5, 15, 30, 45, 60] as n (n)}<button
						class="secondary"
						disabled={busy}
						onclick={() => apply(() => player.setSleepMinutes(n))}>{n} min</button
					>{/each}
			</div>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					if (minutes !== undefined) void apply(() => player.setSleepMinutes(minutes!));
				}}
			>
				<label
					>Minutes<input
						type="number"
						min="1"
						max="240"
						step="1"
						required
						bind:value={minutes}
					/></label
				><button class="primary" disabled={busy}>Start timer</button>
			</form>
			<button class="secondary" disabled={busy} onclick={() => apply(player.sleepAfterTrack)}
				>End of this track</button
			>
			{#if timer}<button
					class="text-button"
					disabled={busy}
					onclick={() => apply(player.cancelSleepTimer)}>Cancel timer</button
				>{/if}
			{#if error}<p role="alert">{error}</p>{/if}
		</div>
	</ReviewSheet>{/if}

<style>
	.sleep {
		max-width: 100%;
		flex-wrap: wrap;
	}
	.sleep.active {
		color: var(--accent);
	}
	.timer {
		display: grid;
		gap: var(--gap);
	}
	.timer p {
		margin: 0;
	}
	.presets,
	form {
		display: flex;
		align-items: end;
		flex-wrap: wrap;
		gap: 0.45rem;
	}
	form label {
		display: grid;
		gap: 0.25rem;
		max-width: 8rem;
	}
	form input {
		min-width: 0;
	}
</style>
