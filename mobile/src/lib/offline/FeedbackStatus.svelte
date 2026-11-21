<script lang="ts">
	import { uiText } from '../i18n';
	import type { Session } from '../connection';
	import { preferredOffline } from './media';
	import { retryTrackFeedback } from './feedback';
	import {
		feedbackChanged,
		feedbackRows,
		feedbackScope,
		trackFeedback,
		type FeedbackField
	} from './feedbackStore';
	let { session, id, field }: { session: Session; id?: string; field?: FeedbackField } = $props();
	let count = $state(0),
		blocked = $state(false),
		canSend = $state(false),
		busy = $state(false);
	$effect(() => {
		const account = session,
			scope = feedbackScope(account),
			track = id,
			kind = field;
		let live = true,
			version = 0;
		async function refresh() {
			const requested = ++version;
			try {
				const rows = track ? await trackFeedback(scope, track) : await feedbackRows(scope);
				const waiting = rows.filter((r) => r.state !== 'confirmed' && (!kind || r.field === kind));
				const online = navigator.onLine && !(await preferredOffline(account).catch(() => true));
				if (!live || requested !== version) return;
				count = waiting.length;
				blocked = waiting.some((r) => r.state === 'blocked');
				canSend = online;
			} catch {
				if (live && requested === version) count = 0;
			}
		}
		void refresh();
		const events = [feedbackChanged, 'dn-offline-policy', 'online', 'offline'];
		for (const e of events) window.addEventListener(e, refresh);
		return () => {
			live = false;
			for (const e of events) window.removeEventListener(e, refresh);
		};
	});
	async function retry() {
		busy = true;
		try {
			await retryTrackFeedback(session);
		} finally {
			busy = false;
		}
	}
</script>

{#if count}
	<div class="sync">
		<span role="status"
			>{blocked
				? uiText('DN could not apply your track changes.')
				: count === 1
					? uiText('1 track change waiting to sync.')
					: count + ' track changes waiting to sync.'}</span
		>
		{#if canSend}<button class="text-button" disabled={busy} onclick={retry}
				>{uiText('Retry sync')}</button
			>{/if}
	</div>
{/if}

<style>
	.sync {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		color: var(--muted);
		font-size: 0.85rem;
	}
</style>
