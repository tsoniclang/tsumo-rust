use std::collections::{BTreeMap, HashMap};
use std::io::Write;
use std::process::{Command, Stdio};

use image::imageops::FilterType;
use image::ImageFormat;
use pulldown_cmark::{html, CowStr, Event, HeadingLevel, Options, Parser, Tag, TagEnd};

#[derive(Clone)]
enum MarkdownModification {
    Html(String),
    Url(String),
}

pub struct MarkdownOccurrence {
    pub kind: String,
    pub destination: String,
    pub title: String,
    pub html: String,
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

    pub fn occurrence(&self, index: i32) -> Result<MarkdownOccurrence, String> {
        let (_, occurrences) = operation_events(&self.source);
        let index = checked_index(index, occurrences.len())?;
        Ok(occurrences[index].clone().into())
    }

    pub fn replace_html(&mut self, index: i32, value: &str) -> Result<(), String> {
        let (_, occurrences) = operation_events(&self.source);
        let index = checked_index(index, occurrences.len())?;
        self.modifications
            .insert(index, MarkdownModification::Html(value.to_owned()));
        Ok(())
    }

    pub fn replace_url(&mut self, index: i32, value: &str) -> Result<(), String> {
        let (_, occurrences) = operation_events(&self.source);
        let index = checked_index(index, occurrences.len())?;
        let occurrence = &occurrences[index];
        if occurrence.kind != "link" && occurrence.kind != "image" {
            return Err("only link and image occurrences have replaceable URLs".to_owned());
        }
        self.modifications
            .insert(index, MarkdownModification::Url(value.to_owned()));
        Ok(())
    }

    pub fn render(&self) -> String {
        let (events, occurrences) = operation_events(&self.source);
        let starts = occurrences
            .iter()
            .enumerate()
            .map(|(index, occurrence)| (occurrence.start_event, index))
            .collect::<HashMap<_, _>>();
        let mut output_events = Vec::with_capacity(events.len());
        let mut event_index = 0;
        while event_index < events.len() {
            let occurrence_index = starts.get(&event_index).copied();
            if let Some(occurrence_index) = occurrence_index {
                if let Some(modification) = self.modifications.get(&occurrence_index) {
                    match modification {
                        MarkdownModification::Html(value) => {
                            output_events.push(Event::Html(CowStr::Boxed(
                                value.clone().into_boxed_str(),
                            )));
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
            }
            output_events.push(events[event_index].clone());
            event_index += 1;
        }

        let mut output = String::new();
        html::push_html(&mut output, output_events.into_iter());
        output
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
    html: String,
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
            html: value.html,
            plain_text: value.plain_text,
            level: value.level,
            anchor: value.anchor,
        }
    }
}

impl Clone for MarkdownOccurrence {
    fn clone(&self) -> Self {
        Self {
            kind: self.kind.clone(),
            destination: self.destination.clone(),
            title: self.title.clone(),
            html: self.html.clone(),
            plain_text: self.plain_text.clone(),
            level: self.level,
            anchor: self.anchor.clone(),
        }
    }
}

fn checked_index(index: i32, length: usize) -> Result<usize, String> {
    let index = usize::try_from(index).map_err(|_| "markdown occurrence index is negative")?;
    if index >= length {
        return Err("markdown occurrence index is outside the parsed document".to_owned());
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
    assign_heading_anchors(&mut events);
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
        let mut inner_html = String::new();
        html::push_html(&mut inner_html, inner.iter().cloned());
        occurrences.push(InternalOccurrence {
            kind: kind.to_owned(),
            destination,
            title,
            html: inner_html,
            plain_text: plain_text(inner).trim().to_owned(),
            level,
            anchor,
            start_event,
            end_event,
        });
    }
    (events, occurrences)
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
        .filter_map(|(index, event)| matches!(event, Event::Start(Tag::Heading { .. })).then_some(index))
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

    pub fn compile(&self) -> Result<String, String> {
        let mut command = Command::new(&self.executable);
        command.args(["--no-source-map", "--style", "expanded", "--stdin"]);
        for path in &self.load_paths {
            command.arg("--load-path").arg(path);
        }
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command
            .spawn()
            .map_err(|error| format!("failed to start Sass compiler '{}': {error}", self.executable))?;
        child
            .stdin
            .as_mut()
            .ok_or_else(|| "Sass compiler stdin was not available".to_owned())?
            .write_all(self.source.as_bytes())
            .map_err(|error| format!("failed to write Sass input: {error}"))?;
        let output = child
            .wait_with_output()
            .map_err(|error| format!("failed to wait for Sass compiler: {error}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
            return Err(if stderr.is_empty() {
                format!("Sass compiler failed with status {}", output.status)
            } else {
                stderr
            });
        }
        String::from_utf8(output.stdout)
            .map_err(|_| "Sass compiler output was not valid UTF-8".to_owned())
    }
}

pub fn resize_image(
    input_path: &str,
    output_path: &str,
    width: i32,
    height: i32,
    format: &str,
) -> Result<(), String> {
    let width = u32::try_from(width).map_err(|_| "image width must be positive")?;
    let height = u32::try_from(height).map_err(|_| "image height must be positive")?;
    if width == 0 || height == 0 {
        return Err("image dimensions must be positive".to_owned());
    }
    let image = image::open(input_path)
        .map_err(|error| format!("failed to decode image: {error}"))?;
    let resized = image.resize_exact(width, height, FilterType::Lanczos3);
    let output_format = match format.to_ascii_lowercase().as_str() {
        "gif" => ImageFormat::Gif,
        "jpg" | "jpeg" => ImageFormat::Jpeg,
        "png" => ImageFormat::Png,
        "webp" => ImageFormat::WebP,
        _ => return Err(format!("unsupported image format '{format}'")),
    };
    resized
        .save_with_format(output_path, output_format)
        .map_err(|error| format!("failed to encode image: {error}"))
}
