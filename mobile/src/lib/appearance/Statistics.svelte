<script lang="ts">
	import { onMount } from 'svelte';
	import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
	import { getJson, type Session } from '../connection';
	import { errorMessage, path } from '../catalog/catalog';
	type S = components['schemas'];
	let { session, diagnostics = false }: { session: Session; diagnostics?: boolean } = $props();
	let library = $state<S['StatsView']>(),
		workers = $state<S['QueueStatsResponse']>(),
		providers = $state<S['ProviderStatsResponse']>();
	let busy = $state(false),
		error = $state('');
	async function load() {
		busy = true;
		error = '';
		try {
			if (diagnostics) {
				[workers, providers] = await Promise.all([
					getJson<S['QueueStatsResponse']>(session, path('/api/v3/admin/queue-stats')),
					getJson<S['ProviderStatsResponse']>(session, path('/api/v3/admin/provider-stats'))
				]);
			} else library = await getJson<S['StatsView']>(session, path('/api/v3/library/stats'));
		} catch (e) {
			error = errorMessage(e);
		} finally {
			busy = false;
		}
	}
	onMount(() => {
		void load();
	});
</script>

<button class="secondary" onclick={load} disabled={busy}>Refresh statistics</button>
{#if busy}<p role="status">Loading statistics…</p>{/if}
{#if error}<p role="alert">{error}</p>{/if}
{#if library}
	<h2>Collection</h2>
	<dl>
		<dt>Artists</dt>
		<dd>{library.total_artists.toLocaleString()}</dd>
		<dt>Albums</dt>
		<dd>{library.total_albums.toLocaleString()}</dd>
		<dt>Songs</dt>
		<dd>{library.total_tracks.toLocaleString()}</dd>
		<dt>Audio storage</dt>
		<dd>
			{(library.total_size_bytes / 1024 ** 3).toLocaleString(undefined, {
				maximumFractionDigits: 2
			})} GiB
		</dd>
	</dl>
	<h2>Your favorites</h2>
	<p>
		{library.favorite_artists} artists · {library.favorite_albums} albums · {library.favorite_tracks}
		songs
	</p>
	<h2>Formats</h2>
	<dl>
		{#each Object.entries(library.format_breakdown) as [format, count] (format)}<dt>{format}</dt>
			<dd>{count.toLocaleString()}</dd>{:else}<dt>No audio formats reported.</dt>{/each}
	</dl>
{:else if workers && providers}
	<h2>Work queues</h2>
	{#each workers.queues as queue (queue.kind)}<article>
			<strong>{queue.kind}</strong>
			<p>{queue.queued} queued · {queue.running} running · {queue.failed} failed</p>
		</article>{:else}<p>No queued, running or failed jobs.</p>{/each}
	<h2>Background jobs</h2>
	{#each workers.jobs as job (job.name)}<article>
			<strong>{job.name}</strong>
			<p>
				{job.state}{#if job.last_heartbeat_at}
					· {new Date(job.last_heartbeat_at).toLocaleString()}{/if}
			</p>
			{#if job.last_error}<p>{job.last_error}</p>{/if}
		</article>{:else}<p>No background jobs reported.</p>{/each}
	<h2>Provider calls</h2>
	{#each providers.calls as row (JSON.stringify([row.source, row.priority, row.outcome]))}<article>
			<strong>{row.source}</strong>
			<p>
				{row.priority} · {row.outcome} · {row.calls.toLocaleString()} calls · {row.calls_last_minute}
				in the last minute
			</p>
		</article>{:else}<p>No provider calls recorded.</p>{/each}
	<h2>Rate limits</h2>
	{#each providers.limiters as row (row.source)}<article>
			<strong>{row.source}</strong>
			<p>{row.remaining} of {row.burst} tokens available · {row.per_second} per second</p>
		</article>{:else}<p>No rate limits reported.</p>{/each}
{/if}

<style>
	dl {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.5rem;
	}
	dd {
		margin: 0;
		font-variant-numeric: tabular-nums;
	}
	article {
		border-bottom: 1px solid var(--line);
		padding: 0.7rem 0;
		overflow-wrap: anywhere;
	}
	article p {
		color: var(--muted);
		margin: 0.25rem 0;
	}
</style>
