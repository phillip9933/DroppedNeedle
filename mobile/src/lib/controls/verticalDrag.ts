export type PullDirection = 'up' | 'down';
export type PullOrigin = { x: number; y: number; pointerType: 'mouse' | 'pen' | 'touch' };
type Allowed = boolean | PullDirection;

export type VerticalDragOptions = {
	canStart: (target: Element, direction: PullDirection, origin: PullOrigin) => Allowed;
	catchOnStart?: () => boolean;
	start?: (direction: PullDirection, target: Element, origin: PullOrigin) => number | false | void;
	move: (direction: PullDirection, distance: number) => void;
	release: (direction: PullDirection, committed: boolean) => void;
	travel: (direction: PullDirection) => number;
};

type Contact = {
	source: 'touch' | 'pointer';
	id: number;
	target: Element;
	origin: PullOrigin;
	allowed: Record<PullDirection, Allowed>;
	samples: { y: number; time: number }[];
	direction?: PullDirection;
	offset: number;
	length: number;
	distance: number;
};

/** Claim one axis after a little movement. A scroll or horizontal gesture owns the rest of its stroke. */
export function bindVerticalDrag(node: HTMLElement, options: VerticalDragOptions) {
	const listeners = new AbortController();
	const passive = { passive: true, signal: listeners.signal };
	const active = { passive: false, signal: listeners.signal };
	let contact: Contact | undefined;
	let suppressClick = false;

	function finish(committed = false) {
		const last = contact;
		contact = undefined;
		if (!last?.direction) return;
		if (last.source === 'pointer' && node.hasPointerCapture(last.id))
			node.releasePointerCapture(last.id);
		options.release(last.direction, committed);
	}

	function claim(drag: Contact, physical: PullDirection) {
		const allowed = drag.allowed[physical] && options.canStart(drag.target, physical, drag.origin);
		if (!allowed) return false;
		const direction = allowed === true ? physical : allowed;
		const length = options.travel(direction);
		if (!(length > 0)) return false;
		const offset = options.start?.(direction, drag.target, drag.origin);
		if (offset === false) return false;
		drag.direction = direction;
		drag.length = length;
		drag.offset = offset ?? 0;
		drag.distance = drag.offset;
		suppressClick = true;
		return direction;
	}

	function begin(
		event: Event,
		source: Contact['source'],
		id: number,
		point: Pick<Touch, 'clientX' | 'clientY'>,
		pointerType: PullOrigin['pointerType']
	) {
		// Chromium sends pointerdown and then touchstart for the same finger. Keep a caught
		// panel frozen while switching to the touch stream used for native scroll arbitration.
		if (
			source === 'touch' &&
			contact?.source === 'pointer' &&
			contact.origin.pointerType === 'touch'
		) {
			if (event.defaultPrevented) return finish();
			contact.source = 'touch';
			contact.id = id;
			return;
		}
		finish();
		suppressClick = false;
		const target = event.target;
		if (event.defaultPrevented || !(target instanceof Element)) return;
		const origin = { x: point.clientX, y: point.clientY, pointerType };
		// Capture the scroll boundary at contact. Reaching it mid-scroll must not start another gesture.
		const allowed = {
			up: options.canStart(target, 'up', origin),
			down: options.canStart(target, 'down', origin)
		};
		if (!allowed.up && !allowed.down) return;
		contact = {
			source,
			id,
			target,
			origin,
			allowed,
			samples: [{ y: origin.y, time: event.timeStamp }],
			offset: 0,
			length: 0,
			distance: 0
		};
		if (options.catchOnStart?.() && claim(contact, allowed.down ? 'down' : 'up')) {
			if (source === 'pointer' && pointerType !== 'touch' && event.isTrusted && node.isConnected)
				node.setPointerCapture(id);
		}
	}

	function move(event: Event, x: number, y: number, ending = false) {
		const drag = contact;
		if (!drag) return;
		if (
			event.defaultPrevented ||
			(drag.source === 'touch' && !event.cancelable && (!ending || !drag.direction))
		)
			return finish();
		const dy = y - drag.origin.y;
		let direction = drag.direction;
		if (!direction) {
			const dx = Math.abs(x - drag.origin.x);
			if (Math.max(dx, Math.abs(dy)) < 7) return;
			if (Math.abs(dy) < dx * 1.18) return finish();
			const physical = dy < 0 ? 'up' : 'down';
			const claimed = claim(drag, physical);
			if (!claimed) return finish();
			direction = claimed;
			if (drag.source === 'pointer' && event.isTrusted && !ending && node.isConnected)
				node.setPointerCapture(drag.id);
		}
		if (event.cancelable) event.preventDefault();
		const sign = direction === 'down' ? 1 : -1;
		const distance = Math.max(0, Math.min(drag.length, drag.offset + dy * sign));
		const samples = drag.samples;
		const last = samples.at(-1)!;
		// Lift can arrive a display frame after the last movement. A held finger loses its momentum.
		const time =
			ending && last.y === y && event.timeStamp - last.time < 60 ? last.time : event.timeStamp;
		while (samples.length && samples[0].time < time - 110) samples.shift();
		samples.push({ y, time });
		if (distance !== drag.distance || samples.length === 1) {
			drag.distance = distance;
			options.move(direction, distance);
		}
		if (ending) {
			const recent = (y - samples[0].y) * sign;
			const speed = recent / Math.max(1, time - samples[0].time);
			const threshold = drag.length * 0.4;
			const projected = distance + speed * 200;
			const flick =
				distance >= 20 && recent >= 8 && speed >= 0.18 && projected >= Math.min(threshold, 110);
			const reversing = recent <= -12 && speed <= -0.25;
			finish(!reversing && (distance >= threshold || flick));
		}
	}

	// A touchmove can hand a vertical stroke to the WebView's native scroller. Pointer events alone
	// cannot make that choice after touch-action has been resolved at pointerdown.
	node.addEventListener(
		'touchstart',
		(e) => {
			if (e.touches.length !== 1) return finish();
			const point = e.touches[0];
			begin(e, 'touch', point.identifier, point, 'touch');
		},
		passive
	);
	node.addEventListener(
		'touchmove',
		(e) => {
			if (contact?.source !== 'touch') return;
			if (e.touches.length !== 1 || e.touches[0].identifier !== contact.id) return finish();
			move(e, e.touches[0].clientX, e.touches[0].clientY);
		},
		active
	);
	node.addEventListener(
		'touchend',
		(e) => {
			if (contact?.source !== 'touch') return;
			const point = e.changedTouches[0];
			if (!e.touches.length && point?.identifier === contact.id)
				move(e, point.clientX, point.clientY, true);
			finish();
		},
		active
	);
	node.addEventListener(
		'touchcancel',
		() => {
			if (contact?.source === 'touch') finish();
		},
		passive
	);

	node.addEventListener(
		'pointerdown',
		(e) => {
			if (!e.isPrimary) return finish();
			const type = e.pointerType === 'pen' || e.pointerType === 'touch' ? e.pointerType : 'mouse';
			if (e.button === 0) begin(e, 'pointer', e.pointerId, e, type);
		},
		passive
	);
	window.addEventListener(
		'pointermove',
		(e) => {
			if (contact?.source !== 'pointer' || e.pointerId !== contact.id) return;
			if (e.isTrusted && !e.buttons) return finish();
			move(e, e.clientX, e.clientY);
		},
		active
	);
	window.addEventListener(
		'pointerup',
		(e) => {
			if (contact?.source !== 'pointer' || e.pointerId !== contact.id) return;
			move(e, e.clientX, e.clientY, true);
			finish();
		},
		active
	);
	window.addEventListener(
		'pointercancel',
		(e) => {
			if (contact?.source === 'pointer' && e.pointerId === contact.id) finish();
		},
		passive
	);
	node.addEventListener(
		'lostpointercapture',
		(e) => {
			if (e.target === node && contact?.source === 'pointer' && e.pointerId === contact.id)
				finish();
		},
		passive
	);
	node.addEventListener(
		'dragstart',
		(e) => {
			if (contact) e.preventDefault();
		},
		active
	);
	node.addEventListener(
		'click',
		(e) => {
			if (!suppressClick || !e.detail) return;
			suppressClick = false;
			e.preventDefault();
			e.stopImmediatePropagation();
		},
		{ capture: true, signal: listeners.signal }
	);
	window.addEventListener('blur', () => finish(), passive);
	document.addEventListener(
		'visibilitychange',
		() => {
			if (document.hidden) finish();
		},
		passive
	);
	return {
		cancel: () => finish(),
		destroy() {
			listeners.abort();
			finish();
		}
	};
}
