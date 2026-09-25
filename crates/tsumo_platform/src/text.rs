use std::cell::RefCell;
use std::rc::Rc;

#[derive(Clone, Default)]
pub struct TextBuilderState {
    value: Rc<RefCell<String>>,
}

impl TextBuilderState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn append(&self, text: &str) {
        self.value.borrow_mut().push_str(text);
    }

    pub fn length(&self) -> usize {
        self.value.borrow().len()
    }

    pub fn snapshot(&self) -> String {
        self.value.borrow().clone()
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
        builder.append("alpha");
        let snapshot = builder.snapshot();
        alias.append("β🙂");
        builder.append("");
        assert_eq!(builder.length(), "alphaβ🙂".len());
        assert_eq!(snapshot, "alpha");
        assert_eq!(builder.snapshot(), "alphaβ🙂");
    }
}
