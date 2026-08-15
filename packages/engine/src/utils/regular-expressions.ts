import type { int32 } from "@tsonic/core/types.js";
import {
  find_regex_matches,
  find_regex_submatches,
  replace_regex_limited,
} from "@tsonic/rust/crates/tsumo_platform/index.js";

export const findRegularExpressionMatches = (
  pattern: string,
  input: string,
  limit: int32,
): string[] => {
  const matches = find_regex_matches(pattern, input, limit);
  const result: string[] = [];
  while (!matches.is_empty()) {
    const optionalMatch = matches.pop();
    if (optionalMatch === undefined) throw new Error("Rust regex match vector violated its non-empty contract");
    const match: string = optionalMatch;
    result.unshift(match);
  }
  return result;
};

export const findRegularExpressionSubmatches = (
  pattern: string,
  input: string,
  limit: int32,
): string[][] => {
  const matches = find_regex_submatches(pattern, input, limit);
  const result: string[][] = [];
  while (matches.has_rows()) {
    const match = matches.pop_row();
    const row: string[] = [];
    while (match.has_groups()) row.unshift(match.pop_group());
    result.unshift(row);
  }
  return result;
};

export const replaceRegularExpression = (
  pattern: string,
  replacement: string,
  input: string,
  limit: int32,
): string => replace_regex_limited(pattern, replacement, input, limit);
