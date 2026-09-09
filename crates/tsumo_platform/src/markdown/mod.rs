mod batch;
mod document;
mod render;

use tsonic_rust_runtime::TsonicResult;

use crate::platform_error;

pub use batch::{
    MarkdownBatch, MarkdownBatchResult, MarkdownSourcePlan, create_markdown_source_plan,
};
pub use document::{MarkdownDocument, MarkdownOccurrence};

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
