import type { SlideDocument } from "./types";

const MAX_STATES = 50;

function deepClone<T>(obj: T): T {
	return JSON.parse(JSON.stringify(obj));
}

export class SlideHistory {
	private past: SlideDocument[] = [];
	private present: SlideDocument;
	private future: SlideDocument[] = [];

	constructor(initial: SlideDocument) {
		this.present = deepClone(initial);
	}

	push(state: SlideDocument): void {
		this.past.push(deepClone(this.present));
		if (this.past.length > MAX_STATES) {
			this.past.shift();
		}
		this.present = deepClone(state);
		this.future = [];
	}

	undo(): SlideDocument | null {
		if (this.past.length === 0) return null;
		this.future.push(deepClone(this.present));
		this.present = this.past.pop()!;
		return deepClone(this.present);
	}

	redo(): SlideDocument | null {
		if (this.future.length === 0) return null;
		this.past.push(deepClone(this.present));
		this.present = this.future.pop()!;
		return deepClone(this.present);
	}

	get canUndo(): boolean {
		return this.past.length > 0;
	}

	get canRedo(): boolean {
		return this.future.length > 0;
	}

	get current(): SlideDocument {
		return deepClone(this.present);
	}

	clear(): void {
		this.past = [];
		this.future = [];
	}
}

export function createHistory(initial: SlideDocument): SlideHistory {
	return new SlideHistory(initial);
}
