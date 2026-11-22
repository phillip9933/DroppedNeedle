<script lang="ts">
	import { untrack } from 'svelte';
	import { Star } from '@lucide/svelte';
	import { tr } from '../i18n';
	import { getJson, type Session } from '../connection';
	import { availableTracks } from '../offline/library';
	import { offlineInventory } from '../offline/media';
	import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
	import { path } from './catalog';
	import { readLibraryGenres } from './libraryGenres';
	import { fields, conditionName, fieldName } from './ruleLabels';
	import type { TrackRule } from './smartRules';
	import InlineChoice from '../controls/InlineChoice.svelte';
	import PlaylistRuleValues from './PlaylistRuleValues.svelte';
	let {
		initial,
		session,
		disconnected,
		apply,
		remove
	}: {
		initial: TrackRule;
		session: Session;
		disconnected: boolean;
		apply: (r: TrackRule) => void;
		remove?: () => void;
	} = $props();
	const field = untrack(() => initial.field);
	let op = $state(untrack(() => initial.op));
	let value = $state<TrackRule['value']>(
		untrack(() => (Array.isArray(initial.value) ? [...initial.value] : initial.value))
	);
	let libraryValues = $state<string[]>([]),
		loading = $state(false),
		error = $state(''),
		attempt = $state(0);
	const options = fields[field].conditions;
	const currentYear = new Date().getFullYear();
	const numericChoices =
		field === 'year'
			? Array.from({ length: 130 }, (_, i) => currentYear + 1 - i)
			: field === 'plays'
				? [0, 1, 2, 3, 5, 10, 20, 50, 100]
				: [7, 14, 30, 60, 90, 180, 365];
	let custom = $state(
		untrack(() => typeof initial.value === 'number' && !numericChoices.includes(initial.value))
	);
	const maximum = field === 'year' ? 9999 : field === 'plays' ? 1000000 : 36500;
	const minimum = field === 'plays' ? 0 : 1;
	let numeric = $derived(typeof value === 'number' ? value : undefined);
	let valid = $derived(
		typeof value === 'string'
			? !!value.trim()
			: Array.isArray(value)
				? value.length > 0
				: typeof value === 'number'
					? Number.isSafeInteger(value) && value >= minimum && value <= maximum
					: true
	);
	const isFormat = field === 'format';
	let selected = $derived(
		Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : []
	);
	let choices = $derived(
		[...new Set([...selected, ...libraryValues])].sort((a, b) => a.localeCompare(b))
	);
	$effect(() => {
		if (field !== 'genre' && !isFormat) return;
		const owner = session,
			local = disconnected,
			controller = new AbortController();
		void attempt;
		error = '';
		loading = true;
		async function read() {
			if (local) {
				const tracks = availableTracks(await offlineInventory(owner));
				return tracks.flatMap((track) => {
					const raw = isFormat ? track.format : track.genre;
					return raw ? [raw] : [];
				});
			}
			if (isFormat) {
				const stats = await getJson<components['schemas']['StatsView']>(
					owner,
					path('/api/v3/library/stats'),
					controller.signal
				);
				return Object.keys(stats.format_breakdown);
			}
			const choices = await readLibraryGenres(
				owner,
				controller.signal,
				(_count, _total, entries) => {
					if (!controller.signal.aborted)
						libraryValues = Array.from(entries, ([name]) => name).filter(Boolean);
				}
			);
			return choices.map(([name]) => name);
		}
		void read()
			.then((values) => {
				if (!controller.signal.aborted)
					libraryValues = values.filter(Boolean).map((v) => (isFormat ? v.toLowerCase() : v));
			})
			.catch(() => {
				if (!controller.signal.aborted)
					error = tr(
						'Could not load library choices.',
						'ライブラリの選択肢を取得できませんでした。'
					);
			})
			.finally(() => {
				if (!controller.signal.aborted) loading = false;
			});
		return () => controller.abort();
	});
</script>

