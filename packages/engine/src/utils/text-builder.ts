import type { int32 } from "@tsonic/core/types.js";

export class TextBuilder {
  #value: string;

  constructor() {
    this.#value = "";
  }

  get length(): int32 {
    return this.#value.length;
  }

  append(text: string): void {
    this.#value += text;
  }

  toString(): string {
    return this.#value;
  }
}
