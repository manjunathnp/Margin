(function (root) {
  "use strict";

  function escapeHTML(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function median(values, fallback = 12) {
    if (!values.length) return fallback;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function normalizeText(value) {
    return String(value || "").replace(/[\u00a0\t]+/g, " ").replace(/\s+/g, " ");
  }

  function itemHeight(item) {
    return Math.abs(Number(item.height)) || Math.abs(Number(item.transform?.[3])) || 10;
  }

  function segmentFromItem(item, styles) {
    const text = normalizeText(item.str);
    const x = Number(item.transform?.[4]) || 0;
    const height = itemHeight(item);
    const width = Number(item.width) || text.length * height * 0.45;
    const fontFamily = String(styles?.[item.fontName]?.fontFamily || "").toLowerCase();
    return {
      text,
      x,
      width,
      endX: x + width,
      height,
      fontName: String(item.fontName || ""),
      fontFamily,
      isMonospace: /mono|courier|menlo|consolas|code/.test(fontFamily),
      hasEOL: item.hasEOL === true,
      leadingSpace: false
    };
  }

  function finalizeLine(line) {
    const visible = line.segments.filter((segment) => segment.text);
    if (!visible.length) return null;
    const totalCharacters = visible.reduce((sum, segment) => sum + segment.text.length, 0) || 1;
    const monoCharacters = visible.reduce((sum, segment) => sum + (segment.isMonospace ? segment.text.length : 0), 0);
    const sansCharacters = visible.reduce((sum, segment) => sum + (/sans/.test(segment.fontFamily) ? segment.text.length : 0), 0);
    const serifCharacters = visible.reduce((sum, segment) => sum + (/serif/.test(segment.fontFamily) && !/sans/.test(segment.fontFamily) && !segment.isMonospace ? segment.text.length : 0), 0);
    return {
      ...line,
      segments: visible,
      text: visible.map((segment) => `${segment.leadingSpace ? " " : ""}${segment.text}`).join("").trim(),
      startX: Math.min(...visible.map((segment) => segment.x)),
      endX: Math.max(...visible.map((segment) => segment.endX)),
      height: Math.max(...visible.map((segment) => segment.height)),
      monoRatio: monoCharacters / totalCharacters,
      sansRatio: sansCharacters / totalCharacters,
      serifRatio: serifCharacters / totalCharacters
    };
  }

  function textItemsToLines(items = [], styles = {}) {
    const lines = [];
    let current = null;

    items.filter((item) => typeof item.str === "string" && item.str.trim()).forEach((item) => {
      const segment = segmentFromItem(item, styles);
      const y = Number(item.transform?.[5]) || 0;
      const tolerance = Math.max(2, Math.min(segment.height, current?.height || segment.height) * 0.34);
      if (!current || Math.abs(y - current.y) > tolerance || segment.x + 2 < current.startX) {
        const complete = current && finalizeLine(current);
        if (complete) lines.push(complete);
        current = { y, startX: segment.x, endX: segment.x, height: segment.height, segments: [] };
      }

      const previous = current.segments.at(-1);
      const gap = previous ? segment.x - previous.endX : 0;
      segment.leadingSpace = Boolean(previous)
        && !/\s$/.test(previous.text)
        && !/^[,.;:!?)}\]]/.test(segment.text)
        && (previous.hasEOL || gap > Math.max(1.5, current.height * 0.12));
      current.segments.push(segment);
      current.startX = Math.min(current.startX, segment.x);
      current.endX = Math.max(current.endX, segment.endX);
      current.height = Math.max(current.height, segment.height);
    });

    const complete = current && finalizeLine(current);
    if (complete) lines.push(complete);
    return lines;
  }

  function pageMetrics(lines) {
    const serifSegments = lines.flatMap((line) => line.segments).filter((segment) => /serif/.test(segment.fontFamily) && !/sans/.test(segment.fontFamily) && !segment.isMonospace);
    const bodySegments = serifSegments.length ? serifSegments : lines.flatMap((line) => line.segments).filter((segment) => !segment.isMonospace);
    const normalHeight = median(bodySegments.map((segment) => segment.height).filter(Boolean), median(lines.map((line) => line.height), 12));
    const bodyLeft = median(
      lines.filter((line) => line.serifRatio >= 0.55 && line.height <= normalHeight * 1.2).map((line) => line.startX),
      Math.min(...lines.map((line) => line.startX))
    );
    return { normalHeight, bodyLeft };
  }

  function lineGap(first, second) {
    return first && second ? Math.abs(first.y - second.y) : 0;
  }

  function lineToInlineHtml(line) {
    return line.segments.map((segment) => {
      const content = escapeHTML(segment.text);
      const wrapped = segment.isMonospace ? `<code>${content}</code>` : content;
      return `${segment.leadingSpace ? " " : ""}${wrapped}`;
    }).join("");
  }

  function candidateAnchors(line) {
    if (!line || line.monoRatio > 0.7 || line.segments.length < 2) return null;
    const starts = [...line.segments].sort((a, b) => a.x - b.x).map((segment) => segment.x);
    const anchors = [];
    starts.forEach((x) => {
      if (!anchors.length || x - anchors.at(-1) >= 24) anchors.push(x);
    });
    return anchors.length >= 2 && anchors.length <= 8 ? anchors : null;
  }

  function nearestAnchor(x, anchors, tolerance = 12) {
    let best = -1;
    let distance = Infinity;
    anchors.forEach((anchor, index) => {
      const current = Math.abs(x - anchor);
      if (current < distance) {
        distance = current;
        best = index;
      }
    });
    return distance <= tolerance ? best : -1;
  }

  function detectTable(lines, start, metrics) {
    const anchors = candidateAnchors(lines[start]);
    if (!anchors) return null;
    const tableLines = [];
    let previous = null;

    for (let index = start; index < lines.length; index += 1) {
      const line = lines[index];
      if (previous && lineGap(previous, line) > Math.max(34, metrics.normalHeight * 3.3)) break;
      const assignments = line.segments.map((segment) => nearestAnchor(segment.x, anchors));
      if (assignments.some((column) => column < 0)) break;
      tableLines.push({ line, assignments, index });
      previous = line;
    }

    const rowStarts = tableLines.filter(({ assignments }) => assignments.includes(0));
    const multiColumnRows = tableLines.filter(({ assignments }) => new Set(assignments).size >= 2);
    if (rowStarts.length < 3 || multiColumnRows.length < 2) return null;

    const rows = [];
    let row = null;
    tableLines.forEach(({ line, assignments }) => {
      if (assignments.includes(0) || !row) {
        row = Array.from({ length: anchors.length }, () => []);
        rows.push(row);
      }
      line.segments.forEach((segment, segmentIndex) => {
        const column = assignments[segmentIndex];
        const prefix = segment.leadingSpace && row[column].length ? " " : "";
        row[column].push(`${prefix}${segment.text}`);
      });
    });

    const cellHtml = (parts) => escapeHTML(parts.join(" ").replace(/\s+/g, " ").trim());
    const [header, ...body] = rows;
    const html = [
      "<table><thead><tr>",
      ...header.map((cell) => `<th>${cellHtml(cell)}</th>`),
      "</tr></thead><tbody>",
      ...body.map((cells) => `<tr>${cells.map((cell) => `<td>${cellHtml(cell)}</td>`).join("")}</tr>`),
      "</tbody></table>"
    ].join("");
    return { html, next: tableLines.at(-1).index + 1 };
  }

  function isCodeLine(line) {
    return Boolean(line?.text) && line.monoRatio >= 0.82;
  }

  function codeSignal(text) {
    return /[{}()[\];]|=>|\b(const|let|var|def|class|import|SELECT|FROM|curl|npm|node|git)\b|^\s*["'][\w.-]+["']\s*:/.test(text);
  }

  function detectCodeLanguage(source) {
    const text = String(source || "");
    if (/^\s*[\[{][\s\S]*[\]}]\s*$/.test(text) && /"[^"\n]+"\s*:/.test(text)) return "json";
    if (/<\/?[A-Za-z][^>]*>/.test(text)) return "html";
    if (/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|FROM|WHERE|JOIN)\b/i.test(text)) return "sql";
    if (/^\s*(def |class |from \w+ import |import \w+)|\b(None|True|False)\b/m.test(text)) return "python";
    if (/\b(const|let|var|async|await|function|expect)\b|=>/.test(text)) return "javascript";
    if (/^\s*(curl|npm|node|git|cd|mkdir|docker)\b/m.test(text)) return "bash";
    if (/^[^{\n]+\{[\s\S]*:[^;]+;/m.test(text)) return "css";
    return "plain";
  }

  function detectCodeBlock(lines, start, metrics) {
    if (!isCodeLine(lines[start])) return null;
    const codeLines = [lines[start]];
    let index = start + 1;
    while (index < lines.length && isCodeLine(lines[index])) {
      if (lineGap(lines[index - 1], lines[index]) > Math.max(32, metrics.normalHeight * 3.2)) break;
      codeLines.push(lines[index]);
      index += 1;
    }
    if (codeLines.length < 2 && !codeSignal(codeLines[0].text)) return null;

    const left = Math.min(...codeLines.map((line) => line.startX));
    const charWidth = median(codeLines.flatMap((line) => line.segments).filter((segment) => segment.isMonospace && segment.text).map((segment) => segment.width / segment.text.length), 6);
    const source = codeLines.map((line, lineIndex) => {
      const indent = " ".repeat(Math.max(0, Math.round((line.startX - left) / Math.max(1, charWidth))));
      const previous = codeLines[lineIndex - 1];
      const blank = previous && lineGap(previous, line) > metrics.normalHeight * 1.85 ? "\n" : "";
      return `${blank}${indent}${line.text}`;
    }).join("\n");
    const language = detectCodeLanguage(source);
    return {
      html: `<pre data-language="${language}"><code data-language="${language}">${escapeHTML(source)}</code></pre>`,
      next: index
    };
  }

  function isHeading(line, metrics) {
    if (!line?.text || line.text.length > 180 || line.monoRatio > 0.55) return false;
    const leftAligned = line.startX <= metrics.bodyLeft + 6;
    const large = line.height >= metrics.normalHeight * 1.28;
    const smallSansHeading = leftAligned && line.sansRatio >= 0.72 && line.height >= metrics.normalHeight * 1.06;
    return large || smallSansHeading;
  }

  function headingHtml(line, metrics) {
    const level = line.height >= metrics.normalHeight * 1.65 ? 2 : 3;
    return `<h${level}>${escapeHTML(line.text)}</h${level}>`;
  }

  function explicitListType(line) {
    if (/^\s*\d+[.)]\s+/.test(line.text)) return "ol";
    if (/^\s*[•◦▪‣*-]\s+/.test(line.text)) return "ul";
    return "";
  }

  function inferredListStart(line, metrics) {
    return line.startX >= metrics.bodyLeft + 14
      && line.segments.length >= 2
      && line.segments[0].isMonospace
      && line.monoRatio < 0.72;
  }

  function stripListPrefix(line) {
    const html = lineToInlineHtml(line);
    return html.replace(/^\s*(?:\d+[.)]|[•◦▪‣*-])\s+/, "");
  }

  function detectList(lines, start, metrics) {
    const firstType = explicitListType(lines[start]);
    if (!firstType && !inferredListStart(lines[start], metrics)) return null;
    const items = [];
    let current = null;
    let index = start;
    let type = firstType || "ul";

    while (index < lines.length) {
      const line = lines[index];
      const explicit = explicitListType(line);
      const inferred = inferredListStart(line, metrics);
      const previous = lines[index - 1];
      if (index > start && lineGap(previous, line) > metrics.normalHeight * 2.45) break;
      if (explicit || inferred) {
        current = [stripListPrefix(line)];
        items.push(current);
        if (explicit === "ol") type = "ol";
      } else if (current && line.startX >= metrics.bodyLeft + 10 && !isHeading(line, metrics) && !isCodeLine(line)) {
        current.push(lineToInlineHtml(line));
      } else {
        break;
      }
      index += 1;
    }

    if (items.length < 2 && !firstType) return null;
    return { html: `<${type}>${items.map((parts) => `<li>${parts.join(" ")}</li>`).join("")}</${type}>`, next: index };
  }

  function detectCallout(lines, start, metrics) {
    const title = lines[start];
    const next = lines[start + 1];
    if (!title || !next || title.text.length > 100) return null;
    const indented = title.startX >= metrics.bodyLeft + 10;
    const titleLike = title.sansRatio >= 0.7 && title.height <= metrics.normalHeight * 1.15;
    const bodyAligned = next.startX >= title.startX - 3 && next.startX <= title.startX + 6;
    if (!indented || !titleLike || !bodyAligned || next.monoRatio > 0.5) return null;

    const body = [];
    let index = start + 1;
    while (index < lines.length) {
      const line = lines[index];
      const previous = lines[index - 1];
      if (line.startX < title.startX - 4 || lineGap(previous, line) > metrics.normalHeight * 2.2 || isHeading(line, metrics)) break;
      body.push(lineToInlineHtml(line));
      index += 1;
    }
    if (!body.length) return null;
    return {
      html: `<div class="information-block" data-review-block="information"><strong>${escapeHTML(title.text)}</strong><p>${body.join(" ")}</p></div>`,
      next: index
    };
  }

  function startsStructuredBlock(lines, index, metrics) {
    return Boolean(
      detectTable(lines, index, metrics)
      || detectCodeBlock(lines, index, metrics)
      || detectList(lines, index, metrics)
      || detectCallout(lines, index, metrics)
      || isHeading(lines[index], metrics)
    );
  }

  function linesToHtml(lines = []) {
    if (!lines.length) return "<p><em>No selectable text was found on this page.</em></p>";
    const metrics = pageMetrics(lines);
    const html = [];
    let index = 0;

    while (index < lines.length) {
      const table = detectTable(lines, index, metrics);
      if (table) {
        html.push(table.html);
        index = table.next;
        continue;
      }
      const code = detectCodeBlock(lines, index, metrics);
      if (code) {
        html.push(code.html);
        index = code.next;
        continue;
      }
      const list = detectList(lines, index, metrics);
      if (list) {
        html.push(list.html);
        index = list.next;
        continue;
      }
      const callout = detectCallout(lines, index, metrics);
      if (callout) {
        html.push(callout.html);
        index = callout.next;
        continue;
      }
      if (isHeading(lines[index], metrics)) {
        html.push(headingHtml(lines[index], metrics));
        index += 1;
        continue;
      }

      const paragraph = [lineToInlineHtml(lines[index])];
      let previous = lines[index];
      index += 1;
      while (index < lines.length) {
        const gap = lineGap(previous, lines[index]);
        if (gap > metrics.normalHeight * 1.85 || startsStructuredBlock(lines, index, metrics)) break;
        paragraph.push(lineToInlineHtml(lines[index]));
        previous = lines[index];
        index += 1;
      }
      html.push(`<p>${paragraph.join(" ")}</p>`);
    }

    return html.join("");
  }

  function pageToHtml(items, styles) {
    return linesToHtml(textItemsToLines(items, styles));
  }

  root.MarginPdfStructure = {
    detectCodeLanguage,
    linesToHtml,
    pageToHtml,
    textItemsToLines
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
