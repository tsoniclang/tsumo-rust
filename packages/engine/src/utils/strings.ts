import type { int32 } from "@tsonic/core/types.js";
import { createTsumoError } from "../diagnostics.js";

function substringError(): void {
  throw createTsumoError("TSUMO_INTERNAL_STRING_RANGE_INVALID", "Substring bounds are out of range");
}

const requireSubstringBounds = (source: string, startIndex: int32, length: int32): void => {
  const sourceLength = source.length as int32;
  if (startIndex < 0 || length < 0 || startIndex > sourceLength || length > sourceLength - startIndex) {
    substringError();
  }
};

export const replaceText = (source: string, oldValue: string, newValue: string): string => {
  return source.replaceAll(oldValue, newValue);
};

export const indexOfText = (source: string, value: string): int32 => source.indexOf(value) as int32;

export const indexOfTextIgnoreCase = (source: string, value: string): int32 => {
  return source.toLowerCase().indexOf(value.toLowerCase()) as int32;
};

export const indexOfTextFrom = (source: string, value: string, startIndex: int32): int32 => {
  return source.indexOf(value, startIndex) as int32;
};

export const lastIndexOfText = (source: string, value: string): int32 => source.lastIndexOf(value) as int32;

export const containsText = (source: string, value: string): boolean => source.includes(value);

export const compareText = (left: string, right: string): int32 => {
  return left < right ? -1 : left > right ? 1 : 0;
};

export const substringFrom = (source: string, startIndex: int32): string => {
  if (startIndex < 0 || startIndex > (source.length as int32)) {
    substringError();
  }
  return source.substring(startIndex);
};

export const substringCount = (source: string, startIndex: int32, length: int32): string => {
  requireSubstringBounds(source, startIndex, length);
  return source.substring(startIndex, startIndex + length);
};

export const charAtText = (source: string, index: int32): string => {
  if (index < 0 || index >= (source.length as int32)) return "";
  return source.charAt(index);
};

export const codePointAtText = (source: string, index: int32): string => {
  const codePoint = source.codePointAt(index);
  return codePoint === undefined ? "" : String.fromCodePoint(codePoint);
};

export const nextCodePointIndex = (source: string, index: int32): int32 => {
  const codePoint = source.codePointAt(index);
  if (codePoint === undefined) return source.length as int32;
  const width = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  return (index + width) as int32;
};

export const codePointLength = (source: string): int32 => {
  const sourceLength = source.length as int32;
  let count: int32 = 0;
  let index: int32 = 0;
  while (index < sourceLength) {
    index = nextCodePointIndex(source, index);
    count++;
  }
  return count;
};

const nativeIndexAtCodePoint = (source: string, codePointIndex: int32): int32 => {
  if (codePointIndex < 0) substringError();
  const sourceLength = source.length as int32;
  let currentCodePoint: int32 = 0;
  let nativeIndex: int32 = 0;
  while (currentCodePoint < codePointIndex && nativeIndex < sourceLength) {
    nativeIndex = nextCodePointIndex(source, nativeIndex);
    currentCodePoint++;
  }
  if (currentCodePoint !== codePointIndex) substringError();
  return nativeIndex;
};

export const substringCodePoints = (source: string, startIndex: int32, length: int32): string => {
  if (startIndex < 0 || length < 0) substringError();
  const start = nativeIndexAtCodePoint(source, startIndex);
  const end = nativeIndexAtCodePoint(source, startIndex + length);
  return substringCount(source, start, end - start);
};

export const trimStartCodePoints = (source: string, cutset: string): string => {
  const sourceLength = source.length as int32;
  let start: int32 = 0;
  while (start < sourceLength) {
    const next = nextCodePointIndex(source, start);
    if (!cutset.includes(substringCount(source, start, next - start))) break;
    start = next;
  }
  return substringFrom(source, start);
};

export const trimEndCodePoints = (source: string, cutset: string): string => {
  const sourceLength = source.length as int32;
  let index: int32 = 0;
  let end: int32 = 0;
  while (index < sourceLength) {
    const next = nextCodePointIndex(source, index);
    if (!cutset.includes(substringCount(source, index, next - index))) end = next;
    index = next;
  }
  return substringCount(source, 0, end);
};

export const trimCodePoints = (source: string, cutset: string): string =>
  trimEndCodePoints(trimStartCodePoints(source, cutset), cutset);

const isUnicodeSpace = (value: number): boolean =>
  (value >= 0x09 && value <= 0x0d) ||
  value === 0x20 ||
  value === 0x85 ||
  value === 0xa0 ||
  value === 0x1680 ||
  (value >= 0x2000 && value <= 0x200a) ||
  value === 0x2028 ||
  value === 0x2029 ||
  value === 0x202f ||
  value === 0x205f ||
  value === 0x3000;

export const trimUnicodeSpace = (source: string): string => {
  const sourceLength = source.length as int32;
  let start: int32 = 0;
  while (start < sourceLength) {
    const codePoint = source.codePointAt(start);
    if (codePoint === undefined || !isUnicodeSpace(codePoint)) break;
    start = nextCodePointIndex(source, start);
  }
  let index: int32 = start;
  let end: int32 = start;
  while (index < sourceLength) {
    const codePoint = source.codePointAt(index);
    const next = nextCodePointIndex(source, index);
    if (codePoint !== undefined && !isUnicodeSpace(codePoint)) end = next;
    index = next;
  }
  return substringCount(source, start, end - start);
};

export function zeroPadInteger(value: int32, width: int32): string {
  let result = `${value}`;
  while ((result.length as int32) < width) result = `0${result}`;
  return result;
}

export const trimStartChar = (source: string, ch: string): string => {
  if (ch === "" || nextCodePointIndex(ch, 0) !== (ch.length as int32)) return source;
  let start = 0;
  while (start < source.length && source.startsWith(ch, start)) {
    start += ch.length;
  }
  return source.substring(start);
};

export const trimEndChar = (source: string, ch: string): string => {
  if (ch === "" || nextCodePointIndex(ch, 0) !== (ch.length as int32)) return source;
  let end = source.length;
  while (end > 0 && source.endsWith(ch, end)) {
    end -= ch.length;
  }
  return source.substring(0, end);
};

export const replaceLineEndings = (source: string, replacement: string): string => {
  const normalized = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  return replacement === "\n" ? normalized : normalized.replaceAll("\n", replacement);
};

export const splitLines = (source: string): string[] => replaceLineEndings(source, "\n").split("\n");
