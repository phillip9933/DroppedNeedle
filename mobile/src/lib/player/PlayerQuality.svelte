<script lang="ts">
	import { AudioLines } from '@lucide/svelte';
	import type { PlaybackFormat, PlayerTrack } from '../player';
	let {
		track,
		quality,
		sample = false
	}: { track: PlayerTrack; quality?: PlaybackFormat | null; sample?: boolean } = $props();
	const info = $derived(
		quality ?? (sample ? { format: 'FLAC', bitDepth: 16, sampleRate: 44100 } : null)
	);
	const codec = $derived(info?.format ?? track.format?.toUpperCase());
	const lossless = $derived(
		!!codec &&
			['flac', 'alac', 'pcm', 'aiff', 'ape', 'wavpack-lossless'].includes(codec.toLowerCase())
	);
	const description = $derived(
		[
			codec
				? (info ? '' : 'Source · ') + (lossless ? 'Lossless · ' : '') + codec
				: 'Audio quality unavailable',
			info?.bitDepth ? info.bitDepth + '-bit' : '',
			info?.sampleRate ? Number((info.sampleRate / 1000).toFixed(2)) + ' kHz' : '',
			info?.bitrate ? info.bitrate + ' kbps' : ''
		]
			.filter(Boolean)
			.join(' · ')
	);
</script>

<span class="quality" data-part="audio-quality"
	><AudioLines size={15} aria-hidden="true" />{description}</span
>

<style>
	.quality {
		display: inline-flex;
		align-items: center;
		justify-content: inherit;
		gap: 0.35em;
		max-width: 100%;
		color: var(--muted);
		font-size: 0.82rem;
		line-height: 1.2;
		overflow-wrap: anywhere;
	}
	.quality :global(svg) {
		flex: none;
	}
</style>
