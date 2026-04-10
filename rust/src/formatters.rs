use regex::Regex;

use crate::models::{PageContent, SearchResultItem};

pub fn html_to_markdown(html: &str) -> String {
    let mut md = html.to_string();
    let replacements = [
        (r"(?i)<h1[^>]*>(.*?)</h1>", "# $1\n\n"),
        (r"(?i)<h2[^>]*>(.*?)</h2>", "## $1\n\n"),
        (r"(?i)<h3[^>]*>(.*?)</h3>", "### $1\n\n"),
        (r"(?i)<h4[^>]*>(.*?)</h4>", "#### $1\n\n"),
        (r"(?i)<h5[^>]*>(.*?)</h5>", "##### $1\n\n"),
        (r"(?i)<h6[^>]*>(.*?)</h6>", "###### $1\n\n"),
        (r"(?i)<p[^>]*>(.*?)</p>", "$1\n\n"),
        (r"(?i)<br\s*/?>", "\n"),
        (r"(?i)<strong[^>]*>(.*?)</strong>", "**$1**"),
        (r"(?i)<b[^>]*>(.*?)</b>", "**$1**"),
        (r"(?i)<em[^>]*>(.*?)</em>", "*$1*"),
        (r"(?i)<i[^>]*>(.*?)</i>", "*$1*"),
        (r"(?i)<code[^>]*>(.*?)</code>", "`$1`"),
        (r"(?is)<pre[^>]*>(.*?)</pre>", "```\n$1\n```\n"),
        (r#"(?i)<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>"#, "[$2]($1)"),
        (r"(?i)<li[^>]*>(.*?)</li>", "- $1\n"),
        (r"(?is)<blockquote[^>]*>(.*?)</blockquote>", "> $1\n\n"),
        (
            r#"(?i)<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>"#,
            "![$1]($2)",
        ),
        (r"(?i)<hr\s*/?>", "---\n\n"),
        (r"(?is)<[^>]+>", ""),
    ];

    for (pattern, replacement) in replacements {
        let regex = Regex::new(pattern).expect("valid formatter regex");
        md = regex.replace_all(&md, replacement).to_string();
    }

    md = md
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ");

    Regex::new(r"\n{3,}")
        .expect("valid formatter regex")
        .replace_all(md.trim(), "\n\n")
        .to_string()
}

pub fn format_page_output(data: &PageContent, format: &str) -> String {
    match format {
        "text" => {
            if data.text.trim().is_empty() {
                "(no text content)".to_string()
            } else {
                data.text.clone()
            }
        }
        "html" => data.html.clone(),
        "markdown" => html_to_markdown(&data.html),
        "links" => data
            .links
            .iter()
            .map(|link| {
                if link.text.trim().is_empty() {
                    link.href.clone()
                } else {
                    format!("{}  | {}", link.href, link.text)
                }
            })
            .collect::<Vec<_>>()
            .join("\n"),
        "json" => serde_json::to_string_pretty(&serde_json::json!({
            "title": data.title,
            "url": data.url,
            "text": data.text,
            "links": data.links,
            "meta": data.meta,
        }))
        .expect("page content should serialize"),
        _ => data.text.clone(),
    }
}

pub fn format_search_results(results: &[SearchResultItem], format: &str) -> String {
    match format {
        "json" => serde_json::to_string_pretty(results).expect("results should serialize"),
        "links" => results
            .iter()
            .map(|result| result.url.clone())
            .collect::<Vec<_>>()
            .join("\n"),
        "text" => results
            .iter()
            .enumerate()
            .map(|(index, result)| {
                format!(
                    "{}. {}\n   {}\n   {}",
                    index + 1,
                    result.title,
                    result.url,
                    result.snippet
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n"),
        "markdown" => results
            .iter()
            .enumerate()
            .map(|(index, result)| {
                format!(
                    "{}. [{}]({})\n   > {}",
                    index + 1,
                    result.title,
                    result.url,
                    result.snippet
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n"),
        _ => serde_json::to_string_pretty(results).expect("results should serialize"),
    }
}
