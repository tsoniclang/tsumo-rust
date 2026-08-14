# Getting started

## Build from source

Install Node.js 22+, npm, and the stable Rust toolchain. The repository expects
the sibling Tsonic and Rust target/runtime checkouts listed in the root README.

```bash
npm install
npm run build
```

Tsonic first checks the authored TypeScript and emits Rust under the ignored
`packages/*/out/rust` directories. Cargo then builds the single locked
workspace. The resulting executable is:

```text
target/debug/tsumo
```

Run the complete reproducible gate before publishing changes:

```bash
npm run verify-all
```

## Quick start

```bash
target/debug/tsumo new site ./my-site
target/debug/tsumo new posts/first-post.md --source ./my-site
target/debug/tsumo build --source ./my-site --destination ./public
target/debug/tsumo server --source ./my-site
```

## Included examples

```bash
target/debug/tsumo build --source ./examples/basic-blog
target/debug/tsumo server --source ./examples/basic-blog
target/debug/tsumo build --source ./examples/docs-site
```

## Themes

Set a theme in `hugo.toml`, `hugo.yaml`, or `hugo.json`. By default Tsumo
resolves it under the site's `themes` directory; `--themesDir` selects an
explicit parent directory.

```toml
theme = "hugo-book"
```

```bash
target/debug/tsumo build --source ./my-site --themesDir /path/to/hugo-themes
```

## Sass

Sass execution is an explicit external tool boundary. Set `TSUMO_SASS` to the
desired executable or make `sass` available on `PATH`:

```bash
TSUMO_SASS=/opt/dart-sass/sass target/debug/tsumo build --source ./my-site
```

Missing or failing Sass commands produce a deterministic build diagnostic; the
engine does not fall back to another implementation.
