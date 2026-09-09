#[cfg(test)]
use std::cell::Cell;
use std::collections::{BTreeMap, BTreeSet, HashMap};

use linkify::{LinkFinder, LinkKind};
use pulldown_cmark::{CowStr, Event, HeadingLevel, LinkType, Options, Parser, Tag, TagEnd, html};

#[derive(Clone)]
pub(super) enum MarkdownModification {
    Html(String),
    Url(String),
}

#[derive(Clone)]
pub(super) struct InternalOccurrence {
    pub(super) kind: String,
    pub(super) destination: String,
    pub(super) title: String,
    pub(super) plain_text: String,
    pub(super) level: i32,
    pub(super) anchor: String,
    pub(super) start_event: usize,
    pub(super) end_event: usize,
}

fn markdown_options() -> Options {
    Options::ENABLE_TABLES
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_SMART_PUNCTUATION
        | Options::ENABLE_GFM
}

#[cfg(test)]
thread_local! {
    pub(super) static MARKDOWN_PARSE_COUNT: Cell<usize> = const { Cell::new(0) };
}

pub(super) fn operation_events(source: &str) -> (Vec<Event<'static>>, Vec<InternalOccurrence>) {
    #[cfg(test)]
    MARKDOWN_PARSE_COUNT.with(|count| count.set(count.get() + 1));
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

pub(super) fn render_event_range(
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

pub(super) fn plain_text(events: &[Event<'static>]) -> String {
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

pub(super) fn render_table_of_contents(headings: &[InternalOccurrence]) -> String {
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

#[cfg(test)]
mod tests {
    use crate::MarkdownDocument;

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
}
