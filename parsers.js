(function () {
  "use strict";

  const allowedTags = new Set([
    "P", "BR", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI",
    "STRONG", "B", "EM", "I", "U", "S", "BLOCKQUOTE", "PRE", "CODE", "KBD", "SAMP", "VAR", "A", "BUTTON",
    "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "HR", "MARK", "SUB", "SUP",
    "FIGURE", "FIGCAPTION", "IMG", "DIV", "SECTION", "SPAN", "SVG", "G", "PATH", "CIRCLE", "RECT",
    "LINE", "POLYLINE", "POLYGON", "ELLIPSE", "TEXT", "TSPAN", "TITLE", "DESC"
  ]);

  const blockTags = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "BLOCKQUOTE", "PRE", "TABLE", "FIGURE", "SVG", "DIV", "SECTION", "HR"]);
  const svgTags = new Set(["SVG", "G", "PATH", "CIRCLE", "RECT", "LINE", "POLYLINE", "POLYGON", "ELLIPSE", "TEXT", "TSPAN", "TITLE", "DESC"]);
  const informationBlockClasses = ["information-block", "info-block", "callout", "diagram", "mind-map"];
  const safeSvgAttributes = new Set(["viewbox", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "transform", "font-size", "font-family", "font-weight", "text-anchor", "dominant-baseline", "opacity", "role", "aria-label", "preserveaspectratio"]);

  function escapeHTML(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function sanitizeUrl(value) {
    const url = String(value || "").trim();
    if (/^(https?:|mailto:|#)/i.test(url)) return url;
    if (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(url)) return url;
    return "";
  }

  function sanitizeHTML(input, options = {}) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<body>${input || ""}</body>`, "text/html");
    const output = document.createElement("div");

    function clean(node) {
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || "");
      if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();

      const tag = node.tagName.toUpperCase();
      if (["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "OBJECT", "EMBED", "FORM", "META", "LINK"].includes(tag)) {
        return document.createDocumentFragment();
      }

      if (!allowedTags.has(tag)) {
        const fragment = document.createDocumentFragment();
        [...node.childNodes].forEach((child) => fragment.append(clean(child)));
        return fragment;
      }

      const isReviewMark = tag === "MARK" && node.hasAttribute("data-review-id");
      const isTextHighlight = tag === "MARK" && node.classList.contains("text-highlight");
      const isInsertionAnchor = tag === "SPAN" && node.classList.contains("insertion-anchor") && node.hasAttribute("data-review-id");
      const isInsertionLabel = tag === "SPAN" && node.classList.contains("insertion-anchor-label") && node.parentElement?.classList.contains("insertion-anchor");
      const isInsertionRemove = tag === "BUTTON" && node.classList.contains("insertion-anchor-remove") && node.parentElement?.classList.contains("insertion-anchor");
      const isInformationBlock = tag === "DIV" && (node.hasAttribute("data-review-block") || informationBlockClasses.some((name) => node.classList.contains(name)));
      const isPdfPage = tag === "SECTION" && node.classList.contains("pdf-page") && /^\d+$/.test(node.getAttribute("data-pdf-page") || "");
      const isSyntaxToken = tag === "SPAN" && node.classList.contains("syntax-token");

      if (isReviewMark && !options.keepReviewMarks) {
        const fragment = document.createDocumentFragment();
        [...node.childNodes].forEach((child) => fragment.append(clean(child)));
        return fragment;
      }
      if (isInsertionAnchor && !options.keepReviewMarks) return document.createDocumentFragment();
      if (isSyntaxToken) {
        const fragment = document.createDocumentFragment();
        [...node.childNodes].forEach((child) => fragment.append(clean(child)));
        return fragment;
      }
      if (tag === "BUTTON" && !isInsertionRemove) {
        const fragment = document.createDocumentFragment();
        [...node.childNodes].forEach((child) => fragment.append(clean(child)));
        return fragment;
      }

      const normalizedTag = tag === "DIV" && !isInformationBlock ? "p" : tag.toLowerCase();
      const element = svgTags.has(tag)
        ? document.createElementNS("http://www.w3.org/2000/svg", normalizedTag)
        : document.createElement(normalizedTag);
      if (tag === "A") {
        const href = sanitizeUrl(node.getAttribute("href"));
        if (href) {
          element.setAttribute("href", href);
          element.setAttribute("rel", "noreferrer noopener");
        }
      }
      if (tag === "IMG") {
        const src = sanitizeUrl(node.getAttribute("src"));
        if (!src || (!src.startsWith("data:") && options.localImagesOnly !== false)) {
          return document.createTextNode(node.getAttribute("alt") ? `[Image: ${node.getAttribute("alt")}]` : "[Image omitted]");
        }
        element.setAttribute("src", src);
        element.setAttribute("alt", node.getAttribute("alt") || "Imported image");
      }
      if (["TD", "TH"].includes(tag)) {
        const colspan = node.getAttribute("colspan");
        const rowspan = node.getAttribute("rowspan");
        if (/^\d+$/.test(colspan || "")) element.setAttribute("colspan", colspan);
        if (/^\d+$/.test(rowspan || "")) element.setAttribute("rowspan", rowspan);
      }
      if (svgTags.has(tag)) {
        [...node.attributes].forEach((attribute) => {
          const name = attribute.name.toLowerCase();
          const value = attribute.value.trim();
          if (!safeSvgAttributes.has(name) || /javascript:|url\s*\(|[<>]/i.test(value)) return;
          const outputName = name === "viewbox" ? "viewBox" : name === "preserveaspectratio" ? "preserveAspectRatio" : attribute.name;
          element.setAttribute(outputName, value);
        });
        if (tag === "SVG") {
          element.classList.add("reviewable-diagram");
          element.setAttribute("role", "img");
          if (!element.getAttribute("aria-label")) element.setAttribute("aria-label", node.querySelector("title")?.textContent?.trim() || "Diagram");
        }
      }
      if (["PRE", "CODE"].includes(tag)) {
        const language = node.getAttribute("data-language") || [...node.classList].find((name) => name.startsWith("language-"))?.slice(9);
        if (/^[a-z0-9_+#.-]{1,30}$/i.test(language || "")) element.setAttribute("data-language", language);
      }
      if (isInformationBlock) {
        element.className = "information-block";
        element.setAttribute("data-review-block", "information");
      }
      if (isPdfPage) {
        element.className = "pdf-page";
        element.setAttribute("data-pdf-page", node.getAttribute("data-pdf-page"));
      }
      if (isReviewMark && options.keepReviewMarks) {
        const reviewId = node.getAttribute("data-review-id");
        const status = node.getAttribute("data-status");
        if (reviewId) element.setAttribute("data-review-id", reviewId);
        if (status) element.setAttribute("data-status", status);
        element.className = "review-highlight";
      }
      if (isTextHighlight && !isReviewMark) {
        const color = node.getAttribute("data-highlight-color");
        element.className = "text-highlight";
        element.setAttribute("data-highlight-color", ["yellow", "green", "blue", "pink"].includes(color) ? color : "yellow");
      }
      if (isInsertionAnchor && options.keepReviewMarks) {
        const reviewId = node.getAttribute("data-review-id");
        const status = node.getAttribute("data-status");
        element.className = "insertion-anchor";
        element.setAttribute("data-review-id", reviewId);
        element.setAttribute("data-status", status === "resolved" ? "resolved" : "open");
        element.setAttribute("contenteditable", "false");
        element.setAttribute("aria-label", "Insertion review anchor");
      }
      if (isInsertionLabel) element.className = "insertion-anchor-label";
      if (isInsertionRemove) {
        element.className = "insertion-anchor-remove";
        element.setAttribute("type", "button");
        element.setAttribute("contenteditable", "false");
        element.setAttribute("aria-label", "Delete insertion review");
      }
      [...node.childNodes].forEach((child) => element.append(clean(child)));
      if (isReviewMark && element.querySelector("table, pre, figure, img, svg, .information-block")) element.classList.add("block-review-highlight");
      return element;
    }

    [...doc.body.childNodes].forEach((node) => output.append(clean(node)));

    [...output.querySelectorAll("p")].forEach((paragraph) => {
      if (!paragraph.textContent.trim() && !paragraph.querySelector("img, br")) paragraph.remove();
    });
    return output.innerHTML;
  }

  function inlineMarkdown(value) {
    const source = String(value || "");
    const codeTokens = [];
    let protectedText = "";
    let cursor = 0;
    while (cursor < source.length) {
      const start = source.indexOf("`", cursor);
      if (start < 0) { protectedText += source.slice(cursor); break; }
      if (start > 0 && source[start - 1] === "\\") {
        protectedText += source.slice(cursor, start - 1) + "`";
        cursor = start + 1;
        continue;
      }
      let runEnd = start;
      while (source[runEnd] === "`") runEnd += 1;
      const delimiter = source.slice(start, runEnd);
      let close = source.indexOf(delimiter, runEnd);
      while (close >= 0 && (source[close - 1] === "`" || source[close + delimiter.length] === "`")) close = source.indexOf(delimiter, close + delimiter.length);
      if (close < 0) {
        protectedText += source.slice(cursor, runEnd);
        cursor = runEnd;
        continue;
      }
      protectedText += source.slice(cursor, start);
      const token = `\uE000${codeTokens.length}\uE001`;
      const code = source.slice(runEnd, close).replace(/\s+/g, " ").replace(/^ (.*) $/, "$1");
      codeTokens.push(`<code>${escapeHTML(code)}</code>`);
      protectedText += token;
      cursor = close + delimiter.length;
    }
    let text = escapeHTML(protectedText);
    text = text
      .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<span>[Image: $1]</span>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|#[^\s)]+)\)/g, '<a href="$2" rel="noreferrer noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/~~([^~]+)~~/g, "<s>$1</s>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
    codeTokens.forEach((code, index) => { text = text.replaceAll(`\uE000${index}\uE001`, code); });
    return text;
  }

  function isTableDivider(line) {
    return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
  }

  function splitTableRow(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  }

  function markdownToHtml(markdown = "") {
    const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
    const html = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) { index += 1; continue; }

      const fence = line.match(/^\s*(`{3,}|~{3,})\s*([^`~]*)$/);
      if (fence) {
        const code = [];
        const fenceChar = fence[1][0];
        const closingFence = new RegExp(`^\\s*${fenceChar}{${fence[1].length},}\\s*$`);
        const language = fence[2].trim().split(/\s+/)[0].replace(/[^a-z0-9_+#.-]/gi, "").slice(0, 30);
        index += 1;
        while (index < lines.length && !closingFence.test(lines[index])) code.push(lines[index++]);
        if (index < lines.length) index += 1;
        const languageAttribute = language ? ` data-language="${escapeHTML(language)}"` : "";
        html.push(`<pre${languageAttribute}><code${languageAttribute}>${escapeHTML(code.join("\n"))}</code></pre>`);
        continue;
      }

      if (/^( {4}|\t)/.test(line)) {
        const code = [];
        while (index < lines.length && (/^( {4}|\t)/.test(lines[index]) || !lines[index].trim())) {
          code.push(lines[index].replace(/^( {4}|\t)/, ""));
          index += 1;
        }
        while (code.length && !code.at(-1).trim()) code.pop();
        html.push(`<pre><code>${escapeHTML(code.join("\n"))}</code></pre>`);
        continue;
      }

      if (index + 1 < lines.length && line.includes("|") && isTableDivider(lines[index + 1])) {
        const headers = splitTableRow(line);
        index += 2;
        const rows = [];
        while (index < lines.length && lines[index].includes("|") && lines[index].trim()) rows.push(splitTableRow(lines[index++]));
        html.push(`<table><thead><tr>${headers.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        const level = Math.min(3, heading[1].length);
        html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
        index += 1;
        continue;
      }

      if (/^\s*(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) {
        html.push("<hr>");
        index += 1;
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        const quote = [];
        while (index < lines.length && /^\s*>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/, ""));
        html.push(`<blockquote>${quote.map(inlineMarkdown).join("<br>")}</blockquote>`);
        continue;
      }

      const unordered = line.match(/^\s*[-+*]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (unordered || ordered) {
        const tag = unordered ? "ul" : "ol";
        const pattern = unordered ? /^\s*[-+*]\s+(.+)$/ : /^\s*\d+[.)]\s+(.+)$/;
        const items = [];
        while (index < lines.length) {
          const match = lines[index].match(pattern);
          if (!match) break;
          items.push(`<li>${inlineMarkdown(match[1])}</li>`);
          index += 1;
        }
        html.push(`<${tag}>${items.join("")}</${tag}>`);
        continue;
      }

      const paragraph = [line.trim()];
      index += 1;
      while (index < lines.length && lines[index].trim() &&
        !/^(#{1,6})\s+/.test(lines[index]) &&
        !/^\s*([-+*]\s+|\d+[.)]\s+|>\s?|`{3,}|~{3,})/.test(lines[index]) &&
        !(index + 1 < lines.length && lines[index].includes("|") && isTableDivider(lines[index + 1]))) {
        paragraph.push(lines[index].trim());
        index += 1;
      }
      html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    }

    return sanitizeHTML(html.join(""));
  }

  function looksLikeMarkdown(text = "") {
    const signals = [
      /^#{1,6}\s+\S/m,
      /^\s*[-*+]\s+\S/m,
      /^\s*\d+[.)]\s+\S/m,
      /\*\*[^*]+\*\*/,
      /`+[^\n]+`+/,
      /\[[^\]]+\]\([^)]+\)/,
      /^(?:```|~~~)/m,
      /^(?: {4}|\t)\S/m,
      /^>\s+\S/m,
      /^\|.+\|\s*$/m
    ];
    if (/`+[^\n]+`+/.test(text) || /^(?:```|~~~)/m.test(text) || /^(?: {4}|\t)\S/m.test(text)) return true;
    return signals.filter((pattern) => pattern.test(text)).length >= 2;
  }

  function textToHtml(text = "") {
    const normalized = String(text).replace(/\r\n?/g, "\n").trim();
    if (!normalized) return "";
    return normalized.split(/\n{2,}/).map((block) => `<p>${escapeHTML(block).replaceAll("\n", "<br>")}</p>`).join("");
  }

  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (char === '"') {
        if (quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
        else quoted = !quoted;
      } else if (char === "," && !quoted) {
        row.push(cell); cell = "";
      } else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && text[i + 1] === "\n") i += 1;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += char;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function csvToHtml(text) {
    const rows = parseCSV(text);
    if (!rows.length) return "";
    const [head, ...body] = rows;
    return `<table><thead><tr>${head.map((cell) => `<th>${escapeHTML(cell)}</th>`).join("")}</tr></thead><tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${escapeHTML(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }

  function rtfToText(rtf = "") {
    return String(rtf)
      .replace(/\\par[d]?\b/g, "\n")
      .replace(/\\tab\b/g, "\t")
      .replace(/\\'[0-9a-fA-F]{2}/g, (match) => String.fromCharCode(parseInt(match.slice(2), 16)))
      .replace(/\\u(-?\d+)\??/g, (_, value) => String.fromCharCode(Number(value) < 0 ? Number(value) + 65536 : Number(value)))
      .replace(/\\[a-zA-Z]+-?\d*\s?/g, "")
      .replace(/[{}]/g, "")
      .replace(/\\([{}\\])/g, "$1")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function xmlToHtml(text) {
    const parsed = new DOMParser().parseFromString(text, "application/xml");
    if (parsed.querySelector("parsererror")) return `<pre><code>${escapeHTML(text)}</code></pre>`;
    const serialized = new XMLSerializer().serializeToString(parsed);
    const pretty = serialized.replace(/></g, ">\n<");
    return `<pre><code>${escapeHTML(pretty)}</code></pre>`;
  }

  function nodeToMarkdown(node, depth = 0) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const children = [...node.childNodes].map((child) => nodeToMarkdown(child, depth + 1)).join("");
    switch (node.tagName.toLowerCase()) {
      case "h1": return `# ${children.trim()}\n\n`;
      case "h2": return `## ${children.trim()}\n\n`;
      case "h3": case "h4": case "h5": case "h6": return `### ${children.trim()}\n\n`;
      case "p": return `${children.trim()}\n\n`;
      case "br": return "\n";
      case "strong": case "b": return `**${children}**`;
      case "em": case "i": return `*${children}*`;
      case "s": return `~~${children}~~`;
      case "code": {
        if (node.parentElement?.tagName === "PRE") return children;
        const ticks = children.includes("`") ? "``" : "`";
        return `${ticks}${children}${ticks}`;
      }
      case "kbd": case "samp": case "var": return `\`${children}\``;
      case "pre": {
        const language = node.getAttribute("data-language") || node.querySelector("code")?.getAttribute("data-language") || "";
        return `\`\`\`${language}\n${children.trim()}\n\`\`\`\n\n`;
      }
      case "blockquote": return children.trim().split("\n").map((line) => `> ${line}`).join("\n") + "\n\n";
      case "a": return `[${children}](${node.getAttribute("href") || "#"})`;
      case "li": {
        const ordered = node.parentElement?.tagName === "OL";
        const prefix = ordered ? `${[...node.parentElement.children].indexOf(node) + 1}. ` : "- ";
        return `${prefix}${children.trim()}\n`;
      }
      case "ul": case "ol": return `${children}\n`;
      case "hr": return "---\n\n";
      case "mark": case "div": return children;
      case "span":
        if (node.classList.contains("insertion-anchor") && node.dataset.reviewId) {
          return `\n\n[INSERTION_REVIEW:${node.dataset.reviewId}]\n\n`;
        }
        return children;
      case "svg": return `[Diagram: ${node.getAttribute("aria-label") || "Diagram"}]\n\n`;
      case "table": {
        const rows = [...node.querySelectorAll("tr")].map((row) => [...row.children].map((cell) => cell.textContent.trim().replaceAll("|", "\\|")));
        if (!rows.length) return "";
        const width = Math.max(...rows.map((row) => row.length));
        const normalized = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill("")]);
        return `| ${normalized[0].join(" | ")} |\n| ${Array(width).fill("---").join(" | ")} |\n${normalized.slice(1).map((row) => `| ${row.join(" | ")} |`).join("\n")}\n\n`;
      }
      default: return children;
    }
  }

  function htmlToMarkdown(html = "") {
    const container = document.createElement("div");
    container.innerHTML = sanitizeHTML(html, { keepReviewMarks: true, localImagesOnly: false });
    return [...container.childNodes].map((node) => nodeToMarkdown(node)).join("").replace(/\n{3,}/g, "\n\n").trim();
  }

  function readUint32(view, offset) { return view.getUint32(offset, true); }
  function readUint16(view, offset) { return view.getUint16(offset, true); }

  async function unzipEntry(buffer, targetName) {
    const view = new DataView(buffer);
    let eocd = -1;
    const floor = Math.max(0, buffer.byteLength - 65557);
    for (let i = buffer.byteLength - 22; i >= floor; i -= 1) {
      if (readUint32(view, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("This does not appear to be a valid .docx file.");
    const entries = readUint16(view, eocd + 10);
    let cursor = readUint32(view, eocd + 16);
    const decoder = new TextDecoder();

    for (let i = 0; i < entries; i += 1) {
      if (readUint32(view, cursor) !== 0x02014b50) break;
      const method = readUint16(view, cursor + 10);
      const compressedSize = readUint32(view, cursor + 20);
      const nameLength = readUint16(view, cursor + 28);
      const extraLength = readUint16(view, cursor + 30);
      const commentLength = readUint16(view, cursor + 32);
      const localOffset = readUint32(view, cursor + 42);
      const name = decoder.decode(new Uint8Array(buffer, cursor + 46, nameLength));
      if (name === targetName) {
        const localNameLength = readUint16(view, localOffset + 26);
        const localExtraLength = readUint16(view, localOffset + 28);
        const dataStart = localOffset + 30 + localNameLength + localExtraLength;
        const compressed = new Uint8Array(buffer.slice(dataStart, dataStart + compressedSize));
        if (method === 0) return decoder.decode(compressed);
        if (method === 8 && "DecompressionStream" in window) {
          const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
          return decoder.decode(await new Response(stream).arrayBuffer());
        }
        throw new Error("This browser cannot decompress this Word file. Use a current Chrome, Edge, or Safari browser.");
      }
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    throw new Error(`The Word file is missing ${targetName}.`);
  }

  function docxParagraphToHtml(paragraph) {
    const style = paragraph.getElementsByTagName("w:pStyle")[0]?.getAttribute("w:val") || "";
    const runs = [...paragraph.getElementsByTagName("w:r")];
    let content = "";
    runs.forEach((run) => {
      let runText = "";
      [...run.childNodes].forEach((child) => {
        if (child.localName === "t") runText += escapeHTML(child.textContent || "");
        if (child.localName === "tab") runText += "&emsp;";
        if (child.localName === "br") runText += "<br>";
      });
      const props = run.getElementsByTagName("w:rPr")[0];
      if (props?.getElementsByTagName("w:b").length) runText = `<strong>${runText}</strong>`;
      if (props?.getElementsByTagName("w:i").length) runText = `<em>${runText}</em>`;
      if (props?.getElementsByTagName("w:u").length) runText = `<u>${runText}</u>`;
      content += runText;
    });
    if (!content) content = escapeHTML(paragraph.textContent || "");
    if (!content.trim()) return "";
    if (/heading\s*1/i.test(style)) return `<h1>${content}</h1>`;
    if (/heading\s*2/i.test(style)) return `<h2>${content}</h2>`;
    if (/heading\s*[3-9]/i.test(style)) return `<h3>${content}</h3>`;
    if (/title/i.test(style)) return `<h1>${content}</h1>`;
    if (/quote/i.test(style)) return `<blockquote>${content}</blockquote>`;
    return `<p>${content}</p>`;
  }

  function docxTableToHtml(table) {
    const rows = [...table.childNodes].filter((node) => node.localName === "tr");
    return `<table><tbody>${rows.map((row) => {
      const cells = [...row.childNodes].filter((node) => node.localName === "tc");
      return `<tr>${cells.map((cell) => `<td>${[...cell.childNodes].filter((node) => node.localName === "p").map(docxParagraphToHtml).join("")}</td>`).join("")}</tr>`;
    }).join("")}</tbody></table>`;
  }

  async function docxToHtml(buffer) {
    const xml = await unzipEntry(buffer, "word/document.xml");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("The Word document XML could not be read.");
    const body = doc.getElementsByTagName("w:body")[0];
    if (!body) throw new Error("The Word document has no readable body.");
    const html = [...body.childNodes].map((node) => {
      if (node.localName === "p") return docxParagraphToHtml(node);
      if (node.localName === "tbl") return docxTableToHtml(node);
      return "";
    }).join("");
    return sanitizeHTML(html);
  }

  async function fileToDocument(file) {
    const extension = file.name.split(".").pop().toLowerCase();
    const title = file.name.replace(/\.[^.]+$/, "") || "Imported document";
    if (extension === "docx") return { title, html: await docxToHtml(await file.arrayBuffer()), format: "Word (.docx)" };
    const text = await file.text();
    if (["md", "markdown"].includes(extension)) return { title, html: markdownToHtml(text), format: "Markdown" };
    if (["html", "htm"].includes(extension)) return { title, html: sanitizeHTML(text), format: "HTML" };
    if (extension === "rtf") return { title, html: textToHtml(rtfToText(text)), format: "RTF" };
    if (extension === "csv") return { title, html: csvToHtml(text), format: "CSV" };
    if (extension === "json") {
      let formatted = text;
      try { formatted = JSON.stringify(JSON.parse(text), null, 2); } catch (_) { /* Keep original text. */ }
      return { title, html: `<pre><code>${escapeHTML(formatted)}</code></pre>`, format: "JSON" };
    }
    if (extension === "xml") return { title, html: xmlToHtml(text), format: "XML" };
    if (extension === "pdf") throw new Error("The PDF importer is not loaded. Restart Margin and try again.");
    if (["doc", "pages", "odt"].includes(extension)) throw new Error(`.${extension} import is not available without an external converter. Save it as .docx, .html, .md, or .txt first.`);
    return { title, html: looksLikeMarkdown(text) ? markdownToHtml(text) : textToHtml(text), format: looksLikeMarkdown(text) ? "Markdown text" : "Plain text" };
  }

  window.MarginParsers = {
    escapeHTML,
    sanitizeHTML,
    markdownToHtml,
    htmlToMarkdown,
    textToHtml,
    looksLikeMarkdown,
    csvToHtml,
    rtfToText,
    docxToHtml,
    fileToDocument,
    blockTags
  };
})();
