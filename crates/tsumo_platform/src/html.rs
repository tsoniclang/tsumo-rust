pub fn decode_html(input: &str) -> String {
    html_escape::decode_html_entities(input).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_entities_preserve_their_exact_contract() {
        assert_eq!(decode_html("&lt;b&gt;&#x1F642;&lt;/b&gt;"), "<b>🙂</b>");
    }
}
