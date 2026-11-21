<script lang="ts">
	import { uiText } from '../i18n';
	import { Clock3, Search } from '@lucide/svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
	import { accountId } from '../boards/layout';
	import { getJson, type Session } from '../connection';
	import { path, type SearchScope } from './catalog';
	import { deviceScopes, type DeviceSearchIndex } from './deviceSearch';
	import { foldSearchText } from './trackFilters';

	type Hint = { term: string; scope: SearchScope };
	const labels = {
		top: 'Top results',
		tracks: 'Songs',
		artists: 'Artists',
		albums: 'Albums',
		genres: 'Genres',
		playlists: 'Playlists'
	};
	const kinds = { track: 'tracks', artist: 'artists', album: 'albums' } as const;
	let {
		session,
		term,
		scope,
		editing,
		active,
		offline,
		model,
		onpick
	}: {
		session: Session;
		term: string;
		scope: SearchScope;
		editing: boolean;
		active: boolean;
		offline: boolean;
		model?: DeviceSearchIndex;
		onpick: (term: string, scope: SearchScope) => void;
	} = $props();
	let key = $state(''),
		recent = $state.raw<Hint[]>([]),
		suggestions = $state.raw<Hint[]>([]);
	const maxRecent = 12;
	function read(key: string): Hint[] {
		try {
			const saved: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
			return Array.isArray(saved)
				? saved
						.filter(
							(h): h is Hint =>
								h &&
								typeof h.term === 'string' &&
								h.term.trim().length >= 2 &&
								h.term.length <= 256 &&
								Object.hasOwn(labels, h.scope)
						)
						.slice(0, maxRecent)
				: [];
		} catch {
			return [];
		}
	}
	$effect(() => {
		const account = session;
		let live = true;
		key = '';
		recent = [];
		void accountId(account)
			.then((id) => {
				if (!live) return;
				const accountKey = 'dn.mobile.search.history.v1.' + JSON.stringify([account.serverUrl, id]);
				key = accountKey;
				recent = read(accountKey);
			})
			.catch(() => {
				/* Search remains available before account identification. */
			});
		return () => {
			live = false;
		};
	});
	function save(rows: Hint[]) {
		if (!key) return;
		recent = rows;
		try {
			if (rows.length) localStorage.setItem(key, JSON.stringify(rows));
			else localStorage.removeItem(key);
		} catch {
			/* Keep the current session's searches in memory. */
		}
	}
	export function remember(value = term, category = scope) {
		const clean = value.trim();
		if (clean.length < 2 || clean.length > 256 || !key) return;
		save(
			[
				{ term: clean, scope: category },
				...recent.filter(
					(h) => h.scope !== category || foldSearchText(h.term) !== foldSearchText(clean)
				)
			].slice(0, maxRecent)
		);
	}
	$effect(() => {
		const q = term.trim(),
			category = scope,
			local = offline,
			device = model,
			account = session;
		suggestions = [];
		if (
			!active ||
			!editing ||
			q.length < 2 ||
			(!local && (category === 'genres' || category === 'playlists'))
		)
			return;
		const controller = new AbortController();
		const timer = setTimeout(async () => {
			try {
				let list: Hint[];
				if (local) {
					if (!device) return;
					const buckets = await device.query(category, q);
					list = buckets.flatMap((b) => {
						const match = (Object.keys(deviceScopes) as (keyof typeof deviceScopes)[]).find(
							(k) => deviceScopes[k] === b.category
						)!;
						return b.items.slice(0, 5).map((row) => ({ term: row.title, scope: match }));
					});
				} else {
					const reply = await getJson<components['schemas']['SuggestResponse']>(
						account,
						path('/api/v3/search/suggest', {}, { q, limit: 8 }),
						controller.signal
					);
					list = reply.results.map((row) => ({ term: row.title, scope: kinds[row.kind] }));
				}
				if (controller.signal.aborted) return;
				const seen = new SvelteSet<string>();
				suggestions = list
					.filter((h) => {
						const id = h.scope + '/' + foldSearchText(h.term);
						if (!h.term || (category !== 'top' && h.scope !== category) || seen.has(id))
							return false;
						seen.add(id);
						return true;
					})
					.slice(0, 5);
			} catch {
				/* Full search handles errors and switching to the device library. */
			}
		}, 170);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	});
	const history = $derived(!term.trim());
	const shown = $derived(history ? recent : suggestions);
</script>

{#if shown.length}
	<section class="hints" aria-label={history ? uiText('Recent searches') : 'Search suggestions'}>
		<div class="heading">
			<h2>{history ? uiText('Recent searches') : uiText('Suggestions')}</h2>
			{#if history}<button class="text-button" onclick={() => save([])}
					>{uiText('Clear history')}</button
				>{/if}
		</div>
		{#each shown as hint (hint.scope + hint.term)}
			<button
				class="hint"
				aria-label={'Search for ' + hint.term + ' in ' + labels[hint.scope]}
				onclick={() => onpick(hint.term, hint.scope)}
			>
				{#if history}<Clock3 size={17} />{:else}<Search size={17} />{/if}
				<span>{hint.term}</span><small>{uiText(labels[hint.scope])}</small>
			</button>
		{/each}
	</section>
{/if}

<style>
	.hints {
		margin-bottom: 1rem;
	}
	.heading,
	.hint {
		display: flex;
		align-items: center;
		gap: 0.65rem;
	}
	.heading {
		justify-content: space-between;
	}
	h2 {
		font-size: 1rem;
		margin: 0.3rem 0;
	}
	.hint {
		width: 100%;
		padding: 0.45rem 0.2rem;
		min-height: 44px;
		background: transparent;
		color: var(--text);
		border: 0;
		border-bottom: 1px solid var(--line);
		text-align: start;
	}
	.hint span {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hint small,
	.hint :global(svg) {
		color: var(--muted);
	}
</style>
