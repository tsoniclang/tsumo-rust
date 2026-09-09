use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;

use pulldown_cmark::Event;
use tsonic_rust_runtime::TsonicResult;

use super::checked_index;
use super::render::{
    InternalOccurrence, MarkdownModification, operation_events, plain_text, render_event_range,
    render_table_of_contents,
};
use crate::platform_error;

#[derive(Clone)]
pub struct MarkdownOccurrence {
    pub kind: String,
    pub destination: String,
    pub title: String,
    pub plain_text: String,
    pub level: i32,
    pub anchor: String,
}

struct MarkdownDocumentState {
    events: Vec<Event<'static>>,
    occurrences: Vec<InternalOccurrence>,
    modifications: BTreeMap<usize, MarkdownModification>,
}

#[derive(Clone)]
pub struct MarkdownDocument {
    state: Rc<RefCell<MarkdownDocumentState>>,
}

impl MarkdownDocument {
    pub fn new(source: &str) -> Self {
        let (events, occurrences) = operation_events(source);
        Self {
            state: Rc::new(RefCell::new(MarkdownDocumentState {
                events,
                occurrences,
                modifications: BTreeMap::new(),
            })),
        }
    }

    pub fn occurrence_count(&self) -> i32 {
        self.state.borrow().occurrences.len() as i32
    }

    pub fn occurrence(&self, index: i32) -> TsonicResult<MarkdownOccurrence> {
        let state = self.state.borrow();
        let index = checked_index(index, state.occurrences.len())?;
        Ok(state.occurrences[index].clone().into())
    }

    pub fn replace_html(&self, index: i32, value: &str) -> TsonicResult<()> {
        let mut state = self.state.borrow_mut();
        let index = checked_index(index, state.occurrences.len())?;
        state
            .modifications
            .insert(index, MarkdownModification::Html(value.to_owned()));
        Ok(())
    }

    pub fn replace_url(&self, index: i32, value: &str) -> TsonicResult<()> {
        let mut state = self.state.borrow_mut();
        let index = checked_index(index, state.occurrences.len())?;
        let occurrence = &state.occurrences[index];
        if occurrence.kind != "link" && occurrence.kind != "image" {
            return Err(platform_error(
                "only link and image occurrences have replaceable URLs",
            ));
        }
        state
            .modifications
            .insert(index, MarkdownModification::Url(value.to_owned()));
        Ok(())
    }

    pub fn occurrence_html(&self, index: i32) -> TsonicResult<String> {
        let state = self.state.borrow();
        let index = checked_index(index, state.occurrences.len())?;
        let occurrence = &state.occurrences[index];
        Ok(render_event_range(
            &state.events,
            &state.occurrences,
            &state.modifications,
            occurrence.start_event + 1,
            occurrence.end_event,
        ))
    }

    pub fn render(&self) -> String {
        let state = self.state.borrow();
        render_event_range(
            &state.events,
            &state.occurrences,
            &state.modifications,
            0,
            state.events.len(),
        )
    }

    pub fn plain_text(&self) -> String {
        plain_text(&self.state.borrow().events).trim().to_owned()
    }

    pub fn table_of_contents(&self) -> String {
        let state = self.state.borrow();
        let headings = state
            .occurrences
            .iter()
            .filter(|occurrence| occurrence.kind == "heading")
            .cloned()
            .collect::<Vec<_>>();
        render_table_of_contents(&headings)
    }
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

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::super::render::MARKDOWN_PARSE_COUNT;
    use super::*;

    #[test]
    fn markdown_operations_are_indexed_and_rewritten_exactly() {
        MARKDOWN_PARSE_COUNT.with(|count| count.set(0));
        let document =
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
        assert_eq!(MARKDOWN_PARSE_COUNT.with(Cell::get), 1);
    }

    #[test]
    fn nested_hook_html_observes_inner_replacements() {
        let document = MarkdownDocument::new("# [Guide](guide.md)");
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
        let document = MarkdownDocument::new("plain text");
        assert!(document.occurrence(-1).is_err());
        assert!(document.replace_url(0, "/missing/").is_err());
    }

    #[test]
    fn markdown_document_clones_preserve_one_mutable_document_identity() {
        let document = MarkdownDocument::new("[Guide](guide.md)");
        let same_document = document.clone();
        same_document
            .replace_url(0, "/guide/")
            .expect("replace link through cloned carrier");

        assert!(document.render().contains("href=\"/guide/\""));
    }
}
