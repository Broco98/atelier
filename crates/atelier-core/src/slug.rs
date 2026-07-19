pub fn slugify(name: &str) -> String {
    let slug: String = name
        .trim()
        .chars()
        .map(|c| match c {
            'A'..='Z' => c.to_ascii_lowercase(),
            ' ' | '\t' | '/' | '\\' | ':' => '-',
            c if c.is_control() => '-',
            c => c,
        })
        .collect();
    let slug = slug.trim_matches(['-', '.']).to_string();
    if slug.is_empty() {
        "project".to_string()
    } else {
        slug
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lowercases_and_replaces_spaces() {
        assert_eq!(slugify("My App"), "my-app");
    }

    #[test]
    fn keeps_unicode() {
        assert_eq!(slugify("결제 서비스"), "결제-서비스");
    }

    #[test]
    fn strips_path_separators_and_leading_dots() {
        assert_eq!(slugify("a/b\\c"), "a-b-c");
        assert_eq!(slugify(".hidden"), "hidden");
        assert_eq!(slugify("..."), "project");
        assert_eq!(slugify(""), "project");
    }
}
