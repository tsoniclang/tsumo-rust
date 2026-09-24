import type { int32, nativeUint } from "@tsonic/core/types.js";
import { createTsumoError } from "../diagnostics.js";
import { nextCodePointIndex } from "./strings.js";

export const findRegularExpressionMatches = (
  pattern: string,
  input: string,
  limit: int32,
): string[] => {
  const expression = compileRegularExpression(pattern);
  if (limit === 0) return [];
  const maximum: nativeUint = limit > 0 ? limit as nativeUint : 0;
  const result: string[] = [];
  for (const match of input.matchAll(expression)) {
    result.push(requireFullMatch(match));
    if (maximum > 0 && result.length >= maximum) break;
  }
  return result;
};

export const findRegularExpressionSubmatches = (
  pattern: string,
  input: string,
  limit: int32,
): string[][] => {
  const expression = compileRegularExpression(pattern);
  if (limit === 0) return [];
  const maximum: nativeUint = limit > 0 ? limit as nativeUint : 0;
  const result: string[][] = [];
  for (const match of input.matchAll(expression)) {
    const row: string[] = [requireFullMatch(match)];
    for (let groupIndex = 1; groupIndex < match.length; groupIndex++) {
      row.push(match[groupIndex] ?? "");
    }
    result.push(row);
    if (maximum > 0 && result.length >= maximum) break;
  }
  return result;
};

export const replaceRegularExpression = (
  pattern: string,
  replacement: string,
  input: string,
  limit: int32,
): string => {
  const expression = compileRegularExpression(pattern);
  if (limit === 0) return input;
  if (limit < 0) return input.replace(expression, replacement);

  const result: string[] = [];
  let cursor: nativeUint = 0;
  let remaining: int32 = limit;
  for (const match of input.matchAll(expression)) {
    if (remaining === 0) break;
    const matchIndex = match.index as nativeUint;
    const fullMatch = requireFullMatch(match);
    result.push(input.slice(cursor, matchIndex));
    result.push(expandRegularExpressionReplacement(
      replacement,
      input,
      match,
      fullMatch,
      matchIndex,
    ));
    cursor = matchIndex + fullMatch.length;
    remaining--;
  }
  result.push(input.slice(cursor));
  return result.join("");
};

const compileRegularExpression = (pattern: string): RegExp => {
  try {
    return new RegExp(pattern, "g");
  } catch {
    throw createTsumoError(
      "TSUMO_TEMPLATE_REGEXP_INVALID",
      `Invalid regular expression '${pattern}'`,
    );
  }
};

const expandRegularExpressionReplacement = (
  replacement: string,
  input: string,
  match: RegExpExecArray,
  fullMatch: string,
  matchIndex: nativeUint,
): string => {
  const result: string[] = [];
  const replacementLength = replacement.length as int32;
  for (let index: int32 = 0; index < replacementLength; index = nextCodePointIndex(replacement, index)) {
    const current = replacement.charAt(index);
    if (current !== "$" || index + 1 >= replacementLength) {
      result.push(current);
      continue;
    }
    const next = replacement.charAt(index + 1);
    if (next === "$") {
      result.push("$");
      index++;
      continue;
    }
    if (next === "&") {
      result.push(fullMatch);
      index++;
      continue;
    }
    if (next === "`") {
      result.push(input.slice(0, matchIndex));
      index++;
      continue;
    }
    if (next === "'") {
      result.push(input.slice(matchIndex + fullMatch.length));
      index++;
      continue;
    }
    if (next === "<" && match.groups !== undefined) {
      const closing = replacement.indexOf(">", index + 2);
      if (closing >= 0) {
        const groupName = replacement.slice(index + 2, closing);
        result.push(regularExpressionNamedGroup(match, groupName));
        index = closing as int32;
        continue;
      }
    }
    const firstDigit = digitValue(next);
    if (firstDigit >= 0) {
      let captureIndex: int32 = -1;
      let consumedDigits: int32 = 0;
      if (index + 2 < replacementLength) {
        const secondDigit = digitValue(replacement.charAt(index + 2));
        const twoDigitIndex: int32 = firstDigit * 10 + secondDigit;
        if (
          secondDigit >= 0 &&
          twoDigitIndex > 0 &&
          (twoDigitIndex as nativeUint) < match.length
        ) {
          captureIndex = twoDigitIndex;
          consumedDigits = 2;
        }
      }
      if (captureIndex < 0 && firstDigit > 0 && (firstDigit as nativeUint) < match.length) {
        captureIndex = firstDigit;
        consumedDigits = 1;
      }
      if (captureIndex > 0) {
        result.push(match[captureIndex] ?? "");
        index += consumedDigits;
        continue;
      }
    }
    result.push("$");
  }
  return result.join("");
};

const regularExpressionNamedGroup = (
  match: RegExpExecArray,
  groupName: string,
): string => match.groups?.[groupName] ?? "";

const requireFullMatch = (match: RegExpExecArray): string => {
  const fullMatch: string | undefined = match[0];
  if (fullMatch === undefined) {
    throw createTsumoError(
      "TSUMO_TEMPLATE_REGEXP_RESULT_INVALID",
      "Regular expression execution returned no full match",
    );
  }
  return fullMatch;
};

const digitValue = (value: string): int32 => {
  if (value.length !== 1) return -1;
  const code = value.charCodeAt(0) as int32;
  return code >= 48 && code <= 57 ? code - 48 : -1;
};
