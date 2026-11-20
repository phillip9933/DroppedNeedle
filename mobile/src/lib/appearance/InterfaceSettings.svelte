<script lang="ts">
	import { ArrowUp, ArrowDown } from '@lucide/svelte';
	import {
		defaultInterface,
		destinations,
		interfacePreferences,
		setInterface,
		maxTabs,
		type Destination,
		type InterfacePreferences
	} from './interface';
	let { offline = false }: { offline?: boolean } = $props();
	const options = $derived(destinations.filter((d) => offline || d.id !== 'offline'));
	const visible = $derived(
		$interfacePreferences.tabs.filter((id) => options.some((o) => o.id === id))
	);
	const ordered = $derived([
		...visible,
		...options.map((d) => d.id).filter((id) => !visible.includes(id))
	]);
	function toggle(id: Destination) {
		setInterface({
			tabs: visible.includes(id) ? visible.filter((t) => t !== id) : [...visible, id]
		});
	}
	function move(i: number, direction: number) {
		const tabs = [...visible],
			next = i + direction;
		if (next < 0 || next >= tabs.length) return;
		[tabs[i], tabs[next]] = [tabs[next], tabs[i]];
		setInterface({ tabs });
	}
	const surfaceNames = { web: 'DN web', glass: 'Glass', simple: 'Simple' } as const;
	const surfaces = Object.keys(surfaceNames) as InterfacePreferences['surface'][];
</script>

<section class="controls" aria-label="Interface settings">
	<h2>Button and panel style</h2>
	<div class="segmented" role="group" aria-label="Surface style">
		{#each surfaces as style (style)}<button
				aria-pressed={$interfacePreferences.surface === style}
				onclick={() => setInterface({ surface: style })}>{surfaceNames[style]}</button
			>{/each}
	</div>
	{#if $interfacePreferences.surface === 'glass'}<label
			>Glass blur <span>{$interfacePreferences.blur} px</span><input
				aria-label="Glass blur"
				type="range"
				min="0"
				max="24"
				step="1"
				value={$interfacePreferences.blur}
				oninput={(e) => setInterface({ blur: e.currentTarget.valueAsNumber })}
			/></label
		>{/if}
	<label
		>Screen transitions<select
			aria-label="Screen transitions"
			value={$interfacePreferences.motion}
			onchange={(e) =>
				setInterface({ motion: e.currentTarget.value as InterfacePreferences['motion'] })}
			><option value="off">Off</option><option value="quick">Quick fade</option><option
				value="gentle">Gentle fade</option
			></select
		></label
	>
	<h2>Navigation bar</h2>
	<div class="segmented" role="group" aria-label="Navigation bar position">
		{#each ['docked', 'floating'] as bar (bar)}<button
				aria-pressed={$interfacePreferences.bar === bar}
				onclick={() => setInterface({ bar: bar === 'floating' ? 'floating' : 'docked' })}
				>{bar === 'docked' ? 'Docked' : 'Floating'}</button
			>{/each}
	</div>
	<p>Pin up to {maxTabs} destinations. More holds the others and Settings.</p>
	<div class="choices">
		{#each ordered as id, i (id)}
			{@const opt = options.find((d) => d.id === id)!}
			<div class="row">
				<label class="pick"
					><input
						type="checkbox"
						checked={visible.includes(id)}
						disabled={!visible.includes(id) && visible.length >= maxTabs}
						onchange={() => toggle(id)}
					/><opt.icon size={17} />{opt.label}</label
				>
				{#if visible.includes(id)}<button
						class="order"
						aria-label={'Move ' + opt.label + ' earlier'}
						disabled={i === 0}
						onclick={() => move(i, -1)}><ArrowUp size={17} /></button
					><button
						class="order"
						aria-label={'Move ' + opt.label + ' later'}
						disabled={i === visible.length - 1}
						onclick={() => move(i, 1)}><ArrowDown size={17} /></button
					>{/if}
			</div>
		{/each}
	</div>
	<label class="pick"
		><input
			type="checkbox"
			checked={$interfacePreferences.headerSettings}
			onchange={(e) => setInterface({ headerSettings: e.currentTarget.checked })}
		/>Settings shortcut in header</label
	>
	<button class="secondary" onclick={() => setInterface(defaultInterface)}
		>Restore interface defaults</button
	>
</section>

<style>
	.controls {
		display: grid;
		gap: 0.8rem;
	}
	h2,
	p {
		margin: 0;
	}
	h2:not(:first-child) {
		margin-top: 1rem;
	}
	p,
	label span {
		color: var(--muted);
	}
	label:not(.pick) {
		display: grid;
		gap: 0.35rem;
	}
	.segmented {
		display: flex;
		gap: 3px;
		padding: 3px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius);
	}
	.segmented button {
		flex: 1;
		min-height: 44px;
		border-radius: calc(var(--radius) * 0.8);
		font-weight: 650;
	}
	.segmented button[aria-pressed='true'] {
		color: var(--dn-action-content);
		background: var(--dn-action);
	}
	.choices {
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: var(--radius);
	}
	.row {
		display: flex;
		align-items: center;
		padding: 0 0.4rem;
		background: var(--surface);
	}
	.row + .row {
		border-top: 1px solid var(--line);
	}
	.pick {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-height: 48px;
	}
	.pick input {
		width: 18px;
		height: 18px;
		accent-color: var(--accent);
	}
	.order {
		min-width: 44px;
		min-height: 44px;
	}
	button.secondary {
		justify-self: start;
	}
</style>
