<script lang="ts">
	import {
		ArrowDownToLine,
		CircleAlert,
		CircleCheck,
		Clock3,
		Eye,
		Minus,
		Search,
		TimerReset
	} from '@lucide/svelte';

	let { state, label }: { state: string; label: string } = $props();
	function cue(state: string) {
		switch (state) {
			case 'imported':
			case 'completed':
			case 'fulfilled':
				return { icon: CircleCheck, tone: 'success' };
			case 'failed':
			case 'rejected':
				return { icon: CircleAlert, tone: 'error' };
			case 'incomplete':
			case 'partial':
			case 'awaiting_approval':
			case 'awaiting_review':
			case 'held_for_review':
			case 'request_quota_full':
			case 'storage_full':
			case 'no_download_source':
				return { icon: CircleAlert, tone: 'warning' };
			case 'processing':
			case 'importing':
			case 'downloading':
				return { icon: ArrowDownToLine, tone: 'info' };
			case 'watching':
				return { icon: Eye, tone: 'info' };
			case 'searching':
				return { icon: Search, tone: 'neutral' };
			case 'retrying':
				return { icon: TimerReset, tone: 'warning' };
			case 'stopped':
			case 'cancelled':
			case 'cancelling':
				return { icon: Minus, tone: 'neutral' };
			default:
				return { icon: Clock3, tone: 'neutral' };
		}
	}
	const status = $derived(cue(state));
</script>

<span class="status" data-tone={status.tone}>
	<status.icon size={14} aria-hidden="true" />{label}
</span>

<style>
	.status {
		--status-color: var(--muted);
		display: inline-flex;
		align-items: center;
		gap: 0.3em;
		max-width: 100%;
		padding: 0.17em 0.55em;
		border-radius: 1em;
		font-size: 0.78rem;
		font-weight: 600;
		line-height: 1.35;
		color: var(--text);
		background: color-mix(in srgb, var(--status-color) 14%, var(--surface));
		overflow-wrap: anywhere;
	}
	.status :global(svg) {
		color: color-mix(in srgb, var(--status-color) 75%, var(--text));
	}
	[data-tone='success'] {
		--status-color: var(--color-success);
	}
	[data-tone='warning'] {
		--status-color: var(--color-warning);
	}
	[data-tone='error'] {
		--status-color: var(--color-error);
	}
	[data-tone='info'] {
		--status-color: var(--color-info);
	}
</style>
