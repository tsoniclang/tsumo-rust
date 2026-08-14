use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::io::Write;
use std::process::{Command, Stdio};

use image::ImageFormat;
use image::imageops::FilterType;
use linkify::{LinkFinder, LinkKind};
use pulldown_cmark::{CowStr, Event, HeadingLevel, LinkType, Options, Parser, Tag, TagEnd, html};
use regex::Regex;
use tsonic_rust_runtime::{TsonicError, TsonicResult};

#[derive(Clone)]
enum MarkdownModification {
    Html(String),
    Url(String),
}

#[derive(Clone)]
pub struct MarkdownOccurrence {
    pub kind: String,
    pub destination: String,
    pub title: String,
    pub plain_text: String,
    pub level: i32,
    pub anchor: String,
}

pub struct MarkdownDocument {
    source: String,
    modifications: BTreeMap<usize, MarkdownModification>,
}

impl MarkdownDocument {
    pub fn new(source: &str) -> Self {
        Self {
            source: source.to_owned(),
            modifications: BTreeMap::new(),
        }
    }

    pub fn occurrence_count(&self) -> i32 {
        operation_events(&self.source).1.len() as i32
    }

    pub fn occurrence(&self, index: i32) -> TsonicResult<MarkdownOccurrence> {
        let (_, occurrences) = operation_events(&self.source);
        let index = checked_index(index, occurrences.len())?;
        Ok(occurrences[index].clone().into())
    }

    pub fn replace_html(&mut self, index: i32, value: &str) -> TsonicResult<()> {
        let (_, occurrences) = operation_events(&self.source);
        let index = checked_index(index, occurrences.len())?;
        self.modifications
            .insert(index, MarkdownModification::Html(value.to_owned()));
        Ok(())
    }

    pub fn replace_url(&mut self, index: i32, value: &str) -> TsonicResult<()> {
        let (_, occurrences) = operation_events(&self.source);
        let index = checked_index(index, occurrences.len())?;
        let occurrence = &occurrences[index];
        if occurrence.kind != "link" && occurrence.kind != "image" {
            return Err(platform_error(
                "only link and image occurrences have replaceable URLs",
            ));
        }
        self.modifications
            .insert(index, MarkdownModification::Url(value.to_owned()));
        Ok(())
    }

    pub fn occurrence_html(&self, index: i32) -> TsonicResult<String> {
        let (events, occurrences) = operation_events(&self.source);
        let index = checked_index(index, occurrences.len())?;
        let occurrence = &occurrences[index];
        Ok(render_event_range(
            &events,
            &occurrences,
            &self.modifications,
            occurrence.start_event + 1,
            occurrence.end_event,
        ))
    }

    pub fn render(&self) -> String {
        let (events, occurrences) = operation_events(&self.source);
        render_event_range(&events, &occurrences, &self.modifications, 0, events.len())
    }

    pub fn plain_text(&self) -> String {
        let (events, _) = operation_events(&self.source);
        plain_text(&events).trim().to_owned()
    }

    pub fn table_of_contents(&self) -> String {
        let (_, occurrences) = operation_events(&self.source);
        let headings = occurrences
            .into_iter()
            .filter(|occurrence| occurrence.kind == "heading")
            .collect::<Vec<_>>();
        render_table_of_contents(&headings)
    }
}

#[derive(Clone)]
struct InternalOccurrence {
    kind: String,
    destination: String,
    title: String,
    plain_text: String,
    level: i32,
    anchor: String,
    start_event: usize,
    end_event: usize,
}

impl From<InternalOccurrence> for MarkdownOccurrence {
    fn from(value: InternalOccurrence) -> Self {
        Self {
            kind: value.kind,
            destination: value.destination,
            title: value.title,
            plain_text: value.plain_text,
            level: value.level,
            anchor: value.anchor,
        }
    }
}

fn checked_index(index: i32, length: usize) -> TsonicResult<usize> {
    let index = usize::try_from(index)
        .map_err(|_| platform_error("markdown occurrence index is negative"))?;
    if index >= length {
        return Err(platform_error(
            "markdown occurrence index is outside the parsed document",
        ));
    }
    Ok(index)
}

