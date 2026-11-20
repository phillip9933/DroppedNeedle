<script lang="ts">
	import { ArrowUp, ArrowDown, Check, Play } from '@lucide/svelte';
	import sampleArtwork from '../player/tidal-memory.webp';
	import type { Session } from '../connection';
	import {
		defaultInterface,
		destinations,
		interfacePreferences,
		setInterface,
		readStartScreen,
		saveStartScreen,
		defaultMiniPlayer,
		miniButtons,
		miniText,
		readMiniPlayer,
		saveMiniPlayer,
		maxTabs,
		type MiniButton,
		type MiniPlayerPreferences,
		type Destination,
		type StartScreen,
		type InterfacePreferences
	} from './interface';
	let { offline = false, session }: { offline?: boolean; session: Session | null } = $props();
	let opening = $derived(session ? readStartScreen(session) : 'automatic');
	let mini = $derived(readMiniPlayer(session)),
		miniIssue = $state('');
	const sides = ['before', 'after'] as const;
	function changeMini(changes: Partial<MiniPlayerPreferences>) {
		if (!session?.userId) return;
		const next = { ...mini, ...changes };
		try {
			saveMiniPlayer(session, next);
			mini = next;
			miniIssue = '';
		} catch {
			miniIssue = 'Could not save the mini-player settings on this device.';
		}
	}
	function placeButton(side: 'before' | 'after', action: MiniButton) {
		const other = side === 'before' ? 'after' : 'before';
		changeMini(
			action !== 'none' && mini[other] === action
				? { [side]: action, [other]: mini[side] }
				: { [side]: action }
		);
	}
	let saveIssue = $state('');
	function changeStart(value: StartScreen) {
		if (!session) return;
		try {
			saveStartScreen(session, value);
			opening = value;
			saveIssue = '';
		} catch {
			saveIssue = 'Could not save the start screen on this device.';
		}
	}
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
	const surfaceNames = { solid: 'Solid Theme Color', glass: 'Glass', blur: 'Blur' } as const;
	const surfaces = Object.keys(surfaceNames) as InterfacePreferences['surface'][];
</script>

