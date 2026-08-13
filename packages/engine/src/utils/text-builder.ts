import type { int32 as int } from "@tsonic/core/types.js";

export class TextBuilder {
  private value: string;

  constructor() {
    this.value = "";
  }

  get length(): int {
    return this.value.length;
  }

  append(text: string): void {
    this.value += text;
  }

  toString(): string {
    return this.value;
  }
}
