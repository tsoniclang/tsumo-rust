use std::cell::RefCell;
use std::rc::Rc;

use tsonic_rust_runtime::TsonicResult;

use crate::platform_error;

#[derive(Default)]
struct TextBuilderValue {
    text: String,
    utf16_length: i32,
}

#[derive(Clone, Default)]
pub struct TextBuilderState {
    value: Rc<RefCell<TextBuilderValue>>,
}

impl TextBuilderState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn append(&self, text: &str) -> TsonicResult<()> {
        let additional = i32::try_from(text.encode_utf16().count())
            .map_err(|_| platform_error("text builder length exceeds the supported range"))?;
        let mut value = self.value.borrow_mut();
        value.utf16_length = value
            .utf16_length
            .checked_add(additional)
            .ok_or_else(|| platform_error("text builder length exceeds the supported range"))?;
        value.text.push_str(text);
        Ok(())
    }

    pub fn length(&self) -> i32 {
        self.value.borrow().utf16_length
    }

    pub fn snapshot(&self) -> String {
        self.value.borrow().text.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_helpers_preserve_their_exact_contracts() {
        let builder = TextBuilderState::new();
        let alias = builder.clone();
        assert_eq!(builder.length(), 0);
        builder.append("alpha").expect("append ASCII");
        alias.append("β🙂").expect("append Unicode");
        assert_eq!(builder.length(), 8);
        assert_eq!(builder.snapshot(), "alphaβ🙂");
    }
}
