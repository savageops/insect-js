export function htmlToMarkdown(html) {
  let md = html;
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n\n");
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n\n");
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n\n");
  md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gi, "#### $1\n\n");
  md = md.replace(/<h5[^>]*>(.*?)<\/h5>/gi, "##### $1\n\n");
  md = md.replace(/<h6[^>]*>(.*?)<\/h6>/gi, "###### $1\n\n");
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n\n");
  md = md.replace(/<br\s*\/?>/gi, "\n");
  md = md.replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**");
  md = md.replace(/<b[^>]*>(.*?)<\/b>/gi, "**$1**");
  md = md.replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*");
  md = md.replace(/<i[^>]*>(.*?)<\/i>/gi, "*$1*");
  md = md.replace(/<code[^>]*>(.*?)<\/code>/gi, "`$1`");
  md = md.replace(/<pre[^>]*>(.*?)<\/pre>/gis, "```\n$1\n```\n");
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)");
  md = md.replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n");
  md = md.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, "> $1\n\n");
  md = md.replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>/gi, "![$1]($2)");
  md = md.replace(/<hr\s*\/?>/gi, "---\n\n");
  md = md.replace(/<[^>]+>/g, "");
  md = md.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  md = md.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
  md = md.replace(/\n{3,}/g, "\n\n").trim();
  return md;
}

export function formatOutput(data, format) {
  switch (format) {
    case "text":
      return data.text || "(no text content)";
    case "html":
      return data.html;
    case "markdown":
      return htmlToMarkdown(data.html);
    case "links":
      return data.links
        .map((l) => `${l.href}  ${l.text ? "| " + l.text : ""}`)
        .join("\n");
    case "json":
      return JSON.stringify(
        { title: data.title, url: data.url, text: data.text, links: data.links, meta: data.meta },
        null,
        2,
      );
    default:
      return data.text;
  }
}

export function formatGoogleResults(results, format) {
  switch (format) {
    case "json":
      return JSON.stringify(results, null, 2);
    case "links":
      return results.map((r) => r.url).join("\n");
    case "text":
      return results
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
        .join("\n\n");
    case "markdown":
      return results
        .map((r, i) => `${i + 1}. [${r.title}](${r.url})\n   > ${r.snippet}`)
        .join("\n\n");
    default:
      return JSON.stringify(results, null, 2);
  }
}
