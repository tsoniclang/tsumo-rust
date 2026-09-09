use image::ImageFormat;
use image::imageops::FilterType;
use tsonic_rust_runtime::TsonicResult;

use crate::platform_error;

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
