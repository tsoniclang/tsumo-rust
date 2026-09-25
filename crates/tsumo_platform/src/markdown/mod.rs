mod batch;
mod document;
mod render;

use tsonic_rust_runtime::TsonicResult;

use crate::platform_error;

pub use batch::{
    MarkdownBatch, MarkdownBatchResult, MarkdownSourcePlan, create_markdown_source_plan,
};
pub use document::{MarkdownDocument, MarkdownOccurrence};

fn checked_count(length: usize) -> TsonicResult<i32> {
    i32::try_from(length)
        .map_err(|_| platform_error("markdown count exceeds the supported index range"))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_preserve_the_exact_declared_index_range() {
        assert_eq!(checked_count(0).unwrap(), 0);
        assert_eq!(checked_count(i32::MAX as usize).unwrap(), i32::MAX);
        assert!(checked_count(i32::MAX as usize + 1).is_err());
    }
}
