<script lang="ts">
	import type { Section } from '../boards/layout';
	import {
		playerIconOptions,
		supportsPlayerIcon,
		supportsPlayerLines,
		isPlayerMetadata
	} from './layout';
	let { field, change }: { field: Section; change: (patch: Partial<Section>) => void } = $props();
	function number(input: HTMLInputElement, min: number, max: number) {
		return Number.isFinite(input.valueAsNumber)
			? Math.max(min, Math.min(max, Math.round(input.valueAsNumber)))
			: undefined;
	}
</script>

<div class="styles">
	<label
		>Horizontal alignment<select
			value={field.align ?? ''}
			onchange={(e) => change({ align: (e.currentTarget.value || undefined) as Section['align'] })}
		>
			<option value="">Default</option><option value="start">Start</option><option value="center"
				>Center</option
			><option value="end">End</option></select
		></label
	>

	<label
		>Padding (px)<input
			aria-label="Padding"
			type="number"
			inputmode="numeric"
			min="0"
			max="32"
			placeholder="Default"
			value={field.padding ?? ''}
			onchange={(e) => change({ padding: number(e.currentTarget, 0, 32) })}
		/></label
	>
	<label
		>Vertical alignment<select
			value={field.vAlign ?? ''}
			onchange={(e) =>
				change({ vAlign: (e.currentTarget.value || undefined) as Section['vAlign'] })}
		>
			<option value="">Default</option><option value="start">Top</option><option value="center"
				>Center</option
			><option value="end">Bottom</option></select
		></label
	>
	{#if supportsPlayerIcon(field.id)}
		<label
			>Icon<select
				aria-label="Icon"
				value={field.icon ?? 'default'}
				onchange={(e) =>
					change({ icon: e.currentTarget.value === 'default' ? undefined : e.currentTarget.value })}
			>
				{#each playerIconOptions as icon (icon.id)}<option value={icon.id}>{icon.label}</option
					>{/each}</select
			></label
		>
		<label
			>Icon size (px)<input
				aria-label="Icon size"
				type="number"
				inputmode="numeric"
				min="12"
				max="64"
				placeholder="Default"
				value={field.iconSize ?? ''}
				onchange={(e) => change({ iconSize: number(e.currentTarget, 12, 64) })}
			/></label
		>
		{#if isPlayerMetadata(field.id)}
			{#if field.icon && !['default', 'none'].includes(field.icon)}
				<label class="check"
					><input
						type="checkbox"
						checked={field.showLabel !== false}
						onchange={(e) => change({ showLabel: e.currentTarget.checked })}
					/>Show text</label
				>
			{/if}
		{:else}
			<label class="wide"
				>Action label<select
					value={field.showLabel === undefined ? 'auto' : field.showLabel ? 'show' : 'hide'}
					onchange={(e) =>
						change({
							showLabel:
								e.currentTarget.value === 'auto' ? undefined : e.currentTarget.value === 'show'
						})}
				>
					<option value="auto">Default</option><option value="show">Show label</option><option
						value="hide">Hide label</option
					></select
				></label
			>
		{/if}
	{/if}
	{#if supportsPlayerLines(field.id)}
		<label
			>Text size<select
				value={field.textSize ?? 'normal'}
				onchange={(e) => change({ textSize: e.currentTarget.value as Section['textSize'] })}
			>
				<option value="small">Small</option><option value="normal">Normal</option><option
					value="large">Large</option
				></select
			></label
		>

		<label
			>Maximum lines<select
				value={field.maxLines === undefined ? 'auto' : String(field.maxLines)}
				onchange={(e) =>
					change({
						maxLines: e.currentTarget.value === 'auto' ? undefined : Number(e.currentTarget.value)
					})}
			>
				<option value="auto">Default</option><option value="0">Unlimited</option
				>{#each Array.from({ length: 8 }, (_, i) => i + 1) as n (n)}<option value={n}>{n}</option
					>{/each}</select
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
	.wide {
		grid-column: 1 / -1;
	}
</style>
