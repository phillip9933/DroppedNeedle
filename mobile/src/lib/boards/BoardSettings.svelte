<script lang="ts">
	import { uiText } from '../i18n';
	import { onMount } from 'svelte';
	import type { Session } from '../connection';
	import { saveCollectionEdits, type CollectionEdits } from '../catalog/browsePreferences';
	import {
		accountId,
		loadLayout,
		saveLayout,
		savedSections,
		type LayoutTarget,
		type Section
	} from './layout';
	import type { FilterSection } from './filteredSections';
	import PlayerComposer from '../player/PlayerComposer.svelte';
	import { openPlayerDraft, type PlayerDraft } from '../player/playerDraft';
	import LayoutEditor from './LayoutEditor.svelte';
	let { board, session, onback }: { board: LayoutTarget; session: Session; onback: () => void } =
		$props();
	let filters = $state<FilterSection[]>([]);
	let recovery = $state.raw<PlayerDraft>();
	let owner = $state(''),
		sections = $state<Section[]>([]),
		error = $state('');
	const listener = $derived(session.userId ? session : { ...session, userId: owner });
	async function read() {
		error = '';
		try {
			owner = await accountId(session);
			if (board !== 'player') filters = savedSections(session.serverUrl, owner);
			sections = loadLayout(session.serverUrl, owner, board);
			if (board === 'player') recovery = await openPlayerDraft(session.serverUrl, owner, sections);
		} catch {
			error = 'Could not load this layout.';
		}
	}
	function persist(items: Section[], custom?: FilterSection[]) {
		saveLayout(
			session.serverUrl,
			owner,
			board,
			items,
			custom ? { before: filters, after: custom } : undefined
		);
	}
	function save(items: Section[], custom?: FilterSection[], pages?: CollectionEdits) {
		if (pages) saveCollectionEdits(listener, pages, () => persist(items, custom));
		else persist(items, custom);
		onback();
	}
	onMount(() => {
		void read();
	});
</script>

{#if error}<p role="alert">{error}</p>
	<button class="text-button" onclick={read}>{uiText('Try again')}</button><button
		class="text-button"
		onclick={onback}>{uiText('Back')}</button
	>
{:else if board === 'player' && recovery}
	<PlayerComposer {recovery} {onback} onsave={persist} />
{:else if board !== 'player' && owner}
	<LayoutEditor {board} session={listener} {sections} {filters} {onback} onsave={save} />
{:else}<p role="status">{uiText('Loading layout…')}</p>{/if}
