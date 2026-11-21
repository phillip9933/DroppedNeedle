<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ArrowLeft } from '@lucide/svelte';
	import type { Session } from '../connection';
	import type { PlayerTrack } from '../player';
	import { tr, uiText } from '../i18n';
	import type { Album } from './catalog';
	import Cover from './Cover.svelte';
	import DetailSettings from './DetailSettings.svelte';
	let {
		session,
		album,
		tracks,
		backLabel = 'Back',
		onback,
		cacheOnly = false,
		actions,
		children
	}: {
		session: Session;
		album: Album;
		tracks: PlayerTrack[];
		backLabel?: string;
		onback: () => void;
		cacheOnly?: boolean;
		actions?: Snippet;
		children?: Snippet;
	} = $props();
	let tone = $state<{ art: string | undefined; color: string }>();
	const genres = $derived([...new Set(tracks.flatMap((t) => (t.genre ? [t.genre] : [])))]);
	const metadata = $derived.by(() => {
		const info = [...genres.slice(0, 2)];
		const year = album.year || tracks.find((t) => t.year)?.year;
		if (year) info.push(String(year));
		const formats = [...new Set(tracks.map((t) => t.format?.trim().toUpperCase()))];
		const lossless = ['FLAC', 'ALAC', 'WAV', 'PCM', 'AIFF', 'APE', 'WAVPACK-LOSSLESS'];
		if (formats.length && formats.every((f) => f && lossless.includes(f))) {
			info.push(
				tracks.every((t) => (t.sourceBitDepth ?? 0) > 16 || (t.sourceSampleRate ?? 0) > 48000)
					? tr('Hi-Res Lossless', 'ハイレゾロスレス')
					: uiText('Lossless')
			);
		} else if (formats.length === 1 && formats[0]) info.push(formats[0]);
		return info.join(' · ');
	});
	// Sample the bottom edge where the cover meets the page. Keep the theme's
	// background in the mix so custom foreground colors remain legible.
	function sample(image: HTMLImageElement) {
		try {
			const canvas = document.createElement('canvas');
			canvas.width = 12;
			canvas.height = 1;
			const ctx = canvas.getContext('2d');
			if (!ctx) return;
			ctx.drawImage(
				image,
				0,
				image.naturalHeight * 0.75,
				image.naturalWidth,
				image.naturalHeight * 0.25,
				0,
				0,
				12,
				1
			);
			const pixels = ctx.getImageData(0, 0, 12, 1).data;
			let r = 0,
				g = 0,
				b = 0,
				weight = 0;
			for (let i = 0; i < pixels.length; i += 4) {
				const alpha = pixels[i + 3] / 255;
				r += pixels[i] * alpha;
				g += pixels[i + 1] * alpha;
				b += pixels[i + 2] * alpha;
				weight += alpha;
			}
			if (weight)
				tone = {
					art: album.art,
					color: `rgb(${Math.round(r / weight)} ${Math.round(g / weight)} ${Math.round(b / weight)})`
				};
		} catch {
			/* A browser can restrict pixel reads for remote artwork. */
		}
	}
</script>

<div
	class="album-page"
	data-part="album-page"
	style:--album-tone={tone?.art === album.art ? tone?.color : undefined}
