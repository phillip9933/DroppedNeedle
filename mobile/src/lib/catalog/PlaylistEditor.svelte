<script lang="ts">
	import { tr, uiText } from '../i18n';
	import InlineChoice from '../controls/InlineChoice.svelte';
	import { onDestroy, untrack } from 'svelte';
	import type { Session } from '../connection';
	import { libraryFilter, sorts } from '../boards/filteredSections';
	import { ChevronRight, Plus, ListFilter } from '@lucide/svelte';
	import { createPlaylist, type Playlist } from './playlists';
	import PlaylistDialog from './PlaylistDialog.svelte';
	import PlaylistRuleEditor from './PlaylistRuleEditor.svelte';
	import PlaylistRuleGroup from './PlaylistRuleGroup.svelte';
	import { fields, fieldName, fieldSets, firstRule } from './ruleLabels';
	import { maxSmartTracks, playlistRules, type TrackRule, type RuleGroup } from './smartRules';
	import type { PlayerTrack } from '../player';
	import { offlineInventory } from '../offline/media';
	import { availableTracks } from '../offline/library';
	import { smartPlaylistTracks, writeSmartPlaylist, type SmartPlaylist } from './smartPlaylists';

	let {
		session,
		initial,
		disconnected = false,
		onblank,
		oncreated,
		onclose
	}: {
		session: Session;
		initial?: SmartPlaylist;
		disconnected?: boolean;
		onblank?: (playlist: Playlist) => void;
		oncreated: () => void;
		onclose: () => void;
	} = $props();
	type Screen = 'start' | 'overview' | 'fields' | 'rule' | 'delete';
	let screen = $state<Screen>(untrack(() => (initial ? 'overview' : 'start')));
	let name = $state(untrack(() => initial?.name ?? ''));
	let rules = $state<RuleGroup>(
		untrack(() =>
			initial
				? structuredClone($state.snapshot(playlistRules(initial)))
				: { match: 'all', rules: [] }
		)
	);
	let sort = $state(untrack(() => initial?.sort ?? 'title'));
	let order = $state<'asc' | 'desc'>(untrack(() => initial?.order ?? 'asc'));
	const limits = [50, 100, 250, 500, 1000, 2500, 5000, maxSmartTracks];
	let limit = $state<number | undefined>(untrack(() => initial?.limit ?? maxSmartTracks));
	let customLimit = $state(untrack(() => !limits.includes(limit ?? 0)));
	let group: RuleGroup,
		existing = $state.raw<TrackRule>(),
		newGroup = false;
	let draft = $state<TrackRule>(),
		query = $state(''),
		error = $state(''),
		busy = $state(false);
	let pendingGroup = $state<RuleGroup>();
	let title = $derived(
		screen === 'start'
			? uiText('New playlist')
			: screen === 'fields'
				? tr('Add rule', '条件を追加')
				: screen === 'rule' && draft
					? tr(fieldName(draft.field) + ' rule', fieldName(draft.field) + 'の条件')
					: screen === 'delete'
						? tr('Delete smart playlist?', 'スマートプレイリストを削除しますか？')
						: initial
							? uiText('Edit smart playlist')
							: tr('Smart playlist', 'スマートプレイリスト')
	);
	const id = untrack(() => initial?.id ?? 'smart-' + crypto.randomUUID());
	let sample = $state.raw<PlayerTrack[]>(),
		previewing = $state(false);
	let request: AbortController | undefined;
	function clearPreview() {
		request?.abort();
		request = undefined;
		sample = undefined;
		previewing = false;
		error = '';
	}
	onDestroy(() => request?.abort());
	function currentRule(): SmartPlaylist {
		return { ...libraryFilter(), id, name, sort, order, limit: limit ?? 0, rules };
	}
	async function previewTracks() {
		clearPreview();
		const controller = new AbortController();
		request = controller;
		previewing = true;
		try {
			const item = currentRule();
			const local = disconnected ? availableTracks(await offlineInventory(session)) : undefined;
			const tracks = await smartPlaylistTracks(
				session,
				{
					...item,
					name: name.trim() || tr('Smart playlist', 'スマートプレイリスト'),
					limit: disconnected ? item.limit : Math.min(item.limit, 8)
				},
				controller.signal,
				local
			);
			if (!controller.signal.aborted) sample = tracks.slice(0, 8);
		} catch (e) {
			if (!controller.signal.aborted)
				error =
					e instanceof Error
						? e.message
						: tr('Could not preview tracks.', '曲をプレビューできませんでした。');
		} finally {
			if (request === controller) previewing = false;
		}
	}
	function pick(parent: RuleGroup, item?: TrackRule, nested = false) {
		clearPreview();
		group = parent;
		existing = item;
		newGroup = nested;
		query = '';
		draft = item;
		screen = item ? 'rule' : 'fields';
	}
	function applyRule(next: TrackRule) {
		if (newGroup) group.rules.push({ match: 'any', rules: [next] });
		else if (existing) group.rules[group.rules.indexOf(existing)] = next;
		else group.rules.push(next);
		screen = 'overview';
		clearPreview();
	}
	function deleteFrom(parent: RuleGroup, item: TrackRule | RuleGroup): boolean {
		const i = parent.rules.indexOf(item);
		if (i >= 0) {
			parent.rules.splice(i, 1);
			return true;
		}
		for (const child of parent.rules) {
			if ('rules' in child && deleteFrom(child, item)) {
				if (!child.rules.length) parent.rules.splice(parent.rules.indexOf(child), 1);
				return true;
			}
		}
		return false;
	}
	function removeItem(item: TrackRule | RuleGroup) {
		deleteFrom(rules, item);
		pendingGroup = undefined;
		screen = 'overview';
		clearPreview();
	}
	function back() {
		clearPreview();
		if (pendingGroup) {
			pendingGroup = undefined;
			return;
		}
		if (screen === 'rule') screen = existing ? 'overview' : 'fields';
		else if (screen === 'fields' || screen === 'delete') screen = 'overview';
		else if (screen === 'overview' && !initial) screen = 'start';
		else onclose();
	}
	async function blank() {
		if (!onblank || busy || disconnected || !name.trim()) return;
		busy = true;
		error = '';
		try {
			const playlist = await createPlaylist(session, name.trim());
			window.dispatchEvent(new Event('dn-playlists-updated'));
			onblank(playlist);
		} catch (e) {
			error =
				e instanceof Error
					? e.message
					: tr('Could not create playlist.', 'プレイリストを作成できませんでした。');
		} finally {
			busy = false;
		}
	}
	async function submit() {
		if (busy) return;
		busy = true;
		error = '';
		try {
			await writeSmartPlaylist(session, screen === 'delete' ? null : currentRule(), initial);
			oncreated();
		} catch (e) {
			error =
				e instanceof Error
					? e.message
					: tr('Could not save playlist.', 'プレイリストを保存できませんでした。');
		} finally {
			busy = false;
		}
	}
	let validLimit = $derived(
		limit !== undefined && Number.isInteger(limit) && limit >= 1 && limit <= maxSmartTracks
	);
	let ordering = $derived(
		sort === 'date_added'
			? order === 'asc'
				? tr('Oldest first', '古い順')
				: tr('Newest first', '新しい順')
			: uiText(sorts.songs.find(([v]) => v === sort)?.[1] ?? 'Song title') +
					' ' +
					(order === 'asc' ? 'A–Z' : 'Z–A')
	);
	let limitSummary = $derived(
		limit === maxSmartTracks
			? tr('Up to 10,000 tracks', '最大10,000曲')
			: tr((limit ?? 0).toLocaleString() + ' tracks', (limit ?? 0).toLocaleString() + '曲')
	);
	let filteredSets = $derived(
		fieldSets
			.map((set) => ({
				...set,
				fields: set.fields.filter((field) =>
					fieldName(field).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
				)
			}))
			.filter((set) => set.fields.length)
	);
