import type { UrlObject } from "node:url";
import { TemplateValue } from "./base.js";

const trimLeadingCharacter = (value: string, character: string): string => {
  return value.startsWith(character) ? value.slice(character.length) : value;
};

const trimTrailingCharacter = (value: string, character: string): string => {
  return value.endsWith(character) ? value.slice(0, value.length - character.length) : value;
};

export class ParsedUrl {
  originalString: string;
  absolute: boolean;
  scheme: string;
  host: string;
  path: string;
  rawQuery: string;
  fragment: string;

  constructor(originalString: string, value: UrlObject) {
    this.originalString = originalString;
    this.absolute = value.protocol !== "";
    this.scheme = trimTrailingCharacter(value.protocol, ":");
    this.host = value.hostname;
    this.path = value.pathname;
    this.rawQuery = trimLeadingCharacter(value.search, "?");
    this.fragment = trimLeadingCharacter(value.hash, "#");
  }
}

export class UrlParts {
  path: string;
  rawQuery: string;
  fragment: string;

  constructor(path: string, rawQuery: string, fragment: string) {
    this.path = path;
    this.rawQuery = rawQuery;
    this.fragment = fragment;
  }
}

export class UrlValue extends TemplateValue {
  value: ParsedUrl;

  constructor(value: ParsedUrl) {
    super();
    this.value = value;
  }
}
