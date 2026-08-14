# tsumo-rust

`tsumo-rust` is a Hugo-inspired static site generator implemented in TypeScript
and compiled by Tsonic to a native Rust workspace. It emits and builds ordinary
Rust source; no JavaScript engine or .NET runtime is embedded.

## Implemented surface

| Area | Status | Contract |
| --- | --- | --- |
| Markdown | ✅ | GFM tables, task lists, autolinks, fenced code, strikethrough, footnotes, and stable heading IDs |
| Content | ✅ | YAML, TOML, and JSON front matter; leaf bundles; drafts; taxonomies |
| Templates | ✅ | Hugo-compatible Go-template subset, partials, layouts, render hooks, and shortcodes |
| Assets | ✅ | Fingerprinting, template execution, Sass command integration, and native image metadata/transforms |
| Outputs | ✅ | HTML, RSS, sitemap, robots, static assets, and deterministic publication |
| CLI | ✅ | `build`, `server`, `new site`, `new`, `help`, and `version` |
| Docs mode | ✅ | Multi-repository mounts, navigation, link rewriting, and search index |

Markdown and image operations cross one explicit target-owned boundary in
`crates/tsumo_platform`; the TypeScript engine remains shared application code.

## Repository layout

- `packages/engine` — Tsonic-authored site engine, emitted as the `tsumo_engine` Rust crate.
- `packages/cli` — Tsonic-authored native `tsumo` binary.
- `packages/tests` — 40 Tsonic-authored tests compiled into `tsumo-tests`.
- `crates/tsumo_platform` — closed Rust implementations for target-native Markdown, image, Sass, and HTML operations.
- `test` — Node-driven end-to-end tests against the compiled Rust binary.
- `examples/basic-blog` and `examples/docs-site` — executable fixture sites.

## Prerequisites

The workspace uses sibling development checkouts:

- `../tsonic`
- `../tsonic-rust`
- `../rust-runtime`
- `../rust-js`
- `../rust-nodejs`

Install Node.js 22+, npm, and the stable Rust toolchain. Sass is optional unless
a site invokes `css.Sass`; set `TSUMO_SASS` to an exact executable path or make
`sass` available on `PATH`.

## Build

```bash
npm install
npm run build
```

The build has two explicit stages:

1. `npm run build:tsonic` checks the three TypeScript projects and atomically
   emits Rust sources under each ignored `packages/*/out/rust` directory. At
   most two compiler workers run concurrently under the default memory policy.
2. `npm run build:rust` builds the single locked root Cargo workspace.

The debug executable is `target/debug/tsumo`.

## Verify

```bash
npm run verify-all
```

The full gate proves architecture constraints, byte-identical repeated Tsonic
generation, Rust build/tests, all 40 compiled Tsonic tests, Node end-to-end
tests, warning-free clippy, a release build, and identical debug/release site
output. Verification logs stay under `.temp/verification-runs`.

## Try the examples

```bash
target/debug/tsumo build --source ./examples/basic-blog --destination ./public
target/debug/tsumo server --source ./examples/basic-blog
target/debug/tsumo build --source ./examples/docs-site --destination ./public
```

See `docs/getting-started.md` for the complete workflow.
