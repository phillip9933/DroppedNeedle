<script lang="ts">
	import { Check, ChevronDown } from '@lucide/svelte';
	import { onDestroy, tick } from 'svelte';
	import { tr, uiText } from '../i18n';
	import { openChoice, releaseChoice } from '../controls/inlineChoices';
	let {
		label,
		values,
		selected,
		multiple = false,
		loading = false,
		error = '',
		retry,
		onchange
	}: {
		label: string;
		values: string[];
		selected: string[];
		multiple?: boolean;
		loading?: boolean;
		error?: string;
		retry: () => void;
		onchange: (values: string[]) => void;
	} = $props();
	const id = $props.id();
	let open = $state(false),
		query = $state(''),
		shown = $state(60);
	let panel = $state<HTMLDivElement>(null!),
		trigger: HTMLButtonElement;
	let matches = $derived(
		values.filter((v) => v.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
	);
	let exactGenre = $derived(query.trim());
	let canUseTypedGenre = $derived(
		!multiple &&
			!!exactGenre &&
			exactGenre.length <= 160 &&
			!values.some((v) => v.toLocaleLowerCase() === exactGenre.toLocaleLowerCase())
	);
	const display = (s: string) => (multiple ? s.toUpperCase() : s);
	function close(focus = false) {
		open = false;
		panel?.hidePopover?.();
		releaseChoice(close);
		if (focus) trigger?.focus();
	}
	onDestroy(() => releaseChoice(close));
	async function toggle() {
		if (open) {
			close();
			return;
		}
		openChoice(close);
		query = '';
		shown = 60;
		open = true;
		await tick();
		if (!open) return;
		panel.showPopover?.();
		position();
		panel.focus({ preventScroll: true });
	}
	function position() {
		if (!open || !panel) return;
		const rect = trigger.getBoundingClientRect(),
			height = window.visualViewport?.height ?? window.innerHeight;
		const top = window.visualViewport?.offsetTop ?? 0,
			below = top + height - rect.bottom - 10,
			above = rect.top - top - 10;
		const down = below >= 190 || below >= above;
		panel.style.maxHeight = Math.max(92, Math.min(330, down ? below : above)) + 'px';
		panel.style.width = rect.width + 'px';
		panel.style.left = rect.left + 'px';
		panel.style.top = (down ? rect.bottom + 3 : rect.top - panel.offsetHeight - 3) + 'px';
	}
	$effect(() => {
		if (!open || !panel) return;
		const resize = new ResizeObserver(position);
		resize.observe(panel);
		const controller = new AbortController(),
			signal = controller.signal;
		document.addEventListener(
			'pointerdown',
			(e) => {
				if (e.target instanceof Node && !panel?.contains(e.target) && !trigger.contains(e.target))
					close();
			},
			{ capture: true, signal }
		);
		window.visualViewport?.addEventListener('resize', position, { signal });
		window.addEventListener('resize', position, { signal });
		window.addEventListener(
			'scroll',
			(e) => {
				if (e.target !== panel && !panel?.contains(e.target as Node)) position();
			},
			{ capture: true, signal }
		);
		return () => {
			resize.disconnect();
			controller.abort();
		};
	});
	function choose(value: string) {
		if (!multiple) {
			onchange([value]);
			close(true);
		} else
			onchange(
				selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]
			);
	}
</script>

<span class="caption" id={id + '-label'}>{label}</span>
<button
	class="trigger"
	bind:this={trigger}
	aria-labelledby={id + '-label ' + id + '-value'}
	aria-expanded={open}
	aria-haspopup="dialog"
	onclick={toggle}
>
	<span id={id + '-value'}
		>{selected.length ? selected.map(display).join(', ') : tr('Choose…', '選択…')}</span
	><ChevronDown size={16} />
</button>
{#if open}
	<div
		class="popup"
		popover="manual"
		bind:this={panel}
		role="dialog"
		tabindex="-1"
		aria-label={label}
	>
		<input
			type="search"
			aria-label={tr('Search choices', '選択肢を検索')}
			placeholder={multiple
				? tr('Find a format', '形式を検索')
				: tr('Find a genre', 'ジャンルを検索')}
			maxlength={multiple ? 32 : 160}
			bind:value={query}
			oninput={() => (shown = 60)}
		/>
		{#each matches.slice(0, shown) as value (value)}
			<button class="option" aria-pressed={selected.includes(value)} onclick={() => choose(value)}>
				{display(value)}{#if selected.includes(value)}<Check size={16} />{/if}
			</button>
		{/each}
		{#if canUseTypedGenre}<button class="option" onclick={() => choose(exactGenre)}
				>{tr(
					'Use exact genre “' + exactGenre + '”',
					'ジャンル「' + exactGenre + '」を指定'
				)}</button
			>{/if}
		{#if matches.length > shown}<button class="text-button" onclick={() => (shown += 60)}
				>{tr('Show more', 'さらに表示')}</button
			>{/if}
		{#if loading}<p role="status">{uiText('Loading…')}</p>
		{:else if error}<p role="alert">{error}</p>
			<button class="text-button" onclick={retry}>{uiText('Retry')}</button>
		{:else if !matches.length && !canUseTypedGenre}<p>
				{tr('No matching choices', '該当する選択肢がありません')}
			</p>{/if}
		{#if multiple}<button class="text-button" onclick={() => close(true)}>{uiText('Done')}</button
			>{/if}
	</div>
{/if}

<style>
	.caption {
		display: block;
		margin: 0.75rem 0 0.3rem;
	}
	.trigger,
	.option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		text-align: start;
		min-height: 44px;
		width: 100%;
	}
	.trigger {
		padding: 0.6rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
	}
	.trigger span {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.trigger :global(svg) {
		flex: none;
	}
	.popup {
		position: fixed;
		inset: auto;
		box-sizing: border-box;
		overflow-y: auto;
		overscroll-behavior: contain;
		margin: 0;
		padding: 0.35rem;
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		box-shadow: 0 4px 18px #0003;
	}
	.popup input {
		width: 100%;
		margin-bottom: 0.3rem;
	}
	.popup p {
		margin: 0.6rem;
		color: var(--muted);
	}
	.option {
		background: transparent;
		color: var(--text);
		padding: 0.4rem 0.65rem;
		border-radius: 0;
		border-bottom: 1px solid var(--line);
	}
	.option[aria-pressed='true'] {
		color: var(--accent);
	}
</style>