fn markdown_options() -> Options {
    Options::ENABLE_TABLES
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_SMART_PUNCTUATION
        | Options::ENABLE_GFM
}

fn operation_events(source: &str) -> (Vec<Event<'static>>, Vec<InternalOccurrence>) {
    let mut events = Parser::new_ext(source, markdown_options())
        .map(Event::into_static)
        .collect::<Vec<_>>();
    assign_gfm_autolinks(&mut events);
    assign_heading_anchors(&mut events);
    assign_task_list_classes(&mut events);
    let mut occurrences = Vec::new();
    for start_event in 0..events.len() {
        let (kind, destination, title, level, anchor) = match &events[start_event] {
            Event::Start(Tag::Link {
                dest_url, title, ..
            }) => (
                "link",
                dest_url.to_string(),
                title.to_string(),
                0,
                String::new(),
            ),
            Event::Start(Tag::Image {
                dest_url, title, ..
            }) => (
                "image",
                dest_url.to_string(),
                title.to_string(),
                0,
                String::new(),
            ),
            Event::Start(Tag::Heading { level, id, .. }) => (
                "heading",
                String::new(),
                String::new(),
                heading_level(*level),
                id.as_ref().map(ToString::to_string).unwrap_or_default(),
            ),
            _ => continue,
        };
        let end_event = matching_end(&events, start_event);
        let inner = &events[start_event + 1..end_event];
        occurrences.push(InternalOccurrence {
            kind: kind.to_owned(),
            destination,
            title,
            plain_text: plain_text(inner).trim().to_owned(),
            level,
            anchor,
            start_event,
            end_event,
        });
    }
    (events, occurrences)
}

fn assign_gfm_autolinks(events: &mut Vec<Event<'static>>) {
    let mut finder = LinkFinder::new();
    finder.url_must_have_scheme(false);
    let mut output = Vec::with_capacity(events.len());
    let mut explicit_link_depth = 0usize;
    for event in std::mem::take(events) {
        match &event {
            Event::Start(Tag::Link { .. } | Tag::Image { .. }) => {
                explicit_link_depth += 1;
                output.push(event);
            }
            Event::End(TagEnd::Link | TagEnd::Image) => {
                output.push(event);
                explicit_link_depth -= 1;
            }
            Event::Text(text) if explicit_link_depth == 0 => {
                append_gfm_autolinks(&finder, text.as_ref(), &mut output);
            }
            _ => output.push(event),
        }
    }
    *events = output;
}

fn append_gfm_autolinks(finder: &LinkFinder, text: &str, output: &mut Vec<Event<'static>>) {
    let mut cursor = 0usize;
    for link in finder.links(text) {
        let value = link.as_str();
        let (start, link_type, destination) = match link.kind() {
            LinkKind::Url => {
                let lower = value.to_ascii_lowercase();
                if lower.starts_with("www.") {
                    (link.start(), LinkType::Autolink, format!("http://{value}"))
                } else if lower.starts_with("http://")
                    || lower.starts_with("https://")
                    || lower.starts_with("ftp://")
                {
                    (link.start(), LinkType::Autolink, value.to_owned())
                } else {
                    continue;
                }
            }
            LinkKind::Email => {
                let mailto_start = link.start().checked_sub("mailto:".len());
                if let Some(start) = mailto_start
                    .filter(|start| text[*start..link.start()].eq_ignore_ascii_case("mailto:"))
                {
                    (
                        start,
                        LinkType::Autolink,
                        text[start..link.end()].to_owned(),
                    )
                } else {
                    (link.start(), LinkType::Email, value.to_owned())
                }
            }
            _ => continue,
        };
        if start < cursor {
            continue;
        }
        push_markdown_text(&text[cursor..start], output);
        let display = &text[start..link.end()];
        output.push(Event::Start(Tag::Link {
            link_type,
            dest_url: CowStr::Boxed(destination.into_boxed_str()),
            title: CowStr::Borrowed(""),
            id: CowStr::Borrowed(""),
        }));
        push_markdown_text(display, output);
        output.push(Event::End(TagEnd::Link));
        cursor = link.end();
    }
    push_markdown_text(&text[cursor..], output);
}

