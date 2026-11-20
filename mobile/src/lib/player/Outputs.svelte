<script lang="ts">
	import { Capacitor } from '@capacitor/core';
	import { tick } from 'svelte';
	import type { Section } from '../boards/layout';
	import PlayerActionFace from './PlayerActionFace.svelte';
	import { Cast, Speaker } from '@lucide/svelte';
	import ReviewSheet from '../catalog/ReviewSheet.svelte';
	import { airplay, nativeOutput as player, type OutputDevice } from './native';

	let {
		compact = false,
		settingsEntry = false,
		section
	}: { compact?: boolean; settingsEntry?: boolean; section?: Section } = $props();
	const android = Capacitor.getPlatform() === 'android';
	const ios = Capacitor.getPlatform() === 'ios';
	let open = $state(false),
		busy = $state(false),
		searched = $state(false);
	let destination = $state(''),
		error = $state(''),
		devices = $state<OutputDevice[]>([]);
	let revision = 0;
	let opener = $state<HTMLButtonElement>();
	function close() {
		open = false;
		++revision;
		void tick().then(() => opener?.isConnected && opener.focus({ preventScroll: true }));
	}
	async function run(action: () => Promise<void>) {
		const version = revision;
		busy = true;
		error = '';
		try {
			await action();
		} catch (e) {
			if (version === revision)
				error = e instanceof Error ? e.message : 'The output is unavailable.';
		} finally {
			if (version === revision) busy = false;
		}
	}
	function show() {
		++revision;
		open = true;
		searched = false;
		devices = [];
		const version = revision;
		void run(async () => {
			if (ios) {
				await airplay.choose();
				if (version === revision) close();
			} else {
				const state = await player.outputState();
				if (version === revision) destination = state.destination;
			}
		});
	}
	function search() {
		const version = revision;
		void run(async () => {
			const result = await player.findOutputs();
			if (version === revision) {
				devices = result.devices;
				searched = true;
			}
		});
	}
	function select(id?: string) {
		const version = revision;
		void run(async () => {
			const state = id ? await player.castTo({ id }) : await player.stopCasting();
			if (version === revision) destination = state.destination;
		});
	}
	function google() {
		const version = revision;
		void run(async () => {
			const state = await player.googleCast();
			if (version === revision) destination = state.destination;
		});
	}
</script>

{#if android || ios}
	<button
		class={settingsEntry ? 'output-entry' : compact ? 'icon-button' : 'secondary'}
		aria-label="Cast and audio output"
		bind:this={opener}
		onclick={show}
	>
		{#if settingsEntry}<Cast size={20} /><span>Cast and audio output</span>
		{:else}<PlayerActionFace
				{section}
				glyph={Cast}
				size={compact ? 21 : 18}
				label="Cast and audio output"
				defaultLabel={!compact}
			/>{/if}
	</button>
{/if}
{#if open}
	<ReviewSheet title="Cast and audio output" onback={close}>
		<div class="outputs">
			{#if android}
				<h3>Music output</h3>
				<p role="status">{destination ? `Casting to ${destination}` : 'Playing on this phone'}</p>
				{#if destination}
					<p>Stopping the cast pauses the queue on this phone.</p>
					<button class="secondary" disabled={busy} onclick={() => select()}>Stop casting</button>
				{:else}
					<button class="primary" disabled={busy} onclick={google}
						><Cast size={18} />Choose Google Cast device</button
					>
					<h3>Other network speakers</h3>
					<p>Find speakers and TVs that support UPnP or DLNA on this Wi-Fi network.</p>
					{#each devices as device (device.id)}
						<button class="secondary" disabled={busy} onclick={() => select(device.id)}
							><Speaker size={18} />{device.name}</button
						>
					{/each}
					{#if searched && devices.length === 0}<p role="status">
							No compatible receivers found.
						</p>{/if}
					<button class="secondary" disabled={busy} onclick={search}
						>{searched ? 'Search again' : 'Find network speakers'}</button
					>
					<h3>Cast display</h3>
					<p>
						Android’s Cast settings can share the phone’s screen and audio with a compatible
						display.
					</p>
					<button class="secondary" disabled={busy} onclick={() => run(() => player.castScreen())}
						>Open Cast settings</button
					>
				{/if}
			{:else}
				<button class="secondary" disabled={busy} onclick={show}>Choose AirPlay output</button>
			{/if}
			{#if busy && android}<p role="status">Connecting…</p>{/if}
			{#if error}<p role="alert">{error}</p>{/if}
		</div>
	</ReviewSheet>
{/if}

<style>
	.output-entry {
		display: flex;
		gap: 0.85rem;
		align-items: center;
		width: 100%;
		min-height: 48px;
		padding: 0.6rem var(--gap);
		border-bottom: 1px solid var(--line);
		font-weight: 600;
		text-align: start;
	}
	.outputs {
		display: grid;
		gap: 0.75rem;
	}
	h3,
	p {
		margin: 0;
	}
	h3:not(:first-child) {
		margin-top: 1rem;
	}
	p {
		color: var(--muted);
	}
	.outputs button {
		overflow-wrap: anywhere;
	}
</style>
