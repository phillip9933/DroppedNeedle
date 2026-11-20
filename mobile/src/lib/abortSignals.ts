// Some phone WebViews support request deadlines but lack AbortSignal.any().
export function combineSignals(...sources: AbortSignal[]): AbortSignal {
	if (typeof AbortSignal.any === 'function') return AbortSignal.any(sources);

	const controller = new AbortController();
	function forward(this: AbortSignal) {
		for (const source of sources) source.removeEventListener('abort', forward);
		controller.abort(this.reason);
	}
	const stopped = sources.find((source) => source.aborted);
	if (stopped) controller.abort(stopped.reason);
	else for (const source of sources) source.addEventListener('abort', forward, { once: true });
	return controller.signal;
}
