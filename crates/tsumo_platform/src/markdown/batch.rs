use std::cell::RefCell;
use std::rc::Rc;

use tsonic_rust_js::string as js_string;
use tsonic_rust_runtime::TsonicResult;

use super::checked_index;
use super::document::MarkdownDocument;
use crate::platform_error;

struct MarkdownRenderRequest {
    source: String,
}

pub struct MarkdownSourcePlan {
    pub toc_source: String,
    pub full_source: String,
    pub summary_source: String,
}

pub struct MarkdownBatchResult {
    pub html: String,
    pub summary_html: String,
    pub plain_text: String,
    pub table_of_contents: String,
}

struct MarkdownBatchState {
    requests: Vec<MarkdownRenderRequest>,
    results: Option<Vec<Option<MarkdownBatchResult>>>,
    render_attempted: bool,
}

#[derive(Clone)]
pub struct MarkdownBatch {
    state: Rc<RefCell<MarkdownBatchState>>,
}

impl MarkdownBatch {
    pub fn new() -> Self {
        Self {
            state: Rc::new(RefCell::new(MarkdownBatchState {
                requests: Vec::new(),
                results: None,
                render_attempted: false,
            })),
        }
    }

    pub fn add_source(&self, source: &str) -> TsonicResult<i32> {
        let mut state = self.state.borrow_mut();
        if state.render_attempted {
            return Err(platform_error(
                "markdown requests cannot be added after rendering begins",
            ));
        }
        let index = i32::try_from(state.requests.len())
            .map_err(|_| platform_error("markdown batch exceeds the supported request count"))?;
        state.requests.push(MarkdownRenderRequest {
            source: source.to_owned(),
        });
        Ok(index)
    }

    pub fn render(&self) -> TsonicResult<()> {
        let requests = {
            let mut state = self.state.borrow_mut();
            if state.render_attempted {
                return Err(platform_error("markdown batch has already been rendered"));
            }
            state.render_attempted = true;
            std::mem::take(&mut state.requests)
        };
        let rendered = render_markdown_requests(&requests, bounded_worker_count(requests.len()))?;
        self.state.borrow_mut().results = Some(rendered.into_iter().map(Some).collect());
        Ok(())
    }

    pub fn take_result(&self, index: i32) -> TsonicResult<MarkdownBatchResult> {
        let mut state = self.state.borrow_mut();
        let results = state
            .results
            .as_mut()
            .ok_or_else(|| platform_error("markdown batch results are not available"))?;
        let index = checked_index(index, results.len())?;
        results[index]
            .take()
            .ok_or_else(|| platform_error("markdown batch result has already been consumed"))
    }
}

impl Default for MarkdownBatch {
    fn default() -> Self {
        Self::new()
    }
}

fn bounded_worker_count(request_count: usize) -> usize {
    const REQUESTS_PER_WORKER: usize = 64;
    if request_count == 0 {
        return 1;
    }
    let useful_workers = request_count.div_ceil(REQUESTS_PER_WORKER);
    std::thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(1)
        .min(32)
        .min(useful_workers)
}

pub fn create_markdown_source_plan(source: &str) -> TsonicResult<MarkdownSourcePlan> {
    const SUMMARY_MARKER: &str = "<!--more-->";
    const SUMMARY_MARKER_LENGTH: i32 = 11;

    let markdown = source.replace("\r\n", "\n").replace('\r', "\n");
    let lowered = js_string::to_lower_case(&markdown);
    let marker_index = js_string::index_of(&lowered, SUMMARY_MARKER, 0.0);
    if marker_index >= 0 {
        let marker_index = i32::try_from(marker_index)
            .map_err(|_| platform_error("markdown summary marker exceeds the supported range"))?;
        let marker_end = marker_index
            .checked_add(SUMMARY_MARKER_LENGTH)
            .ok_or_else(|| platform_error("markdown summary marker exceeds the supported range"))?;
        let before = js_string::substring(&markdown, 0.0, f64::from(marker_index))?;
        let after = js_string::substring_from(&markdown, f64::from(marker_end))?;
        return Ok(MarkdownSourcePlan {
            toc_source: markdown,
            full_source: before.clone() + &after,
            summary_source: before,
        });
    }

    let trimmed = js_string::trim(&markdown);
    let first_break = js_string::index_of(&trimmed, "\n\n", 0.0);
    let summary_source = if first_break >= 0 {
        let first_break = i32::try_from(first_break)
            .map_err(|_| platform_error("markdown summary exceeds the supported range"))?;
        js_string::substring(&trimmed, 0.0, f64::from(first_break))?
    } else {
        trimmed
    };
    Ok(MarkdownSourcePlan {
        toc_source: markdown.clone(),
        full_source: markdown,
        summary_source,
    })
}

