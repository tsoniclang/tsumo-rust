mod html;
mod images;
mod markdown;
mod text;

use tsonic_rust_runtime::TsonicError;

pub use html::decode_html;
pub use images::resize_image;
pub use markdown::{
    MarkdownBatch, MarkdownBatchResult, MarkdownDocument, MarkdownOccurrence, MarkdownSourcePlan,
    create_markdown_source_plan,
};
pub use text::TextBuilderState;

fn platform_error(message: impl Into<String>) -> TsonicError {
    TsonicError::unsupported(message)
}
