import { describe, it, expect } from "vitest";
import { htmlToMarkdown, formatOutput, formatGoogleResults } from "../server/core/formatters.js";

describe("htmlToMarkdown()", () => {
  it("converts h1-h6 tags", () => {
    expect(htmlToMarkdown("<h1>Title</h1>")).toContain("# Title");
    expect(htmlToMarkdown("<h2>Sub</h2>")).toContain("## Sub");
    expect(htmlToMarkdown("<h3>Sub2</h3>")).toContain("### Sub2");
    expect(htmlToMarkdown("<h4>Sub3</h4>")).toContain("#### Sub3");
    expect(htmlToMarkdown("<h5>Sub4</h5>")).toContain("##### Sub4");
    expect(htmlToMarkdown("<h6>Sub5</h6>")).toContain("###### Sub5");
  });

  it("converts paragraph tags", () => {
    const result = htmlToMarkdown("<p>Hello world</p>");
    expect(result).toContain("Hello world");
  });

  it("converts strong and b tags to bold", () => {
    expect(htmlToMarkdown("<strong>bold</strong>")).toContain("**bold**");
    expect(htmlToMarkdown("<b>bold</b>")).toContain("**bold**");
  });

  it("converts em and i tags to italic", () => {
    expect(htmlToMarkdown("<em>italic</em>")).toContain("*italic*");
    expect(htmlToMarkdown("<i>italic</i>")).toContain("*italic*");
  });

  it("converts code tags", () => {
    expect(htmlToMarkdown("<code>var x</code>")).toContain("`var x`");
  });

  it("converts pre tags to code block", () => {
    const result = htmlToMarkdown("<pre>block code</pre>");
    expect(result).toContain("```\nblock code\n```");
  });

  it("converts anchor tags to markdown links", () => {
    const result = htmlToMarkdown('<a href="https://example.com">Link</a>');
    expect(result).toContain("[Link](https://example.com)");
  });

  it("converts li tags to list items", () => {
    const result = htmlToMarkdown("<li>Item 1</li><li>Item 2</li>");
    expect(result).toContain("- Item 1");
    expect(result).toContain("- Item 2");
  });

  it("converts blockquote tags", () => {
    const result = htmlToMarkdown("<blockquote>Quote text</blockquote>");
    expect(result).toContain("> Quote text");
  });

  it("converts img tags to markdown images", () => {
    const result = htmlToMarkdown('<img alt="Alt" src="img.png">');
    expect(result).toContain("![Alt](img.png)");
  });

  it("converts hr tags", () => {
    const result = htmlToMarkdown("<hr/>");
    expect(result).toContain("---");
  });

  it("converts br tags to newlines", () => {
    const result = htmlToMarkdown("line1<br/>line2");
    expect(result).toContain("line1\nline2");
  });

  it("decodes HTML entities", () => {
    expect(htmlToMarkdown("<p>a &amp; b</p>")).toContain("a & b");
    expect(htmlToMarkdown("<p>&lt;tag&gt;</p>")).toContain("<tag>");
    expect(htmlToMarkdown('<p>&quot;hello&quot;</p>')).toContain('"hello"');
    expect(htmlToMarkdown("<p>it&#39;s</p>")).toContain("it's");
  });

  it("strips remaining HTML tags", () => {
    const result = htmlToMarkdown("<div><span>text</span></div>");
    expect(result).not.toContain("<div>");
    expect(result).not.toContain("</span>");
  });

  it("collapses excessive newlines", () => {
    const result = htmlToMarkdown("<p>a</p>\n\n\n\n\n<p>b</p>");
    expect(result).not.toContain("\n\n\n");
  });
});

describe("formatOutput()", () => {
  const sampleData = {
    title: "Test Page",
    url: "https://example.com",
    text: "Hello world",
    html: "<h1>Hello</h1><p>world</p>",
    links: [
      { text: "Link 1", href: "https://example.com/1" },
      { text: "Link 2", href: "https://example.com/2" },
    ],
    meta: { description: "A test page" },
  };

  it("format 'text' returns text content", () => {
    expect(formatOutput(sampleData, "text")).toBe("Hello world");
  });

  it("format 'text' returns fallback for empty text", () => {
    const empty = { ...sampleData, text: "" };
    expect(formatOutput(empty, "text")).toBe("(no text content)");
  });

  it("format 'html' returns raw HTML", () => {
    expect(formatOutput(sampleData, "html")).toBe(sampleData.html);
  });

  it("format 'markdown' converts HTML to markdown", () => {
    const result = formatOutput(sampleData, "markdown");
    expect(result).toContain("# Hello");
    expect(result).toContain("world");
  });

  it("format 'links' returns formatted links", () => {
    const result = formatOutput(sampleData, "links");
    expect(result).toContain("https://example.com/1");
    expect(result).toContain("| Link 1");
    expect(result).toContain("https://example.com/2");
    expect(result).toContain("| Link 2");
  });

  it("format 'json' returns valid JSON with expected fields", () => {
    const result = formatOutput(sampleData, "json");
    const parsed = JSON.parse(result);
    expect(parsed.title).toBe("Test Page");
    expect(parsed.url).toBe("https://example.com");
    expect(parsed.text).toBe("Hello world");
    expect(parsed.links).toHaveLength(2);
    expect(parsed.meta.description).toBe("A test page");
  });

  it("unknown format defaults to text", () => {
    expect(formatOutput(sampleData, "unknown")).toBe("Hello world");
  });
});

describe("formatGoogleResults()", () => {
  const results = [
    { title: "Result 1", url: "https://one.com", snippet: "First result" },
    { title: "Result 2", url: "https://two.com", snippet: "Second result" },
  ];

  it("format 'text' returns numbered results", () => {
    const out = formatGoogleResults(results, "text");
    expect(out).toContain("1. Result 1");
    expect(out).toContain("https://one.com");
    expect(out).toContain("First result");
    expect(out).toContain("2. Result 2");
  });

  it("format 'links' returns only URLs", () => {
    const out = formatGoogleResults(results, "links");
    expect(out).toBe("https://one.com\nhttps://two.com");
  });

  it("format 'json' returns valid JSON array", () => {
    const out = formatGoogleResults(results, "json");
    const parsed = JSON.parse(out);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].title).toBe("Result 1");
  });

  it("format 'markdown' returns linked titles", () => {
    const out = formatGoogleResults(results, "markdown");
    expect(out).toContain("[Result 1](https://one.com)");
    expect(out).toContain("> First result");
  });

  it("unknown format defaults to JSON", () => {
    const out = formatGoogleResults(results, "unknown");
    const parsed = JSON.parse(out);
    expect(parsed).toHaveLength(2);
  });
});