>
	<header class="hero" class:no-art={!album.art} data-part="album-detail">
		<div class="art">
			<Cover
				{session}
				path={album.art}
				seed={album.group || album.title}
				{cacheOnly}
				onimage={sample}
			/>
		</div>
		<div class="navigation">
			<button class="back" aria-label={uiText(backLabel)} title={uiText(backLabel)} onclick={onback}
				><ArrowLeft size={21} /></button
			>
			<DetailSettings />
		</div>
		<div class="credits">
			<h1>{album.title}</h1>
			{#if album.artist}<div class="artist">{album.artist}</div>{/if}
			{#if metadata || cacheOnly}<div class="meta">
					{metadata}{#if metadata && cacheOnly}
						·
					{/if}{#if cacheOnly}<span>{uiText('On this device')}</span>{/if}
				</div>{/if}
		</div>
	</header>
	{#if actions}<div class="album-actions" data-part="album-primary-actions">
			{@render actions()}
		</div>{/if}
	<div class="body">{@render children?.()}</div>
</div>

<style>
	.album-page {
		--album-secondary: color-mix(in srgb, var(--muted) 64%, var(--text));
		--album-wash: color-mix(in srgb, var(--album-tone, var(--bg)) 26%, var(--bg));
		min-height: 100%;
		background: linear-gradient(
			to bottom,
			var(--album-wash) 0%,
			var(--album-wash) 70%,
			var(--bg) 100%
		);
	}
	.hero {
		position: relative;
		isolation: isolate;
		display: grid;
		align-content: end;
		min-height: clamp(14rem, min(100vw, 47svh), 31rem);
	}
	.hero.no-art {
		min-height: clamp(11rem, 31svh, 16rem);
	}
	.art {
		position: absolute;
		inset: 0;
		z-index: -1;
		overflow: hidden;
		mask-image: linear-gradient(
			to bottom,
			black 0%,
			black 49%,
			rgba(0, 0, 0, 0.6) 72%,
			transparent 100%
		);
	}
	.art :global(.cover) {
		height: 100%;
		border-radius: 0;
		aspect-ratio: auto;
	}
	.art :global(img) {
		object-fit: cover;
		object-position: 50% 40%;
	}
	.art :global(svg) {
		width: clamp(5rem, 27vw, 10rem);
	}
	.navigation {
		--button-fill: rgb(13 15 15 / 74%);
		--material-overlay: none;
		--material-shadow: none;
		position: absolute;
		inset: 0 0 auto;
		padding: 0.65rem var(--gap);
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
	}
	.navigation button,
	.navigation :global(button) {
		display: grid;
		place-items: center;
		min-width: 44px;
		min-height: 44px;
		color: white;
		background: rgb(13 15 15 / 64%);
		border: 0;
		border-radius: 999px;
	}
	.navigation button:focus-visible,
	.navigation :global(button:focus-visible) {
		outline: 3px solid white;
		outline-offset: 2px;
	}
	.credits {
		margin-top: 6rem;
		padding: 2.3rem var(--gap) 0.3rem;
		text-align: center;
		background: linear-gradient(
			transparent 0%,
			color-mix(in srgb, var(--album-wash) 80%, transparent) 35%,
			var(--album-wash) 99%
		);
	}
	.hero .credits h1 {
		font-size: clamp(1.48rem, 5.5vw, 2.3rem);
		font-weight: 700;
		line-height: 1.12;
		letter-spacing: -0.035em;
		color: var(--text);
		margin: 0;
		text-wrap: balance;
		overflow-wrap: anywhere;
	}
	.artist {
		font-size: clamp(1.05rem, 4.2vw, 1.45rem);
		margin-top: 0.16rem;
		overflow-wrap: anywhere;
	}
	.meta {
		margin-top: 0.3rem;
		font-size: 0.84rem;
		color: var(--text);
		opacity: 0.86;
		overflow-wrap: anywhere;
	}
	.album-actions {
		display: flex;
		align-items: center;
		justify-content: center;
		--action-gap: clamp(0.22rem, 1.6vw, 0.7rem);
		gap: var(--action-gap);
		padding: 0.6rem var(--gap) 0.7rem;
		flex-wrap: wrap;
	}
	.album-actions :global(.icon-button),
	.album-actions :global(.bare-dots) {
		width: 44px;
		height: 44px;
		flex: none;
		border-radius: 50%;
		background: color-mix(in srgb, var(--text) 10%, var(--album-wash));
		color: var(--text);
		border: 0;
		box-shadow: none;
	}
	.album-page .album-actions :global(.primary) {
		flex: 0 1 auto;
		width: clamp(4.4rem, calc(100% - 176px - 4 * var(--action-gap)), 8.3rem);
		min-width: 4.4rem;
		min-height: 44px;
		padding: 0.55rem 0.9rem;
		border-radius: 999px;
	}
	.body {
		padding: 0 var(--gap) 1rem;
	}
	@media (orientation: landscape) and (max-height: 540px) {
		.hero {
			min-height: 11rem;
		}
		.credits {
			margin-top: 3.5rem;
		}
	}
</style>
