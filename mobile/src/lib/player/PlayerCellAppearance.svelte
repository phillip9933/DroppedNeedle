<script lang="ts">
	import InlineChoice from '../controls/InlineChoice.svelte';
	import type { Section } from '../boards/layout';
	import { defaultFieldLabel, supportsPlayerLines } from './layout';
	let { field, change }: { field: Section; change: (patch: Partial<Section>) => void } = $props();
	function number(input: HTMLInputElement, min: number, max: number) {
		return Number.isFinite(input.valueAsNumber)
			? Math.max(min, Math.min(max, input.valueAsNumber))
			: undefined;
	}
</script>

<div class="styles">
	<label
		>Horizontal alignment<InlineChoice selected={field.align ?? ''}
			><select
				value={field.align ?? ''}
				onchange={(e) =>
					change({ align: (e.currentTarget.value || undefined) as Section['align'] })}
			>
				<option value="">Default</option><option value="start">Start</option><option value="center"
					>Center</option
				><option value="end">End</option></select
			></InlineChoice
		></label
	>

	<label
		>Padding (px)<input
			aria-label="Padding"
			type="number"
			inputmode="decimal"
			step="any"
			min="0"
			max="32"
			value={field.padding ?? 0}
			onchange={(e) => change({ padding: number(e.currentTarget, 0, 32) })}
		/></label
	>
	<label
		>Vertical alignment<InlineChoice selected={field.vAlign ?? ''}
			><select
				value={field.vAlign ?? ''}
				onchange={(e) =>
					change({ vAlign: (e.currentTarget.value || undefined) as Section['vAlign'] })}
			>
				<option value="">Default</option><option value="start">Top</option><option value="center"
					>Center</option
				><option value="end">Bottom</option></select
			></InlineChoice
		></label
	>

	<label
		>Label<InlineChoice
			selected={(field.showLabel ?? defaultFieldLabel(field)) ? 'show' : 'hidden'}
			label="Label"
			><select
				value={(field.showLabel ?? defaultFieldLabel(field)) ? 'show' : 'hidden'}
				onchange={(e) => change({ showLabel: e.currentTarget.value === 'show' })}
				><option value="hidden">Hidden</option><option value="show">Show</option></select
			></InlineChoice
		></label
	>
	<label
		>Label name<input
			maxlength="64"
			value={field.labelName ?? ''}
			placeholder="Field name"
			oninput={(e) => change({ labelName: e.currentTarget.value })}
		/></label
	>
	<label
		>Label position<InlineChoice selected={field.labelPosition ?? 'below'}
			><select
				value={field.labelPosition ?? 'below'}
				onchange={(e) =>
					change({ labelPosition: e.currentTarget.value as Section['labelPosition'] })}
				><option value="above">Above</option><option value="below">Below</option></select
			></InlineChoice
		></label
	>

	{#if field.id === 'player-seek' || field.id === 'player-timeline'}
		<label
			>Seek bar style<InlineChoice selected={field.seekStyle ?? 'standard'}
				><select
					value={field.seekStyle ?? 'standard'}
					onchange={(e) => change({ seekStyle: e.currentTarget.value as Section['seekStyle'] })}
					><option value="standard">Standard</option><option value="animated">Animated</option
					><option value="waveform">Waveform</option></select
				></InlineChoice
			></label
		>
		{#each [['showElapsed', 'Elapsed time'], ['showDuration', 'Total time'], ['showRemaining', 'Remaining time']] as [key, label] (key)}
			{@const property = key as 'showElapsed' | 'showDuration' | 'showRemaining'}<label
				class="check"
				><input
					type="checkbox"
					checked={field[property] ?? property !== 'showRemaining'}
					onchange={(e) => change({ [property]: e.currentTarget.checked })}
				/>{label}</label
			>{/each}
	{/if}
	{#if field.id === 'player-lyrics'}<label
			>Lyrics display<InlineChoice selected={field.lyricsMode ?? 'artwork'}
				><select
					value={field.lyricsMode ?? 'artwork'}
					onchange={(e) => change({ lyricsMode: e.currentTarget.value as Section['lyricsMode'] })}
					><option value="artwork">Over artwork</option><option value="sheet">Bottom sheet</option
					></select
				></InlineChoice
			></label
		>{/if}
	{#if supportsPlayerLines(field.id)}
		<label
			>Text size<InlineChoice selected={field.textSize ?? 'normal'}
				><select
					value={field.textSize ?? 'normal'}
					onchange={(e) => change({ textSize: e.currentTarget.value as Section['textSize'] })}
				>
					<option value="small">Small</option><option value="normal">Normal</option><option
						value="large">Large</option
					></select
				></InlineChoice
			></label
		>

		<label
			>Maximum lines<InlineChoice
				selected={field.maxLines === undefined ? 'auto' : String(field.maxLines)}
				><select
					value={field.maxLines === undefined ? 'auto' : String(field.maxLines)}
					onchange={(e) =>
						change({
							maxLines: e.currentTarget.value === 'auto' ? undefined : Number(e.currentTarget.value)
						})}
				>
					<option value="auto">Default</option><option value="0">Unlimited</option
					>{#each Array.from({ length: 8 }, (_, i) => i + 1) as n (n)}<option value={n}>{n}</option
						>{/each}</select
				></InlineChoice
			></label
		>
		<label class="check"
			><input
				type="checkbox"
				checked={!!field.reserveLines}
				disabled={!field.maxLines}
				onchange={(e) => change({ reserveLines: e.currentTarget.checked })}
			/>Reserve all lines</label
		>
	{/if}
</div>

<style>
	.styles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 8.5rem), 1fr));
		gap: 0.45rem;
	}
	.styles label {
		min-width: 0;
		display: grid;
		gap: 0.18rem;
	}
	.styles select,
	.styles input {
		width: 100%;
		min-width: 0;
	}
	.styles .check {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		align-self: end;
		min-height: 44px;
	}
	.styles .check input {
		width: 1.15rem;
		flex: none;
	}
</style>
