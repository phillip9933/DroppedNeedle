<script lang="ts">
	import { onMount } from 'svelte';
	import type { Session } from '../connection';
	import { errorMessage } from '../catalog/catalog';
	import {
		conversionState,
		conversionSupported,
		rates,
		saveQuality,
		streamQuality,
		readTrackFade,
		setTrackFade,
		fadeLengths,
		type Format,
		type Quality
	} from './streaming';
	let { session }: { session: Session } = $props();
	let quality = $state<Quality>({ format: 'original', rate: 192 }),
		conversion = $state<'on' | 'off' | 'unavailable' | null>(null);
	let serviceError = $state(''),
		fadeError = $state(''),
		milliseconds = $state(0),
		loadingFades = $state(true),
		saving = $state(false);
	let checks = 0;
	async function readConversion() {
		const check = ++checks;
		serviceError = '';
		try {
			const state = await conversionState(session);
			if (check === checks) conversion = state.conversion;
		} catch (e) {
			if (check === checks) serviceError = errorMessage(e);
		}
	}
	function configure(format: Format, rate: number) {
		quality = { format, rate };
		saveQuality(session, quality);
	}
	async function fade(value: number) {
		if (saving) return;
		saving = true;
		fadeError = '';
		try {
			await setTrackFade(value);
			milliseconds = value;
		} catch (e) {
			fadeError = errorMessage(e);
		} finally {
			saving = false;
		}
	}
	onMount(() => {
		quality = streamQuality(session);
		if (conversionSupported) void readConversion();
		void readTrackFade()
			.then((v) => (milliseconds = v))
			.catch((e) => (fadeError = errorMessage(e)))
			.finally(() => (loadingFades = false));
		return () => {
			checks++;
		};
	});
</script>

<section class="playback" aria-label="Playback preferences">
	{#if conversionSupported}
		<h2>Stream quality</h2>
		<label
			>Audio format<select
				aria-label="Audio format"
				value={quality.format}
				onchange={(e) => configure(e.currentTarget.value as Format, quality.rate)}
			>
				<option value="original">Original file</option><option
					value="mp3"
					disabled={conversion !== 'on'}>MP3</option
				><option value="opus" disabled={conversion !== 'on'}>Opus</option></select
			></label
		>
		{#if quality.format !== 'original'}<label
				>Requested bitrate<select
					aria-label="Requested bitrate"
					value={quality.rate}
					onchange={(e) => configure(quality.format, Number(e.currentTarget.value))}
					>{#each rates as rate (rate)}<option value={rate}>{rate} kbps</option>{/each}</select
				></label
			>{/if}
		{#if serviceError}<p role="status">Could not check DN conversion. {serviceError}</p>
			<button class="secondary" onclick={readConversion}>Check conversion again</button>
		{:else if conversion === 'off'}<p>
				Conversion is turned off. Enable On-the-fly transcoding in DN’s Settings → Connect Apps.
			</p>
			<button class="text-button" onclick={readConversion}>Check conversion again</button>
		{:else if conversion === 'unavailable'}<p>
				DN reports that ffmpeg is unavailable. Original files can still play.
			</p>
			<button class="text-button" onclick={readConversion}>Check conversion again</button>
		{:else if conversion === 'on'}<p>
				DN can convert streams. Your choice applies to tracks added to the queue from now on.
			</p>
		{:else}<p role="status">Checking server conversion…</p>{/if}
	{/if}
	<h2>Track fades</h2>
	<label
		>Fade in and out<select
			aria-label="Fade in and out"
			value={milliseconds}
			disabled={loadingFades || saving}
			onchange={(e) => fade(Number(e.currentTarget.value))}
			>{#each fadeLengths as ms (ms)}<option value={ms}
					>{ms ? ms / 1000 + ' seconds' : 'Off'}</option
				>{/each}</select
		></label
	>
	<p>Gradually raise the volume at the start of a track and lower it at the end.</p>
	{#if fadeError}<p role="alert">{fadeError}</p>{/if}
</section>

<style>
	.playback {
		display: grid;
		gap: 0.65rem;
	}
	h2,
	p {
		margin: 0;
	}
	h2:not(:first-child) {
		margin-top: 1.2rem;
	}
	label {
		display: grid;
		gap: 0.35rem;
	}
	p {
		color: var(--muted);
	}
	button {
		justify-self: start;
	}
</style>
