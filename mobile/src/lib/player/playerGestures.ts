import {
	bindVerticalDrag,
	type PullDirection,
	type VerticalDragOptions
} from '../controls/verticalDrag';

export type { PullDirection, PullOrigin } from '../controls/verticalDrag';
export type PlayerGestureActions = {
	up?: () => void;
	down?: () => void;
	canStart?: VerticalDragOptions['canStart'];
	start?: VerticalDragOptions['start'];
	catchOnStart?: VerticalDragOptions['catchOnStart'];
	move?: VerticalDragOptions['move'];
	travel?: VerticalDragOptions['travel'];
	release?: (direction: PullDirection, committed: boolean, action: () => void) => void;
};

const reserved =
	'input,select,textarea,dialog,[contenteditable=true],[role=slider],[data-inline-choice],[data-layout-drag],[data-reorder-grip],[data-selection-group].choosing';
export function playerGestures(node: HTMLElement, actions: PlayerGestureActions | undefined) {
	let current: { actions: PlayerGestureActions; navigate: () => void } | undefined;
	const drag = bindVerticalDrag(node, {
		canStart(target, direction, origin) {
			if (!actions || target.closest(reserved)) return false;
			const scroller = target.closest<HTMLElement>('[data-gesture-scroll]');
			if (scroller && (!scroller.hasAttribute('data-pull-dismiss') || scroller.scrollTop > 1))
				return false;
			const allowed = actions.canStart?.(target, direction, origin) ?? true;
			if (!allowed) return false;
			const logical = allowed === true ? direction : allowed;
			return actions[logical] && (!scroller || logical === 'down') ? logical : false;
		},
		catchOnStart: () => actions?.catchOnStart?.() ?? false,
		start(direction, target, origin) {
			const navigate = actions?.[direction];
			if (!navigate || !actions) return false;
			const offset = actions.start?.(direction, target, origin);
			if (offset !== false) current = { actions, navigate };
			return offset;
		},
		travel: (direction) => actions?.travel?.(direction) ?? node.getBoundingClientRect().height,
		move: (direction, distance) => current?.actions.move?.(direction, distance),
		release(direction, committed) {
			const gesture = current;
			current = undefined;
			if (gesture?.actions.release) gesture.actions.release(direction, committed, gesture.navigate);
			else if (committed) gesture?.navigate();
		}
	});
	return {
		update(next: PlayerGestureActions | undefined) {
			// Playback polling can replace callback objects while the same screen is under the finger.
			if (!next || !!next.up !== !!actions?.up || !!next.down !== !!actions?.down) drag.cancel();
			actions = next;
		},
		destroy: drag.destroy
	};
}