<section class="controls" aria-label="Interface settings">
	<h2>Button and panel style</h2>
	<div class="materials" role="group" aria-label="Surface style">
		{#each surfaces as style (style)}<button
				class="material-choice"
				aria-label={surfaceNames[style]}
				aria-pressed={$interfacePreferences.surface === style}
				onclick={() => setInterface({ surface: style })}
			>
				<span class="art-preview" aria-hidden="true" data-material={style}>
					<img src={sampleArtwork} alt="" />
					<span class="sample-panel" data-surface="panel">
						<Play size={13} fill="currentColor" /><span class="sample-lines"></span>
					</span>
					{#if $interfacePreferences.surface === style}<span class="check"><Check size={13} /></span
						>{/if}
				</span>
				<span class="material-name">{surfaceNames[style]}</span>
			</button>{/each}
	</div>
	{#if $interfacePreferences.surface === 'blur'}<label class="strength"
			><span>Blur strength <output>{$interfacePreferences.blur} px</output></span><input
				aria-label="Blur strength"
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
	{#if session?.userId}
		<label
			>Start screen
			<select value={opening} onchange={(e) => changeStart(e.currentTarget.value as StartScreen)}>
				<option value="automatic">Automatic</option>
				<option value="home">Home</option>
				<option value="library">Library</option>
				<option value="player">Now Playing</option>
			</select>
		</label>
		{#if opening === 'automatic'}<p>Open Home when connected and Offline music when offline.</p>
		{:else if opening === 'player'}<p>Open your saved queue. An empty queue opens Library.</p>{/if}
		{#if saveIssue}<p role="alert">{saveIssue}</p>{/if}
	{/if}
	<h2>Navigation bar</h2>
	<div class="segmented" role="group" aria-label="Navigation bar position">
		{#each ['docked', 'floating'] as bar (bar)}<button
				aria-pressed={$interfacePreferences.bar === bar}
				onclick={() => setInterface({ bar: bar === 'floating' ? 'floating' : 'docked' })}
				>{bar === 'docked' ? 'Docked' : 'Floating'}</button
			>{/each}
	</div>
	<p>Pin up to {maxTabs} destinations. Open the top-left menu for the others and Settings.</p>
	<div class="choices" data-surface="panel">
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
	<h2>Player gestures</h2>
	<label class="pick">
		<input
			type="checkbox"
			checked={$interfacePreferences.swipeTracks}
			onchange={(e) => setInterface({ swipeTracks: e.currentTarget.checked })}
		/>
		Swipe album art or the mini-player to change tracks
	</label>
	{#if session?.userId}
		<fieldset class="mini-settings">
			<legend>Mini-player</legend>
			<label class="pick"
				><input
					type="checkbox"
					checked={mini.artwork}
					onchange={(e) => changeMini({ artwork: e.currentTarget.checked })}
				/>Show cover artwork</label
			>
			<label
				>Secondary text
				<select
					value={mini.secondary}
					onchange={(e) =>
						changeMini({ secondary: e.currentTarget.value as MiniPlayerPreferences['secondary'] })}
				>
					{#each Object.entries(miniText) as [value, label] (value)}<option {value}>{label}</option
						>{/each}
				</select>
			</label>
			<label class="pick"
				><input
					type="checkbox"
					checked={mini.progress}
					onchange={(e) => changeMini({ progress: e.currentTarget.checked })}
				/>Show track progress</label
			>
			<div class="mini-positions">
				{#each sides as side (side)}
					<label
						>{side === 'before' ? 'Before Play/Pause' : 'After Play/Pause'}
						<select
							value={mini[side]}
							onchange={(e) => placeButton(side, e.currentTarget.value as MiniButton)}
						>
							{#each Object.entries(miniButtons) as [value, label] (value)}<option {value}
									>{label}</option
								>{/each}
						</select>
					</label>
				{/each}
			</div>
			<p>Choosing a button from the other side swaps its position.</p>
			{#if miniIssue}<p role="alert">{miniIssue}</p>{/if}
		</fieldset>
	{/if}
	<button
		class="secondary"
		onclick={() => {
			setInterface(defaultInterface);
			changeMini(defaultMiniPlayer);
			changeStart('automatic');
		}}>Restore interface defaults</button
	>
</section>

<style>
	.mini-settings {
		display: grid;
		gap: 0.45rem;
		min-inline-size: 0;
		border: 0;
		margin: 1rem 0 0;
		padding: 0;
	}
	.mini-settings legend {
		font-size: 1.15rem;
		font-weight: 700;
		padding: 0;
	}
	.mini-positions {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 9rem), 1fr));
		gap: var(--gap);
	}
	.mini-positions select {
		min-width: 0;
	}
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
	output {
		color: var(--muted);
	}
	label:not(.pick) {
		display: grid;
		gap: 0.35rem;
	}
	.materials {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.5rem;
	}
	.material-choice {
		display: grid;
		align-content: start;
		text-align: start;
		min-width: 0;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		overflow: hidden;
	}
	.material-choice[aria-pressed='true'] {
		border-color: var(--dn-focus);
		box-shadow: 0 0 0 1px var(--dn-focus);
	}
	.art-preview {
		position: relative;
		display: grid;
		align-items: center;
		height: 4.5rem;
		isolation: isolate;
		padding: 0.35rem;
	}
	.art-preview img {
		position: absolute;
		inset: 0;
		z-index: -1;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: 50% 42%;
	}
	.sample-panel {
		display: flex;
		gap: 0.3rem;
		align-items: center;
		height: 1.9rem;
		padding-inline: 0.4rem;
		border-radius: max(3px, calc(var(--radius) * 0.55));
	}
	.sample-lines {
		display: grid;
		gap: 3px;
		width: 55%;
	}
	.sample-lines::before,
	.sample-lines::after {
		content: '';
		height: 2px;
		background: currentColor;
		border-radius: 99px;
	}
	.sample-lines::after {
		width: 65%;
		opacity: 0.55;
	}
	.check {
		position: absolute;
		inset-block-start: 0.25rem;
		inset-inline-end: 0.25rem;
		display: grid;
		width: 1.15rem;
		height: 1.15rem;
		place-items: center;
		border-radius: 50%;
		color: var(--dn-action-content);
		background: var(--dn-action);
	}
	.material-name {
		padding: 0.45rem;
		font-size: 0.82rem;
		font-weight: 650;
		line-height: 1.2;
	}
	.strength span {
		display: flex;
		justify-content: space-between;
	}
	.strength input {
		width: 100%;
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
