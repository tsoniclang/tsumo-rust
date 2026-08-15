import { decode_url_component } from "@tsonic/rust/crates/tsumo_platform/index.js";

export const decodeUrlComponent = (value: string): string => decode_url_component(value);