fn render_markdown_request(request: &MarkdownRenderRequest) -> TsonicResult<MarkdownBatchResult> {
    let plan = create_markdown_source_plan(&request.source)?;
    let full_document = MarkdownDocument::new(&plan.full_source);
    let html = full_document.render();
    let plain_text = full_document.plain_text();
    let table_of_contents = if plan.toc_source == plan.full_source {
        full_document.table_of_contents()
    } else {
        MarkdownDocument::new(&plan.toc_source).table_of_contents()
    };
    let summary_html = if plan.summary_source.is_empty() {
        String::new()
    } else if plan.summary_source == plan.full_source {
        html.trim().to_owned()
    } else {
        MarkdownDocument::new(&plan.summary_source)
            .render()
            .trim()
            .to_owned()
    };
    Ok(MarkdownBatchResult {
        html,
        summary_html,
        plain_text,
        table_of_contents,
    })
}

fn render_markdown_requests(
    requests: &[MarkdownRenderRequest],
    worker_count: usize,
) -> TsonicResult<Vec<MarkdownBatchResult>> {
    let results = parallel_map_ordered(
        requests,
        worker_count,
        "markdown worker",
        render_markdown_request,
    )?;
    results.into_iter().collect()
}

fn parallel_map_ordered<T, R, F>(
    items: &[T],
    worker_count: usize,
    worker_name: &str,
    operation: F,
) -> TsonicResult<Vec<R>>
where
    T: Sync,
    R: Send,
    F: Fn(&T) -> R + Sync,
{
    if items.is_empty() {
        return Ok(Vec::new());
    }
    let worker_count = worker_count.clamp(1, items.len());
    if worker_count == 1 {
        return Ok(items.iter().map(operation).collect());
    }
    let chunk_size = items.len().div_ceil(worker_count);
    let mut slots = std::iter::repeat_with(|| None)
        .take(items.len())
        .collect::<Vec<Option<R>>>();
    std::thread::scope(|scope| -> TsonicResult<()> {
        let mut workers = Vec::new();
        let operation = &operation;
        for (item_chunk, result_chunk) in items.chunks(chunk_size).zip(slots.chunks_mut(chunk_size))
        {
            workers.push(scope.spawn(move || {
                for (item, result) in item_chunk.iter().zip(result_chunk.iter_mut()) {
                    *result = Some(operation(item));
                }
            }));
        }
        for worker in workers {
            if worker.join().is_err() {
                return Err(platform_error(format!(
                    "{worker_name} terminated unexpectedly"
                )));
            }
        }
        Ok(())
    })?;
    slots
        .into_iter()
        .enumerate()
        .map(|(index, result)| {
            result.ok_or_else(|| {
                platform_error(format!("{worker_name} omitted result at index {index}"))
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_batch_preserves_request_order_and_exact_products() {
        let batch = MarkdownBatch::new();
        let first = batch
            .add_source("# First\n\nFirst body")
            .expect("first request");
        let second = batch
            .add_source("# Toc 😀\r\n\r\nBefore\r\n<!--MORE-->\r\n\r\n# Full\r\n\r\nBody")
            .expect("second request");
        assert_eq!(first, 0);
        assert_eq!(second, 1);
        batch.render().expect("render batch");

        let first_result = batch.take_result(first).expect("first result");
        assert_eq!(
            first_result.html,
            MarkdownDocument::new("# First\n\nFirst body").render()
        );
        assert_eq!(first_result.summary_html, "<h1 id=\"first\">First</h1>");
        assert_eq!(first_result.plain_text, "First\nFirst body");
        assert!(first_result.table_of_contents.contains("href=\"#first\""));

        let second_result = batch.take_result(second).expect("second result");
        assert!(
            second_result.html.contains("<h1 id=\"toc\">Toc 😀</h1>"),
            "{}",
            second_result.html
        );
        assert!(second_result.html.contains("<h1 id=\"full\">Full</h1>"));
        assert!(!second_result.html.contains("<!--MORE-->"));
        assert_eq!(
            second_result.summary_html,
            "<h1 id=\"toc\">Toc 😀</h1>\n<p>Before</p>"
        );
        assert_eq!(second_result.plain_text, "Toc 😀\nBefore\nFull\nBody");
        assert!(
            second_result.table_of_contents.contains("href=\"#toc\""),
            "{}",
            second_result.table_of_contents
        );
        assert!(second_result.table_of_contents.contains("href=\"#full\""));
    }

    #[test]
    fn markdown_batch_lifecycle_fails_closed() {
        let batch = MarkdownBatch::new();
        let index = batch.add_source("body").expect("request");
        assert!(batch.take_result(index).is_err());
        batch.render().expect("render batch");
        assert!(batch.add_source("late").is_err());
        assert!(batch.render().is_err());
        assert!(batch.take_result(index).is_ok());
        assert!(batch.take_result(index).is_err());
        assert!(batch.take_result(-1).is_err());
    }

    #[test]
    fn bounded_parallel_mapping_preserves_order_and_avoids_tiny_batches() {
        assert_eq!(bounded_worker_count(0), 1);
        assert_eq!(bounded_worker_count(1), 1);
        assert_eq!(bounded_worker_count(64), 1);
        assert!(bounded_worker_count(65) <= 2);

        let inputs = (0..257).collect::<Vec<i32>>();
        let outputs = parallel_map_ordered(&inputs, 4, "test worker", |value| value * 3)
            .expect("parallel map");
        assert_eq!(
            outputs,
            inputs.iter().map(|value| value * 3).collect::<Vec<_>>()
        );
    }
}
