<script lang="ts">
	import { onMount, tick, type Snippet } from 'svelte';
	import { Check, ChevronDown } from '@lucide/svelte';
	import { openChoice, releaseChoice } from './inlineChoices';

	let { children, selected, label }: { children: Snippet; selected: unknown; label?: string } =
		$props();
	const id = $props.id();
	let host: HTMLSpanElement;
	let trigger: HTMLButtonElement;
	let menu = $state<HTMLSpanElement>();
	let source: HTMLSelectElement | undefined;
	let expanded = $state(false);
	let disabled = $state(false);
	let caption = $state('');
	let value = $state('');
	let fieldName = $state('');
	let chosen = $state(-1);
	let active = $state(-1);
	type Choice = { index: number; value: string; text: string; disabled: boolean };
	type Group = { label?: string; options: Choice[] };
	let groups = $state.raw<Group[]>([]);
	let search = '';
	let lastKey = 0;

	function read() {
		if (!source) return;
		const option = source.options[source.selectedIndex];
		caption = option?.label ?? '';
		chosen = source.selectedIndex;
		value = source.value;
		disabled = source.disabled;
		if (source.matches(':disabled')) dismiss();
		if (!expanded) return;
		const next: Group[] = [];
		let previous: Element | null = null;
		for (const option of source.options) {
			const parent = option.parentElement;
			if (option.hidden || (parent instanceof HTMLOptGroupElement && parent.hidden)) continue;
			if (parent !== previous || !next.length) {
				next.push({
					label: parent instanceof HTMLOptGroupElement ? parent.label : undefined,
					options: []
				});
				previous = parent;
			}
			next[next.length - 1].options.push({
				index: option.index,
				value: option.value,
				text: option.label,
				disabled: option.disabled || (parent instanceof HTMLOptGroupElement && parent.disabled)
			});
		}
		groups = next;
		if (!enabled().some((item) => item.index === active)) active = initial();
	}

	function readName() {
		// The only labelable visible control is the trigger. The open options must
		// never become part of the field's accessible name.
		const outer = host.closest('label');
		fieldName = outer
			? Array.from(outer.childNodes)
					.filter((node) => !node.contains(host))
					.map((node) => node.textContent)
					.join(' ')
					.trim()
					.replace(/\s+/g, ' ')
			: '';
	}

	onMount(() => {
		source = host.querySelector('select')!;
		readName();
		read();
		const observer = new MutationObserver((mutations) => {
			if (mutations.some(({ target }) => source?.contains(target) || target === fieldset)) read();
			if (mutations.some(({ target }) => !host.contains(target))) readName();
		});
		observer.observe(host.closest('label') ?? source, {
			childList: true,
			subtree: true,
			characterData: true,
			attributes: true,
			attributeFilter: ['disabled', 'hidden', 'label', 'value', 'selected']
		});
		const fieldset = source.closest('fieldset');
		if (fieldset) observer.observe(fieldset, { attributes: true, attributeFilter: ['disabled'] });
		const original = source;
		original.addEventListener('change', read);
		return () => {
			releaseChoice(dismiss);
			observer.disconnect();
			original.removeEventListener('change', read);
		};
	});

	// A Svelte value binding writes the select's DOM property. It does not
	// necessarily fire an event (for example, on asynchronous settings restore).
	$effect(() => {
		void selected;
		void tick().then(read);
	});

	$effect(() => {
		if (!expanded) return;
		const events = new AbortController();
		const capture = { capture: true, signal: events.signal };
		let pointer = false;
		function outside(event: Event) {
			// Collapsing on pointer focus would move the intended action between
			// pointerdown and click. Let the click reach its original target.
			if (event.type === 'focusin' && pointer) return;
			pointer = false;
			if (event.target instanceof Node && !host.contains(event.target)) dismiss();
		}
		document.addEventListener(
			'pointerdown',
			() => {
				pointer = true;
			},
			capture
		);
		document.addEventListener(
			'pointercancel',
			() => {
				pointer = false;
			},
			capture
		);
		document.addEventListener(
			'keydown',
			() => {
				pointer = false;
			},
			capture
		);
		document.addEventListener('click', outside, capture);
		document.addEventListener('focusin', outside, capture);
		return () => events.abort();
	});

	function enabled() {
		return groups.flatMap((group) => group.options).filter((item) => !item.disabled);
	}
	function initial() {
		const items = enabled();
		return (items.find((item) => item.index === chosen) ?? items[0])?.index ?? -1;
	}
	function dismiss(restoreFocus = false) {
		releaseChoice(dismiss);
		expanded = false;
		search = '';
		if (restoreFocus && !disabled && trigger?.isConnected) trigger.focus({ preventScroll: true });
	}
	function reveal() {
		if (!source || source.matches(':disabled') || expanded) return;
		openChoice(dismiss);
		expanded = true;
		read();
		active = initial();
		trigger.focus({ preventScroll: true });
		void tick().then(() => {
			if (!expanded || !menu) return;
			menu.showPopover?.();
			positionMenu();
			scrollActive();
		});
	}
	function positionMenu() {
		if (!expanded || !menu) return;
		const rect = trigger.getBoundingClientRect();
		const viewport = window.visualViewport;
		const left = viewport?.offsetLeft ?? 0,
			top = viewport?.offsetTop ?? 0;
		const width = viewport?.width ?? window.innerWidth,
			height = viewport?.height ?? window.innerHeight;
		const maxBottom = top + height - 6;
		const below = Math.max(0, maxBottom - rect.bottom - 4);
		const above = Math.max(0, rect.top - top - 10);
		const up = below < Math.min(menu.scrollHeight + 2, 240) && above > below;
		menu.style.width = Math.min(Math.max(rect.width, 152), width - 12) + 'px';
		menu.style.maxHeight = Math.min(288, up ? above : below) + 'px';
		menu.style.left =
			Math.max(left + 6, Math.min(rect.left, left + width - menu.offsetWidth - 6)) + 'px';
		menu.style.top = (up ? rect.top - 4 - menu.offsetHeight : rect.bottom + 4) + 'px';
	}
	$effect(() => {
		if (!expanded) return;
		const events = new AbortController();
		const options = { capture: true, signal: events.signal };
		window.addEventListener('scroll', positionMenu, options);
		window.addEventListener('resize', positionMenu, options);
		window.visualViewport?.addEventListener('resize', positionMenu, options);
		window.visualViewport?.addEventListener('scroll', positionMenu, options);
		return () => events.abort();
	});
	function scrollActive() {
		const option = document.getElementById(id + '-option-' + active);
		if (!expanded || !menu || !option) return;
		const bounds = menu.getBoundingClientRect(),
			item = option.getBoundingClientRect();
		if (item.top < bounds.top) menu.scrollTop += item.top - bounds.top;
		else if (item.bottom > bounds.bottom) menu.scrollTop += item.bottom - bounds.bottom;
	}
	function choose(index: number) {
		if (
			!source ||
			source.matches(':disabled') ||
			!enabled().some((option) => option.index === index)
		)
			return;
		const field = source;
		const accepted = selected;
		const previous = field.selectedOptions[0];
		const option = field.options[index];
		dismiss(true);
		if (option === previous) return;
		field.selectedIndex = index;
		field.dispatchEvent(new Event('input', { bubbles: true }));
		field.dispatchEvent(new Event('change', { bubbles: true }));
		void tick().then(() => {
			if (!field.isConnected) return;
			// A controlled setting can wait for an asynchronous save or reject it.
			// Keep the old choice until its owner accepts the new one.
			if (
				selected === accepted &&
				field.selectedOptions[0] === option &&
				(!previous || field.contains(previous))
			)
				field.selectedIndex = previous?.index ?? -1;
			read();
		});
	}
	function keys(event: KeyboardEvent) {
		const key = event.key;
		if (event.ctrlKey || event.metaKey || (event.altKey && !['ArrowDown', 'ArrowUp'].includes(key)))
			return;
		if (key === 'Tab') {
			if (expanded && active >= 0) choose(active);
			else dismiss();
			return;
		}
		const typing = key.length === 1 && key !== ' ';
		if (
			!typing &&
			!['Enter', ' ', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(key)
		)
			return;
		event.preventDefault();
		event.stopPropagation();
		if (expanded && (key === 'Enter' || key === ' ' || (event.altKey && key === 'ArrowUp'))) {
			choose(active);
			return;
		}
		const wasOpen = expanded;
		reveal();
		const items = enabled();
		if (!items.length) return;
		const at = items.findIndex((option) => option.index === active);
		if (key === 'Home' || (!wasOpen && key === 'ArrowUp')) active = items[0].index;
		if (key === 'End') active = items[items.length - 1].index;
		if (wasOpen && key === 'ArrowDown') active = items[Math.min(items.length - 1, at + 1)].index;
		if (wasOpen && key === 'ArrowUp') active = items[Math.max(0, at - 1)].index;
		if (key === 'PageUp') active = items[Math.max(0, at - 10)].index;
		if (key === 'PageDown') active = items[Math.min(items.length - 1, at + 10)].index;
		if (typing) {
			const now = Date.now();
			const char = key.toLocaleLowerCase();
			search = now - lastKey > 650 || search === char ? char : search + char;
			lastKey = now;
			const from = search.length === 1 ? at + 1 : at;
			const match = [...items.slice(from), ...items.slice(0, from)].find((option) =>
				option.text.toLocaleLowerCase().startsWith(search)
			);
			if (match) active = match.index;
		}
		void tick().then(scrollActive);
	}
</script>

<span class="inline-choice" data-inline-choice bind:this={host}>
	<span class="field">
		<button
			type="button"
			role="combobox"
			class="trigger"
			bind:this={trigger}
			{disabled}
			aria-label={label || fieldName}
			aria-expanded={expanded}
			aria-haspopup="listbox"
			aria-controls={expanded ? id + '-choices' : undefined}
			aria-activedescendant={expanded && active >= 0 ? id + '-option-' + active : undefined}
			data-value={value}
			onkeydown={keys}
			onclick={() => (expanded ? dismiss() : reveal())}
		>
			<span class="sr-only">{caption}</span><ChevronDown size={16} aria-hidden="true" />
		</button>
		<span class="native" aria-hidden="true" inert>{@render children()}</span>
	</span>
	{#if expanded}
		<span
			bind:this={menu}
			popover="manual"
			id={id + '-choices'}
			role="listbox"
			aria-label={label || fieldName}
			class="choices"
		>
			{#each groups as group, i (i)}
				<span role={group.label ? 'group' : 'presentation'} aria-label={group.label}>
					{#if group.label}<span class="group-name" aria-hidden="true">{group.label}</span>{/if}
					{#each group.options as item (item.index)}
						<button
							type="button"
							role="option"
							id={id + '-option-' + item.index}
							tabindex="-1"
							aria-selected={chosen === item.index}
							aria-disabled={item.disabled}
							data-value={item.value}
							class:active={active === item.index}
							onmousedown={(event) => event.preventDefault()}
							onclick={(event) => {
								event.preventDefault();
								choose(item.index);
							}}
						>
							<span>{item.text}</span>
							{#if chosen === item.index}<Check size={16} aria-hidden="true" />{/if}
						</button>
					{/each}
				</span>
			{/each}
		</span>
	{/if}
</span>

<style>
	.inline-choice {
		display: inline-grid;
		vertical-align: middle;
		scroll-margin-block: 0.5rem;
		min-width: 0;
		max-width: 100%;
		align-content: start;
		text-align: start;
	}
	:global(html[data-navigation='floating'] main) .inline-choice {
		scroll-margin-block-end: calc(var(--footer-height, 0px) + 0.5rem);
	}
	:global(html[data-navigation='floating'] dialog) .inline-choice {
		scroll-margin-block-end: 0.5rem;
	}
	.field {
		display: grid;
		position: relative;
		min-width: 0;
	}
	.native {
		display: grid;
		min-width: 0;
		pointer-events: none;
	}
	.native :global(select) {
		appearance: none;
		width: 100%;
		max-width: 100%;
		min-width: 0;
		min-height: 44px;
		cursor: inherit;
		text-overflow: ellipsis;
		padding-inline-end: 2.2rem;
	}
	.trigger {
		position: absolute;
		z-index: 1;
		inset: 0;
		display: flex;
		justify-content: flex-end;
		align-items: center;
		padding-inline: 0.65rem;
		width: 100%;
		height: 100%;
		color: inherit;
		background: transparent;
		border: none;
		border-radius: var(--radius);
	}
	.trigger :global(svg) {
		pointer-events: none;
		transition: transform 0.15s;
	}
	.trigger[aria-expanded='true'] :global(svg) {
		transform: rotate(180deg);
	}
	.choices {
		position: fixed;
		inset: auto;
		z-index: 1000;
		box-sizing: border-box;
		margin: 0;
		display: grid;
		min-width: 0;
		max-height: min(45dvh, 18rem);
		overflow-y: auto;
		overscroll-behavior: contain;
		touch-action: pan-y;
		box-shadow: 0 4px 18px #0003;
		padding: 0.2rem;
		border: 1px solid var(--dn-edge);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
	}
	.choices > span {
		display: grid;
		min-width: 0;
	}
	.choices button {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.4rem;
		min-height: 44px;
		min-width: 0;
		padding: 0.55rem 0.65rem;
		border-radius: calc(var(--radius) / 2);
		text-align: start;
		overflow-wrap: anywhere;
	}
	.choices button[aria-selected='true'] {
		color: var(--accent);
		font-weight: 650;
	}
	.choices button[aria-disabled='true'] {
		opacity: 0.5;
		cursor: default;
	}
	.choices button.active {
		background: color-mix(in srgb, var(--accent) 13%, var(--surface));
	}
	.choices button :global(svg) {
		flex: none;
	}
	.group-name {
		padding: 0.4rem 0.65rem;
		color: var(--muted);
		font-size: 0.85em;
	}
	@media (prefers-reduced-motion: reduce) {
		.trigger :global(svg) {
			transition: none;
		}
	}
</style>
