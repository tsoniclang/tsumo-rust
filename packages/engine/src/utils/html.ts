import { replaceText } from "./strings.js";
import { TextBuilder } from "./text-builder.js";

export const escapeHtml = (input: string): string => {
  let s = input;
  s = replaceText(s, "&", "&amp;");
  s = replaceText(s, "<", "&lt;");
  s = replaceText(s, ">", "&gt;");
  s = replaceText(s, "\"", "&quot;");
  s = replaceText(s, "'", "&#39;");
  return s;
};

const decodeEntity = (entity: string): string | undefined => {
  if (entity === "amp") return "&";
  if (entity === "lt") return "<";
  if (entity === "gt") return ">";
  if (entity === "quot") return "\"";
  if (entity === "apos" || entity === "#39") return "'";
  if (entity === "nbsp") return "\u00a0";

  let digits = "";
  let radix = 10;
  if (entity.startsWith("#x") || entity.startsWith("#X")) {
    digits = entity.slice(2);
    radix = 16;
  } else if (entity.startsWith("#")) {
    digits = entity.slice(1);
  } else {
    return undefined;
  }
  if (digits === "") return undefined;
  const codePoint = Number.parseInt(digits, radix);
  if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
    return undefined;
  }
  return String.fromCodePoint(codePoint);
};

export const decodeHtml = (input: string): string => {
  const output = new TextBuilder();
  let index = 0;
  while (index < input.length) {
    if (input[index] !== "&") {
      output.append(input[index]!);
      index += 1;
      continue;
    }
    const end = input.indexOf(";", index + 1);
    if (end < 0) {
      output.append("&");
      index += 1;
      continue;
    }
    const entity = input.slice(index + 1, end);
    const decoded = decodeEntity(entity);
    if (decoded === undefined) {
      output.append(input.slice(index, end + 1));
    } else {
      output.append(decoded);
    }
    index = end + 1;
  }
  return output.toString();
};

export class HtmlString {
  value: string;

  constructor(value: string) {
    this.value = value;
  }
}
