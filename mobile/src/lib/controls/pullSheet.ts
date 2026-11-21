import { motionDuration } from '../appearance/interface';
import { bindVerticalDrag } from './verticalDrag';

/** The dialog stays modal until the drag finishes and its owner handles Back. */
export function pullSheet(
	sheet: HTMLDialogElement,
	{ enabled, dismiss }: { enabled: () => boolean; dismiss: () => void }
) {
	let span = 1;
	let revision = 0;
	let settling = false;
	let closing = false;
	let disposed = false;

	function measure() {
		span = Math.max(1, sheet.getBoundingClientRect().height);
		return span;
	}
	function paint(progress: number) {
		sheet.style.setProperty('--sheet-progress', String(Math.min(1, Math.max(0, progress))));
	}
	function renderedOffset() {
		const transform = getComputedStyle(sheet).transform;
		return transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42;
	}
	function hold() {
		const progress = renderedOffset() / measure();
		revision++;
		settling = false;
		sheet.style.removeProperty('--sheet-duration');
		paint(progress);
		return progress;
	}
	function settle(to: 0 | 1, then?: () => void) {
		const from = hold();
		const ticket = revision;
		const ms = Math.round(motionDuration() * Math.sqrt(Math.min(1, Math.abs(to - from))));
		if (ms && Math.abs(to - from) * span > 1) {
			// Commit the exact held frame before handing the rest of the trip to the compositor.
			sheet.getBoundingClientRect();
			sheet.style.setProperty('--sheet-duration', ms + 'ms');
			paint(to);
			const move = sheet
				.getAnimations()
				.find((a) => 'transitionProperty' in a && a.transitionProperty === 'transform');
			if (move) {
				settling = true;
				const finish = () => {
					if (revision !== ticket) return;
					settling = false;
					sheet.style.removeProperty('--sheet-duration');
					then?.();
				};
				void move.finished.then(finish, finish);
				return;
			}
		}
		sheet.style.removeProperty('--sheet-duration');
		paint(to);
		then?.();
	}
	function close() {
		if (disposed || closing || !enabled()) return;
		closing = true;
		drag.cancel();
		settle(1, () => {
			if (enabled()) dismiss();
			closing = false;
			// A review can return to its parent in this same dialog. Its header and scroll
			// targets must be at rest as soon as the new step appears.
			paint(0);
		});
	}
	const drag = bindVerticalDrag(sheet, {
		catchOnStart: () => settling,
		canStart(target, direction, origin) {
			if (!enabled() || target.closest('dialog') !== sheet) return false;
			if (target === sheet) {
				const r = sheet.getBoundingClientRect();
				if (origin.y < r.top || origin.y > r.bottom || origin.x < r.left || origin.x > r.right)
					return false;
			}
			if (
				target.closest(
					'input,select,textarea,audio,video,[data-inline-choice],[contenteditable=true],[role=slider],[data-reorder-grip]'
				)
			)
				return false;
			if (direction === 'up' && (!settling || renderedOffset() < 1)) return false;
			if (!settling) {
				for (let el: Element | null = target; el && el !== sheet; el = el.parentElement)
					if (el.scrollTop > 1) return false;
			}
			return 'down';
		},
		travel: measure,
		start() {
			closing = false;
			return hold() * span;
		},
		move(_, distance) {
			paint(distance / span);
		},
		release(_, committed) {
			if (closing || disposed) return;
			if (committed && enabled()) close();
			else settle(0);
		}
	});
	function ignoreClosingClick(event: MouseEvent) {
		if (!closing) return;
		event.preventDefault();
		event.stopImmediatePropagation();
	}
	sheet.addEventListener('click', ignoreClosingClick, true);
	paint(1);
	settle(0);
	return {
		close,
		reset() {
			drag.cancel();
			closing = false;
			settle(0);
		},
		destroy() {
			disposed = true;
			revision++;
			drag.destroy();
			sheet.removeEventListener('click', ignoreClosingClick, true);
			sheet.style.removeProperty('--sheet-duration');
			sheet.style.removeProperty('--sheet-progress');
		}
	};
}
