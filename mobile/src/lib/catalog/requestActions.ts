import type { components } from '../../../../frontend/src/lib/api/v3/openapi';
import { getJson, mutateJson, postJson, type Session } from '../connection';
import { path, type RequestItem } from './catalog';

type Schema = components['schemas'];
export type Viewer = Pick<Schema['ProfileResponse'], 'id' | 'role'>;
export type Download = Schema['DownloadTaskResponse'];
export type Action = { label: string; effect: string; run: () => Promise<string> };

export function requestViewer(session: Session) {
	return getJson<Viewer>(session, path('/api/v3/me'));
}

export function approvals(session: Session) {
	return getJson<Schema['ActiveRequestsResponse']>(session, path('/api/v3/requests/approvals'));
}

export function taskPage(session: Session, page: number) {
	return getJson<Schema['DownloadListResponse']>(
		session,
		path('/api/v3/downloads/tasks', {}, { page, page_size: 30 })
	);
}

export function requestActions(
	session: Session,
	viewer: Viewer | null,
	row: RequestItem,
	reviewing: boolean
): Action[] {
	if (!viewer?.id) return [];
	const params = { musicbrainz_id: row.musicbrainz_id },
		query = { kind: row.request_kind };
	const approvePath = '/api/v3/requests/approvals/{musicbrainz_id}/approve';
	const rejectPath = '/api/v3/requests/approvals/{musicbrainz_id}/reject';
	const cancelPath = '/api/v3/requests/active/{musicbrainz_id}';
	const retryPath = '/api/v3/requests/retry/{musicbrainz_id}';
	function action(
		label: string,
		effect: string,
		endpoint: typeof approvePath | typeof rejectPath | typeof cancelPath | typeof retryPath
	): Action {
		return {
			label,
			effect,
			async run() {
				const url = path(endpoint, params, query);
				const answer =
					endpoint === cancelPath
						? await mutateJson<Schema['ActionResponse']>(session, url, 'DELETE')
						: await postJson<Schema['ActionResponse']>(session, url);
				if (!answer.success)
					throw new Error(
						answer.message || 'The request changed. Refresh to see its current status.'
					);
				return answer.message;
			}
		};
	}
	if (reviewing) {
		if (viewer.role !== 'admin' || row.status !== 'awaiting_approval') return [];
		return [
			action('Approve request', 'Allow DN to start this request.', approvePath),
			action('Reject request', 'Decline this request for its listeners.', rejectPath)
		];
	}
	// DN already filters ordinary listeners' lists to their own and co-requested rows.
	if (
		['pending', 'queued', 'downloading', 'awaiting_approval'].includes(row.status) &&
		row.task_state !== 'importing'
	) {
		const shared = viewer.role !== 'admin' && row.user_id !== viewer.id;
		return [
			action(
				shared ? 'Withdraw request' : 'Cancel request',
				shared
					? 'Remove your request. Other listeners keep theirs.'
					: 'Ask DN to stop this request.',
				cancelPath
			)
		];
	}
	if (['failed', 'cancelled', 'incomplete'].includes(row.status))
		return [
			action(
				'Retry request',
				'Submit this request again using the server’s approval rules.',
				retryPath
			)
		];
	return [];
}

export function taskStatus(task: Download) {
	if (task.held_for_review) return 'Held for review';
	if (task.remote_queued && task.status === 'downloading') return 'Waiting for a source';
	if (task.status === 'queued' && !task.search_job_id) return 'Searching';
	if (task.status === 'queued' && task.candidate_index == null) return 'Awaiting review';
	return task.status.charAt(0).toUpperCase() + task.status.slice(1);
}

