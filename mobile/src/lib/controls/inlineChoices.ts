type Dismiss = (restoreFocus?: boolean) => void;
let active: Dismiss | undefined;

export function openChoice(dismiss: Dismiss) {
	active?.();
	active = dismiss;
}

export function releaseChoice(dismiss: Dismiss) {
	if (active === dismiss) active = undefined;
}

/** An open list gets Back and Escape before its containing dialog or screen. */
export function installChoiceDismissal() {
	function close(event: Event) {
		if (!active) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		active(true);
	}
	window.addEventListener('dn-back', close, true);
	window.addEventListener(
		'keydown',
		(event) => {
			if (event.key === 'Escape') close(event);
		},
		true
	);
}