<div class="editor">
	{#if options.length > 1}
		<label
			>{tr('Condition', '条件')}<InlineChoice selected={op}>
				<select bind:value={op}
					>{#each options as item (item)}<option value={item}>{conditionName(item, field)}</option
						>{/each}</select
				>
			</InlineChoice></label
		>
	{/if}
	{#if field === 'genre' || isFormat}
		<PlaylistRuleValues
			label={fieldName(field)}
			values={choices}
			{selected}
			multiple={isFormat}
			{loading}
			{error}
			retry={() => attempt++}
			onchange={(items) => (value = isFormat ? items : (items[0] ?? ''))}
		/>
	{:else if field === 'rating'}
		<fieldset>
			<legend>{fieldName(field)}</legend>
			<div class="stars">
				{#each [1, 2, 3, 4, 5] as n (n)}<button
						aria-label={tr(n + (n === 1 ? ' star' : ' stars'), '星' + n)}
						aria-pressed={n === value}
						onclick={() => (value = n)}
						><Star size={27} fill={n <= Number(value) ? 'currentColor' : 'none'} /></button
					>{/each}
			</div>
		</fieldset>
	{:else if field === 'favorite'}
		<label
			>{fieldName(field)}<InlineChoice selected={value}
				><select value={String(value)} onchange={(e) => (value = e.currentTarget.value === 'true')}>
					<option value="true">{tr('Yes', 'はい')}</option><option value="false"
						>{tr('No', 'いいえ')}</option
					>
				</select></InlineChoice
			></label
		>
	{:else if field === 'query'}
		<label
			>{tr('Contains', '含むテキスト')}<input
				type="search"
				maxlength="150"
				value={String(value)}
				oninput={(e) => (value = e.currentTarget.value)}
			/></label
		>
	{:else}
		{@const label = field === 'lastPlayed' ? tr('Time period', '期間') : fieldName(field)}
		<label
			>{label}<InlineChoice selected={custom ? 'custom' : numeric}>
				<select
					value={custom ? 'custom' : numeric}
					onchange={(e) => {
						custom = e.currentTarget.value === 'custom';
						if (!custom) value = Number(e.currentTarget.value);
					}}
				>
					{#each numericChoices as n (n)}<option value={n}
							>{field === 'lastPlayed' ? tr(n + ' days', n + '日') : n}</option
						>{/each}
					<option value="custom">{tr('Custom…', '指定…')}</option>
				</select>
			</InlineChoice></label
		>
		{#if custom}<label
				>{field === 'lastPlayed'
					? tr('Number of days', '日数')
					: tr('Custom value', '値を指定')}<input
					type="number"
					inputmode="numeric"
					min={minimum}
					max={maximum}
					step="1"
					value={numeric}
					oninput={(e) => (value = e.currentTarget.valueAsNumber)}
				/></label
			>{/if}
		{#if field === 'lastPlayed' && op === 'olderThan'}<small
				>{tr('Includes tracks you have never played.', '一度も再生していない曲も含みます。')}</small
			>{/if}
	{/if}
	<div class="footer">
		{#if remove}<button class="text-button" onclick={remove}
				>{tr('Remove rule', '条件を削除')}</button
			>{/if}
		<button
			class="primary"
			disabled={!valid}
			onclick={() =>
				apply({
					field,
					op,
					value: Array.isArray(value)
						? [...value]
						: typeof value === 'string'
							? value.trim()
							: value
				})}>{tr('Apply rule', '条件を適用')}</button
		>
	</div>
</div>

<style>
	.editor {
		display: flex;
		flex-direction: column;
		min-height: calc(100% - 4rem);
	}
	.footer {
		margin-top: auto;
		padding-block: 1rem;
		display: grid;
		gap: 0.45rem;
	}
	.editor .footer .primary {
		width: 100%;
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0.7rem 0;
	}
	.stars {
		display: flex;
	}
	.stars button {
		min-height: 44px;
		min-width: 44px;
		color: var(--accent);
		background: transparent;
		padding: 0.4rem;
	}
	small {
		color: var(--muted);
	}
</style>