fn push_markdown_text(text: &str, output: &mut Vec<Event<'static>>) {
    if !text.is_empty() {
        output.push(Event::Text(CowStr::Boxed(text.to_owned().into_boxed_str())));
    }
}

fn assign_task_list_classes(events: &mut [Event<'static>]) {
    let mut list_stack = Vec::new();
    let mut task_items = BTreeSet::new();
    let mut task_lists = BTreeSet::new();
    for index in 0..events.len() {
        match &events[index] {
            Event::Start(Tag::List(_)) => list_stack.push(index),
            Event::End(TagEnd::List(_)) => {
                list_stack.pop();
            }
            Event::Start(Tag::Item)
                if matches!(events.get(index + 1), Some(Event::TaskListMarker(_))) =>
            {
                task_items.insert(index);
                if let Some(list) = list_stack.last() {
                    task_lists.insert(*list);
                }
            }
            _ => {}
        }
    }

    for start in task_items {
        let end = matching_end(events, start);
        events[start] = Event::Html(CowStr::Borrowed("<li class=\"task-list-item\">"));
        events[end] = Event::Html(CowStr::Borrowed("</li>\n"));
    }
    for start in task_lists {
        let end = matching_end(events, start);
        let opening = match &events[start] {
            Event::Start(Tag::List(None)) => "<ul class=\"contains-task-list\">\n".to_owned(),
            Event::Start(Tag::List(Some(1))) => "<ol class=\"contains-task-list\">\n".to_owned(),
            Event::Start(Tag::List(Some(number))) => {
                format!("<ol class=\"contains-task-list\" start=\"{number}\">\n")
            }
            _ => continue,
        };
        let closing = match &events[end] {
            Event::End(TagEnd::List(true)) => "</ol>\n",
            Event::End(TagEnd::List(false)) => "</ul>\n",
            _ => continue,
        };
        events[start] = Event::Html(CowStr::Boxed(opening.into_boxed_str()));
        events[end] = Event::Html(CowStr::Borrowed(closing));
    }
}

fn render_event_range(
    events: &[Event<'static>],
    occurrences: &[InternalOccurrence],
    modifications: &BTreeMap<usize, MarkdownModification>,
    start: usize,
    end: usize,
) -> String {
    let starts = occurrences
        .iter()
        .enumerate()
        .map(|(index, occurrence)| (occurrence.start_event, index))
        .collect::<HashMap<_, _>>();
    let mut output_events = Vec::with_capacity(end.saturating_sub(start));
    let mut event_index = start;
    while event_index < end {
        if let Some(occurrence_index) = starts.get(&event_index).copied()
            && let Some(modification) = modifications.get(&occurrence_index)
        {
            match modification {
                MarkdownModification::Html(value) => {
                    output_events.push(Event::Html(CowStr::Boxed(value.clone().into_boxed_str())));
                    event_index = occurrences[occurrence_index].end_event + 1;
                    continue;
                }
                MarkdownModification::Url(value) => {
                    output_events.push(replace_event_url(&events[event_index], value));
                    event_index += 1;
                    continue;
                }
            }
        }
        output_events.push(events[event_index].clone());
        event_index += 1;
    }
    let mut output = String::new();
    html::push_html(&mut output, output_events.into_iter());
    output
}

fn matching_end(events: &[Event<'static>], start_event: usize) -> usize {
    let mut depth = 0usize;
    for (index, event) in events.iter().enumerate().skip(start_event + 1) {
        match event {
            Event::Start(_) => depth += 1,
            Event::End(_) if depth == 0 => return index,
            Event::End(_) => depth -= 1,
            _ => {}
        }
    }
    events.len().saturating_sub(1)
}

fn assign_heading_anchors(events: &mut [Event<'static>]) {
    let mut anchors = HashMap::<String, usize>::new();
    let heading_starts = events
        .iter()
        .enumerate()
        .filter_map(|(index, event)| {
            matches!(event, Event::Start(Tag::Heading { .. })).then_some(index)
        })
        .collect::<Vec<_>>();

    for start in heading_starts {
        let end = matching_end(events, start);
        let text = plain_text(&events[start + 1..end]);
        let base = heading_anchor(&text);
        let count = anchors.entry(base.clone()).or_insert(0);
        let anchor = if *count == 0 {
            base
        } else {
            format!("{base}-{count}")
        };
        *count += 1;
        if let Event::Start(Tag::Heading {
            level,
            classes,
            attrs,
            ..
        }) = &events[start]
        {
            events[start] = Event::Start(Tag::Heading {
                level: *level,
                id: Some(CowStr::Boxed(anchor.into_boxed_str())),
                classes: classes.clone(),
                attrs: attrs.clone(),
            });
        }
    }
}

fn heading_anchor(value: &str) -> String {
    let mut output = String::new();
    let mut pending_dash = false;
    for character in value.chars() {
        if character.is_alphanumeric() || character == '_' || character == '-' {
            if pending_dash && !output.is_empty() && !output.ends_with('-') {
                output.push('-');
            }
            pending_dash = false;
            for lowered in character.to_lowercase() {
                output.push(lowered);
            }
        } else if character.is_whitespace() {
            pending_dash = true;
        }
    }
    if output.is_empty() {
        "section".to_owned()
    } else {
        output
    }
}

fn heading_level(level: HeadingLevel) -> i32 {
    match level {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

fn plain_text(events: &[Event<'static>]) -> String {
    let mut output = String::new();
    for event in events {
        match event {
            Event::Text(value) | Event::Code(value) => output.push_str(value),
            Event::SoftBreak | Event::HardBreak | Event::Rule => output.push('\n'),
            Event::TaskListMarker(checked) => {
                output.push_str(if *checked { "[x] " } else { "[ ] " });
            }
            Event::End(TagEnd::Paragraph | TagEnd::Heading(_)) => output.push('\n'),
            _ => {}
        }
    }
    output
}

fn replace_event_url(event: &Event<'static>, value: &str) -> Event<'static> {
    let replacement = CowStr::Boxed(value.to_owned().into_boxed_str());
    match event {
        Event::Start(Tag::Link {
            link_type,
            title,
            id,
            ..
        }) => Event::Start(Tag::Link {
            link_type: *link_type,
            dest_url: replacement,
            title: title.clone(),
            id: id.clone(),
        }),
        Event::Start(Tag::Image {
            link_type,
            title,
            id,
            ..
        }) => Event::Start(Tag::Image {
            link_type: *link_type,
            dest_url: replacement,
            title: title.clone(),
            id: id.clone(),
        }),
        _ => event.clone(),
    }
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn indent(depth: usize) -> String {
    "  ".repeat(depth)
}

fn render_table_of_contents(headings: &[InternalOccurrence]) -> String {
    if headings.is_empty() {
        return "<nav id=\"TableOfContents\"></nav>".to_owned();
    }

    struct Frame {
        level: i32,
        item_open: bool,
    }

    let mut output = String::from("<nav id=\"TableOfContents\">\n");
    let mut stack = Vec::<Frame>::new();
    let mut current_level = 0;
    for heading in headings {
        let mut target_level = heading.level;
        if current_level != 0 && target_level > current_level + 1 {
            target_level = current_level + 1;
        }
        if stack.is_empty() {
            output.push_str(&format!("{}<ul>\n", indent(1)));
            stack.push(Frame {
                level: target_level,
                item_open: false,
            });
            current_level = target_level;
        }
        while !stack.is_empty() && target_level < current_level {
            let depth = stack.len();
            if stack.last().is_some_and(|frame| frame.item_open) {
                output.push_str(&format!("{}</li>\n", indent(depth + 1)));
            }
            output.push_str(&format!("{}</ul>\n", indent(depth)));
            stack.pop();
            current_level = stack.last().map_or(0, |frame| frame.level);
        }
        if stack.is_empty() {
            output.push_str(&format!("{}<ul>\n", indent(1)));
            stack.push(Frame {
                level: target_level,
                item_open: false,
            });
            current_level = target_level;
        }
        if target_level == current_level && stack.last().is_some_and(|frame| frame.item_open) {
            output.push_str(&format!("{}</li>\n", indent(stack.len() + 1)));
            stack.last_mut().expect("non-empty stack").item_open = false;
        }
        if target_level > current_level {
            output.push_str(&format!("{}<ul>\n", indent(stack.len() + 1)));
            stack.push(Frame {
                level: target_level,
                item_open: false,
            });
            current_level = target_level;
        }
        output.push_str(&format!(
            "{}<li><a href=\"#{}\">{}</a>\n",
            indent(stack.len() + 1),
            escape_html(&heading.anchor),
            escape_html(&heading.plain_text),
        ));
        stack.last_mut().expect("non-empty stack").item_open = true;
    }
    while !stack.is_empty() {
        let depth = stack.len();
        if stack.last().is_some_and(|frame| frame.item_open) {
            output.push_str(&format!("{}</li>\n", indent(depth + 1)));
        }
        output.push_str(&format!("{}</ul>\n", indent(depth)));
        stack.pop();
    }
    output.push_str("</nav>");
    output
}

pub struct SassCompiler {
    source: String,
    executable: String,
    load_paths: Vec<String>,
}

impl SassCompiler {
    pub fn new(source: &str, executable: &str) -> Self {
        Self {
            source: source.to_owned(),
            executable: executable.to_owned(),
            load_paths: Vec::new(),
        }
    }

    pub fn add_load_path(&mut self, path: &str) {
        self.load_paths.push(path.to_owned());
    }

    pub fn compile(&self) -> TsonicResult<String> {
        let mut command = Command::new(&self.executable);
        command.args(["--no-source-map", "--style", "expanded", "--stdin"]);
        for path in &self.load_paths {
            command.arg("--load-path").arg(path);
        }
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command.spawn().map_err(|error| {
            platform_error(format!(
                "failed to start Sass compiler '{}': {error}",
                self.executable
            ))
        })?;
        child
            .stdin
            .as_mut()
            .ok_or_else(|| platform_error("Sass compiler stdin was not available"))?
            .write_all(self.source.as_bytes())
            .map_err(|error| platform_error(format!("failed to write Sass input: {error}")))?;
        let output = child.wait_with_output().map_err(|error| {
            platform_error(format!("failed to wait for Sass compiler: {error}"))
        })?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
            return Err(platform_error(if stderr.is_empty() {
                format!("Sass compiler failed with status {}", output.status)
            } else {
                stderr
            }));
        }
        String::from_utf8(output.stdout)
            .map_err(|_| platform_error("Sass compiler output was not valid UTF-8"))
    }
}

pub fn resize_image(
    input_path: &str,
    output_path: &str,
    width: i32,
    height: i32,
    format: &str,
) -> TsonicResult<()> {
    let width = u32::try_from(width).map_err(|_| platform_error("image width must be positive"))?;
    let height =
        u32::try_from(height).map_err(|_| platform_error("image height must be positive"))?;
    if width == 0 || height == 0 {
        return Err(platform_error("image dimensions must be positive"));
    }
    let image = image::open(input_path)
        .map_err(|error| platform_error(format!("failed to decode image: {error}")))?;
    let resized = image.resize_exact(width, height, FilterType::Lanczos3);
    let output_format = match format.to_ascii_lowercase().as_str() {
        "gif" => ImageFormat::Gif,
        "jpg" | "jpeg" => ImageFormat::Jpeg,
        "png" => ImageFormat::Png,
        "webp" => ImageFormat::WebP,
        _ => {
            return Err(platform_error(format!(
                "unsupported image format '{format}'"
            )));
        }
    };
    resized
        .save_with_format(output_path, output_format)
        .map_err(|error| platform_error(format!("failed to encode image: {error}")))
}

pub fn replace_regex(pattern: &str, replacement: &str, input: &str) -> TsonicResult<String> {
    let expression = Regex::new(pattern)
        .map_err(|error| platform_error(format!("invalid regular expression: {error}")))?;
    Ok(expression.replace_all(input, replacement).into_owned())
}

pub fn decode_html(input: &str) -> String {
    html_escape::decode_html_entities(input).into_owned()
}

pub fn encode_url_component(input: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut output = String::with_capacity(input.len());
    for byte in input.as_bytes() {
        if byte.is_ascii_alphanumeric()
            || matches!(
                byte,
                b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
            )
        {
            output.push(char::from(*byte));
        } else {
            output.push('%');
            output.push(char::from(HEX[usize::from(byte >> 4)]));
            output.push(char::from(HEX[usize::from(byte & 0x0f)]));
        }
    }
    output
}

fn platform_error(message: impl Into<String>) -> TsonicError {
    TsonicError::unsupported(message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_operations_are_indexed_and_rewritten_exactly() {
        let mut document =
            MarkdownDocument::new("# Hello World\n\n[Docs](guide.md) and ![Logo](logo.png)");
        assert_eq!(document.occurrence_count(), 3);
        let heading = document.occurrence(0).expect("heading occurrence");
        assert_eq!(heading.kind, "heading");
        assert_eq!(heading.anchor, "hello-world");
        let link = document.occurrence(1).expect("link occurrence");
        assert_eq!(link.destination, "guide.md");
        document
            .replace_url(1, "/guide/")
            .expect("replace link URL");
        document
            .replace_html(2, "<img src=\"/asset/logo.png\">")
            .expect("replace image HTML");
        assert_eq!(
            document.occurrence_html(0).expect("heading HTML"),
            "Hello World"
        );
        let rendered = document.render();
        assert!(rendered.contains("href=\"/guide/\""));
        assert!(rendered.contains("<img src=\"/asset/logo.png\">"));
        assert!(
            document
                .table_of_contents()
                .contains("href=\"#hello-world\"")
        );
    }

    #[test]
    fn task_lists_preserve_the_public_html_classes() {
        let rendered = MarkdownDocument::new("- [x] complete\n- ordinary\n").render();
        assert!(rendered.contains("<ul class=\"contains-task-list\">"));
        assert!(rendered.contains(
            "<li class=\"task-list-item\"><input disabled=\"\" type=\"checkbox\" checked=\"\"/>"
        ));
        assert!(rendered.contains("<li>ordinary</li>"));
    }

    #[test]
    fn gfm_autolinks_are_structural_and_do_not_nest() {
        let rendered = MarkdownDocument::new(
            "Visit https://tsonic.org, ftp://files.tsonic.org, www.tsonic.org, mailto:team@tsonic.org, team@tsonic.org, bare.example, ssh://host.example, `[https://code.invalid]`, and [docs](https://docs.tsonic.org).",
        )
        .render();
        assert!(rendered.contains(
            "Visit <a href=\"https://tsonic.org\">https://tsonic.org</a>, <a href=\"ftp://files.tsonic.org\">ftp://files.tsonic.org</a>, <a href=\"http://www.tsonic.org\">www.tsonic.org</a>"
        ));
        assert!(rendered.contains(
            "<a href=\"mailto:team@tsonic.org\">mailto:team@tsonic.org</a>, <a href=\"mailto:team@tsonic.org\">team@tsonic.org</a>"
        ));
        assert!(rendered.contains("bare.example, ssh://host.example"));
        assert!(rendered.contains("<code>[https://code.invalid]</code>"));
        assert!(rendered.contains("<a href=\"https://docs.tsonic.org\">docs</a>"));
        assert!(!rendered.contains("<a href=\"https://docs.tsonic.org\"><a"));
    }

    #[test]
    fn nested_hook_html_observes_inner_replacements() {
        let mut document = MarkdownDocument::new("# [Guide](guide.md)");
        document
            .replace_html(1, "<strong>Guide</strong>")
            .expect("replace nested link");
        assert_eq!(
            document.occurrence_html(0).expect("heading HTML"),
            "<strong>Guide</strong>",
        );
    }

    #[test]
    fn invalid_markdown_occurrence_fails_closed() {
        let mut document = MarkdownDocument::new("plain text");
        assert!(document.occurrence(-1).is_err());
        assert!(document.replace_url(0, "/missing/").is_err());
    }

    #[test]
    fn text_helpers_preserve_their_exact_contracts() {
        assert_eq!(
            replace_regex("([a-z]+)([0-9]+)", "$2-$1", "item42").expect("valid expression"),
            "42-item",
        );
        assert!(replace_regex("(", "x", "input").is_err());
        assert_eq!(decode_html("&lt;b&gt;&#x1F642;&lt;/b&gt;"), "<b>🙂</b>");
        assert_eq!(encode_url_component("a b/🙂"), "a%20b%2F%F0%9F%99%82");
    }
}