</script>

{#snippet save()}
	<button
		class="text-button save"
		aria-label={initial ? uiText('Save playlist') : uiText('Create smart playlist')}
		disabled={busy || !name.trim() || !validLimit || !!pendingGroup}
		onclick={submit}>{uiText('Save')}</button
	>
{/snippet}
{#key screen}
	<PlaylistDialog
		{title}
		page={screen !== 'start' && screen !== 'delete'}
		{busy}
		onclose={back}
		action={screen === 'overview' ? save : undefined}
	>
		{#if screen === 'start'}
			<form
				onsubmit={(e) => {
					e.preventDefault();
					void blank();
				}}
			>
				<label
					>{uiText('Playlist name')}<input
						bind:value={name}
						maxlength="64"
						disabled={busy}
					/></label
				>
				<div class="kinds">
					<button class="secondary" type="submit" disabled={busy || disconnected || !name.trim()}
						><Plus size={21} /><span
							>{tr('Create empty playlist', '空のプレイリストを作成')}<small
								>{disconnected
									? tr(
											'Connect to DN to create a playlist.',
											'作成するには DN に接続してください。'
										)
									: tr('Add tracks yourself.', 'あとから曲を追加します。')}</small
							></span
						></button
					>
					<button
						class="secondary"
						type="button"
						disabled={busy}
						onclick={() => {
							screen = 'overview';
							error = '';
						}}
						><ListFilter size={21} /><span
							>{tr('Smart playlist', 'スマートプレイリスト')}<small
								>{tr(
									'Choose rules for library tracks.',
									'ライブラリの曲を選ぶ条件を設定します。'
								)}</small
							></span
						></button
					>
				</div>
				<button class="text-button" type="button" disabled={busy} onclick={onclose}
					>{uiText('Cancel')}</button
				>
			</form>
		{:else if screen === 'delete'}
			<p>{uiText('Delete “')}{initial?.name}{uiText('” from this device?')}</p>
			<div class="actions">
				<button class="secondary" disabled={busy} onclick={back}>{uiText('Cancel')}</button>
				<button class="primary" disabled={busy} onclick={submit}>{uiText('Delete playlist')}</button
				>
			</div>
		{:else if screen === 'fields'}
			<input
				class="search"
				type="search"
				bind:value={query}
				aria-label={tr('Find a rule', '条件を検索')}
				placeholder={tr('Find a rule', '条件を検索')}
			/>
			{#each filteredSets as set (set.name[0])}
				<h3>{tr(...set.name)}</h3>
				{#each set.fields as field (field)}
					{@const Icon = fields[field].icon}
					<button
						class="field-row"
						onclick={() => {
							draft = firstRule(field);
							screen = 'rule';
						}}><Icon size={19} /><span>{fieldName(field)}</span><ChevronRight size={16} /></button
					>
				{/each}
			{/each}
			{#if !filteredSets.length}<p>{tr('No matching rules', '該当する条件がありません')}</p>{/if}
		{:else if screen === 'rule' && draft}
			<PlaylistRuleEditor
				initial={draft}
				{session}
				{disconnected}
				apply={applyRule}
				remove={existing ? () => removeItem(existing!) : undefined}
			/>
		{:else if screen === 'overview'}
			<label
				>{uiText('Playlist name')}<input
					bind:value={name}
					maxlength="64"
					placeholder={uiText('Five-star songs')}
				/></label
			>
			<h3>{tr('Rules', '条件')}</h3>
			{#if !rules.rules.length}<p class="muted">
					{tr(
						'All library tracks match until you add a rule.',
						'条件を追加するまではライブラリの全曲が対象です。'
					)}
				</p>{/if}
			<PlaylistRuleGroup
				group={rules}
				{pick}
				addGroup={(parent) => pick(parent, undefined, true)}
				changeMode={(g, mode) => {
					g.match = mode;
					clearPreview();
				}}
				remove={(g) => (pendingGroup = g)}
			/>
			{#if pendingGroup}
				<div class="confirm" role="group" aria-label={tr('Remove group', 'グループを削除')}>
					<p>{tr('Remove this group and its rules?', 'このグループと条件を削除しますか？')}</p>
					<button class="secondary" onclick={() => (pendingGroup = undefined)}
						>{uiText('Cancel')}</button
					>
					<button class="secondary" onclick={() => removeItem(pendingGroup!)}
						>{uiText('Remove')}</button
					>
				</div>
			{/if}
			<details class="options">
				<summary
					><b>{tr('Playlist options', 'プレイリストのオプション')}</b><small
						>{ordering} · {limitSummary}</small
					></summary
				>
				<label
					>{uiText('Sort by')}<InlineChoice
						selected={sort}
						label={tr('Playlist sort', 'プレイリストの並び順')}
						><select bind:value={sort} onchange={clearPreview}
							>{#each sorts.songs as [key, label] (key)}<option value={key}>{uiText(label)}</option
								>{/each}</select
						></InlineChoice
					></label
				>
				<label
					>{uiText('Sort direction')}<InlineChoice selected={order}
						><select bind:value={order} onchange={clearPreview}>
							<option value="asc">{uiText('Ascending')}</option><option value="desc"
								>{uiText('Descending')}</option
							>
						</select></InlineChoice
					></label
				>
				<label
					>{uiText('Track limit')}<InlineChoice selected={customLimit ? 'custom' : limit}>
						<select
							value={customLimit ? 'custom' : limit}
							onchange={(e) => {
								clearPreview();
								customLimit = e.currentTarget.value === 'custom';
								if (!customLimit) limit = Number(e.currentTarget.value);
							}}
						>
							{#each limits as n (n)}<option value={n}
									>{n === maxSmartTracks
										? tr('Up to 10,000 tracks', '最大10,000曲')
										: n.toLocaleString()}</option
								>{/each}
							<option value="custom">{tr('Custom…', '指定…')}</option>
						</select></InlineChoice
					></label
				>
				{#if customLimit}<label
						>{tr('Maximum tracks', '最大曲数')}<input
							bind:value={limit}
							type="number"
							inputmode="numeric"
							min="1"
							max={maxSmartTracks}
							step="1"
							oninput={clearPreview}
						/></label
					>
					{#if !validLimit}<small role="alert"
							>{tr('Choose 1 to 10,000 tracks.', '1〜10,000曲の範囲で指定してください。')}</small
						>{/if}{/if}
				<small>{tr('Rules are saved on this device.', '条件はこの端末に保存されます。')}</small>
			</details>
			<button
				class="secondary preview"
				disabled={busy || previewing || !validLimit}
				onclick={previewTracks}>{tr('Preview matching tracks', '該当する曲をプレビュー')}</button
			>
			{#if previewing}<p role="status">{uiText('Loading…')}</p>{:else if sample}<section
					aria-label={tr('Matching tracks', '該当する曲')}
				>
					{#if sample.length}<ol class="sample">
							{#each sample as t (t.id)}<li>{t.title}<small>{t.artist}</small></li>{/each}
						</ol>{:else}<p>{tr('No matching tracks.', '該当する曲はありません。')}</p>{/if}
				</section>{/if}
			<div class="bottom">
				<button class="text-button" disabled={busy} onclick={onclose}>{uiText('Cancel')}</button>
				{#if initial}<button
						class="text-button"
						disabled={busy}
						onclick={() => {
							clearPreview();
							screen = 'delete';
						}}>{uiText('Delete smart playlist')}</button
					>{/if}
			</div>
		{/if}
		{#if error}<p role="alert">{error}</p>{/if}
	</PlaylistDialog>
{/key}

<style>
	.kinds {
		display: grid;
		gap: 0.45rem;
		margin-block: var(--gap);
	}
	.kinds button,
	.field-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		text-align: start;
	}
	.kinds button {
		padding: 0.75rem;
	}
	.kinds small {
		margin-top: 0.15rem;
	}
	h3 {
		margin: 1.3rem 0 0.4rem;
		font-size: 1.05rem;
	}
	.search {
		margin-top: 0.8rem;
	}
	.field-row {
		width: 100%;
		min-height: 48px;
		padding: 0.4rem 0.1rem;
		border-radius: 0;
		background: transparent;
		border-bottom: 1px solid var(--line);
		color: var(--text);
	}
	.field-row span {
		flex: 1;
	}
	small,
	.muted {
		display: block;
		color: var(--muted);
		font-weight: 400;
	}
	.options {
		border-block: 1px solid var(--line);
		margin-block: 1rem;
		padding-block: 0.5rem;
	}
	summary {
		min-height: 44px;
		cursor: pointer;
		padding-block: 0.3rem;
	}
	summary small {
		margin: 0.15rem 0 0 1rem;
	}
	.preview {
		min-width: 100%;
		min-height: 44px;
	}
	.bottom,
	.confirm {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-block: 1rem;
	}
	.confirm p {
		flex-basis: 100%;
		margin: 0;
	}
	.sample {
		padding-inline-start: 1.6rem;
	}
	.sample li {
		padding: 0.35rem;
	}
</style>