export function taskActions(
	session: Session,
	viewer: Viewer | null,
	task: Download,
	openSearch: (jobId: string) => void,
	existingJob?: string
): Action[] {
	if (
		!viewer?.id ||
		(viewer.role !== 'admin' && task.user_id !== viewer.id) ||
		task.held_for_review
	)
		return [];
	const params = { task_id: task.id };
	const candidate = task.candidate_index;
	const cancel = () =>
		postJson<Schema['DownloadActionResponse']>(
			session,
			path('/api/v3/downloads/tasks/{task_id}/cancel', params)
		);
	const choices: Action[] = [];
	function action(
		label: string,
		effect: string,
		success: string,
		perform: () => Promise<{ success: boolean }>
	): Action {
		return {
			label,
			effect,
			async run() {
				if (!(await perform()).success)
					throw new Error(
						'DN could not complete this action. Refresh to see the current download status.'
					);
				return success;
			}
		};
	}
	if (
		task.status === 'downloading' ||
		(task.status === 'queued' && (!task.search_job_id || candidate != null))
	)
		choices.push(
			action(
				'Cancel download',
				'Stop this transfer and its wanted watch.',
				'Download cancelled.',
				cancel
			)
		);
	if (['failed', 'partial', 'cancelled'].includes(task.status)) {
		choices.push(
			action('Retry download', 'Ask DN to retry this download.', 'Download retry requested.', () =>
				postJson<Schema['RetryDownloadResponse']>(
					session,
					path('/api/v3/downloads/tasks/{task_id}/retry', params)
				)
			)
		);
		if (task.download_type !== 'track' && task.release_group_mbid) {
			choices.push({
				label: existingJob ? 'Review manual search' : 'Search manually',
				effect: existingJob
					? 'Return to this album’s search results.'
					: 'Search this album’s sources again and choose a match.',
				async run() {
					if (existingJob) {
						openSearch(existingJob);
						return '';
					}
					const result = await postJson<Schema['SearchAlbumResponse']>(
						session,
						path('/api/v3/downloads/search/album'),
						{
							artist_name: task.artist_name,
							album_title: task.album_title,
							release_group_mbid: task.release_group_mbid,
							release_mbid: task.release_mbid,
							year: task.year
						} satisfies Schema['SearchAlbumRequest']
					);
					if (result.status === 'already_in_library')
						return 'This album is already in your library.';
					if (!result.job_id) throw new Error('DN did not return a search to review.');
					openSearch(result.job_id);
					return '';
				}
			});
		}
		if (task.next_retry_at != null && task.status !== 'cancelled')
			choices.push(
				action(
					'Stop automatic retries',
					'Cancel scheduled retries and the wanted watch for this download.',
					'Automatic retries stopped.',
					cancel
				)
			);
	}
	if (
		task.status === 'downloading' &&
		task.remote_queued &&
		task.has_next_source &&
		candidate != null &&
		task.downloaded_bytes === 0 &&
		task.source === 'soulseek'
	)
		choices.push(
			action(
				'Try next source',
				'Leave the current source queue and try the next match.',
				'DN switched to the next source.',
				() =>
					postJson<Schema['NextSourceResponse']>(
						session,
						path('/api/v3/downloads/tasks/{task_id}/next-source', params),
						{ expected_candidate_index: candidate } satisfies Schema['NextSourceRequest']
					)
			)
		);
	if (
		viewer.role === 'admin' &&
		['failed', 'partial'].includes(task.status) &&
		task.search_job_id &&
		candidate != null &&
		(task.source === 'usenet' || task.source_username)
	)
		choices.push(
			action(
				'Retry import',
				'Check the downloaded files again and import matching tracks.',
				'DN retried the import.',
				() =>
					postJson<Schema['ReimportResponse']>(
						session,
						path('/api/v3/downloads/tasks/{task_id}/reimport', params)
					)
			)
		);
	return choices;
}

export type SearchCandidate = Schema['SearchCandidateView'];

export function getSearchJob(session: Session, jobId: string) {
	return getJson<Schema['SearchJobResponse']>(
		session,
		path('/api/v3/downloads/search/{job_id}', { job_id: jobId })
	);
}

export function chooseCandidate(session: Session, jobId: string, candidate: SearchCandidate) {
	return postJson<Schema['PickResponse']>(
		session,
		path('/api/v3/downloads/search/{job_id}/pick', { job_id: jobId }),
		{
			candidate_index: candidate.candidate_index,
			confirm_policy_break: !!candidate.refusal?.length
		} satisfies Schema['PickRequest']
	);
}

export function closeSearch(session: Session, jobId: string, watch: boolean) {
	const endpoint = watch
		? '/api/v3/downloads/search/{job_id}/dismiss'
		: '/api/v3/downloads/search/{job_id}/cancel';
	return postJson<Schema['DownloadActionResponse']>(session, path(endpoint, { job_id: jobId }));
}
