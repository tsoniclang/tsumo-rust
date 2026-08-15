import type { int32 } from "@tsonic/core/types.js";
import { TextBuilderState } from "@tsonic/rust/crates/tsumo_platform/index.js";

export class TextBuilder {
  #state: TextBuilderState;

  constructor() {
    this.#state = new TextBuilderState();
  }

  get length(): int32 {
    return this.#state.length();
  }

  append(text: string): void {
    this.#state.append(text);
  }

  toString(): string {
    return this.#state.to_string();
  }
}
