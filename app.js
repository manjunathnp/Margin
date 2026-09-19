(function () {
  "use strict";

  const DB = window.MarginDB;
  const P = window.MarginParsers;
  const FI = window.MarginFileImporters;
  const DL = window.MarginDocumentLifecycle;

  const state = {
    documents: [],
    current: null,
    selectedFile: null,
    savedRange: null,
    caretRange: null,
    selectedBlock: null,
    selectedCodeBlock: null,
    editingCodeBlock: null,
    codeHighlightTimer: null,
    legacyRepairDismissedForDocument: false,
    activeReviewMarkerId: null,
    reviewType: "question",
    editingReviewId: null,
    pendingDeleteReviewId: null,
    pendingDeleteDocumentId: null,
    documentMutationBusy: false,
    reviewFilter: "open",
    saveTimer: null,
    storageQueue: DL.createSerialQueue(),
    panelLayout: { libraryWidth: 220, reviewWidth: 320, libraryCollapsed: false, reviewsCollapsed: false }
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const editor = $("#document-editor");
  const titleInput = $("#document-title");
  const selectionActions = $("#selection-actions");
  const blockReviewActions = $("#block-review-actions");
  const codeBlockActions = $("#code-block-actions");
  const reviewMarkerActions = $("#review-marker-actions");
  const composer = $("#review-composer");
  const importDialog = $("#import-dialog");
  const legacyCodeDialog = $("#legacy-code-dialog");
  const deleteDocumentDialog = $("#delete-document-dialog");
  const clearDocumentsDialog = $("#clear-documents-dialog");

  const LEGACY_INLINE_CODE_PATTERN = /%%INLINE(?:\*CODE\*|CODE)(\d+)%%/g;
  const CODE_LANGUAGE_ALIASES = {
    text: "plain", plaintext: "plain", txt: "plain",
    js: "javascript", jsx: "javascript", node: "javascript",
    ts: "typescript", tsx: "typescript",
    py: "python", html5: "html", htm: "html", svg: "xml",
    sh: "bash", shell: "bash", zsh: "bash", ps1: "powershell",
    yml: "yaml", md: "markdown", cxx: "cpp", "c++": "cpp", cs: "csharp", "c#": "csharp",
    golang: "go", rs: "rust", rb: "ruby", kt: "kotlin"
  };
  const CODE_KEYWORDS = {
    javascript: "as async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield",
    typescript: "abstract any as asserts async await boolean break case catch class const constructor continue declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface is keyof let module namespace never new null number object of override private protected public readonly require return set static string super switch symbol this throw true try type typeof undefined unique unknown var void while with yield",
    python: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield",
    java: "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while",
    c: "auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while",
    cpp: "alignas alignof and asm auto bitand bool break case catch char class const constexpr continue default delete do double else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not nullptr operator private protected public register reinterpret_cast return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile wchar_t while",
    csharp: "abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while",
    go: "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var",
    rust: "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while",
    php: "abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile eval exit extends final finally fn for foreach function global goto if implements include instanceof insteadof interface isset list match namespace new or print private protected public readonly require return static switch throw trait try unset use var while xor yield",
    ruby: "alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield",
    swift: "as associatedtype break case catch class continue default defer deinit do else enum extension fallthrough false fileprivate for func guard if import in init inout internal is let nil open operator private protocol public repeat rethrows return self static struct subscript super switch throw throws true try typealias var where while",
    kotlin: "as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while",
    sql: "add all alter and any as asc backup between by case check column constraint create database default delete desc distinct drop exec exists foreign from full group having in index inner insert into is join key left like limit not null on or order outer primary procedure right rownum select set table top truncate union unique update values view where",
    bash: "case do done elif else esac fi for function if in select then time until while",
    powershell: "begin break catch class continue data define do dynamicparam else elseif end enum exit filter finally for foreach from function hidden if in inlinescript parallel param process return sequence static switch throw trap try until using var while workflow",
    r: "break else FALSE for function if Inf NA NaN next NULL repeat return TRUE while",
    markdown: "",
    yaml: "",
    json: "",
    css: "",
    html: "",
    xml: "",
    dockerfile: "add arg cmd copy entrypoint env expose from healthcheck label maintainer onbuild run shell stopsignal user volume workdir"
  };
  const CODE_BUILTINS = new Set("Array Boolean Date Error JSON Map Math Number Object Promise RegExp Set String Symbol console document window fetch require module exports len print range dict list set tuple str int float open self super System String Integer Double List Map println printf fmt make append cap close copy delete len new panic recover complex real imag os sys pathlib true false null undefined None True False echo cd pwd printf Write-Host Get-ChildItem Select-Object Where-Object docker npm node".split(" "));
  const CODE_CONSTANTS = new Set("true false null undefined NaN Infinity None True False nil NULL NA Inf".split(" "));

  function uid(prefix = "id") {
    return `${prefix}_${Date.now().toString(36)}_${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
  }

  function nowISO() { return new Date().toISOString(); }

  function formatRelativeDate(value) {
    const date = new Date(value);
    const difference = Date.now() - date.getTime();
    if (difference < 60_000) return "Just now";
    if (difference < 3_600_000) return `${Math.floor(difference / 60_000)} min ago`;
    if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)} hr ago`;
    if (difference < 604_800_000) return `${Math.floor(difference / 86_400_000)} days ago`;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
  }

  function safeFilename(value, fallback = "document") {
    return (value || fallback).trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").slice(0, 120) || fallback;
  }

  function makeDocument({ title = "Untitled document", html = "", sourceFormat = "Pasted text" } = {}) {
    const timestamp = nowISO();
    return {
      id: uid("doc"),
      title,
      html,
      reviews: [],
      globalInstruction: "",
      sourceFormat,
      createdAt: timestamp,
      updatedAt: timestamp,
      revisionHistory: []
    };
  }

  function showToast(title, message = "") {
    const region = $("#toast-region");
    const toast = document.createElement("div");
    toast.className = "toast";
    const strong = document.createElement("strong");
    strong.textContent = title;
    toast.append(strong);
    if (message) {
      const span = document.createElement("span");
      span.textContent = message;
      toast.append(span);
    }
    region.append(toast);
    setTimeout(() => toast.remove(), 4200);
  }

  function queueStorageWrite(operation) {
    return state.storageQueue.run(operation);
  }

  function setWorkspaceAvailability(available) {
    editor.hidden = !available;
    $("#empty-workspace").hidden = available;
    titleInput.disabled = !available;
    $("#global-instruction").disabled = !available;
    $("#export-review-pack").disabled = !available;
    $$("button, select", $(".format-toolbar")).forEach((control) => { control.disabled = !available; });
    if (available) {
      editor.setAttribute("contenteditable", "true");
      $("#add-review-toolbar").disabled = true;
      $("#add-insertion-toolbar").disabled = true;
      $("#highlight-menu-trigger").disabled = true;
    }
    else editor.removeAttribute("contenteditable");
  }

  function showEmptyWorkspace() {
    clearTimeout(state.saveTimer);
    state.current = null;
    state.savedRange = null;
    state.caretRange = null;
    editor.replaceChildren();
    titleInput.value = "No document selected";
    $("#global-instruction").value = "";
    selectionActions.hidden = true;
    if (!composer.hidden) closeComposer();
    clearSelectedBlock();
    clearCodeBlockSelection();
    closeReviewMarkerActions();
    setWorkspaceAvailability(false);
    updateAllViews();
  }

  function setInlineAlert(element, message, success = false) {
    element.textContent = message;
    element.hidden = false;
    element.classList.toggle("success", success);
  }

  function clearInlineAlert(element) {
    element.hidden = true;
    element.textContent = "";
    element.classList.remove("success");
  }

  function canonicalCodeLanguage(value = "plain") {
    const normalized = String(value).trim().toLowerCase().replace(/^language-/, "") || "plain";
    return CODE_LANGUAGE_ALIASES[normalized] || normalized;
  }

  function syntaxToken(type, value) {
    return '<span class="syntax-token syntax-' + type + '">' + P.escapeHTML(value) + "</span>";
  }

  function highlightMarkupTag(tag) {
    const match = tag.match(/^<(\/?)\s*([\w:-]+)([\s\S]*?)(\/?)>$/);
    if (!match) return syntaxToken("tag", tag);
    let output = syntaxToken("punctuation", "<" + match[1]) + syntaxToken("tag", match[2]);
    const attributes = match[3];
    const attributePattern = /([:@A-Za-z_][\w:.-]*)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/g;
    let cursor = 0;
    let attribute;
    while ((attribute = attributePattern.exec(attributes))) {
      output += P.escapeHTML(attributes.slice(cursor, attribute.index));
      output += syntaxToken("attribute", attribute[1]);
      output += syntaxToken("operator", attribute[2]);
      output += syntaxToken("string", attribute[3]);
      cursor = attribute.index + attribute[0].length;
    }
    output += P.escapeHTML(attributes.slice(cursor));
    return output + syntaxToken("punctuation", match[4] + ">");
  }

  function highlightMarkupSource(source) {
    const pattern = /<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>/g;
    let output = "";
    let cursor = 0;
    let match;
    while ((match = pattern.exec(source))) {
      output += P.escapeHTML(source.slice(cursor, match.index));
      output += match[0].startsWith("<!--") ? syntaxToken("comment", match[0]) : highlightMarkupTag(match[0]);
      cursor = match.index + match[0].length;
    }
    return output + P.escapeHTML(source.slice(cursor));
  }

  function highlightCodeSource(source, language) {
    const lang = canonicalCodeLanguage(language);
    if (lang === "plain") return P.escapeHTML(source);
    if (["html", "xml"].includes(lang)) return highlightMarkupSource(source);
    const keywordWords = (CODE_KEYWORDS[lang] || "").split(/\s+/).filter(Boolean);
    const keywords = new Set(lang === "sql" || lang === "dockerfile" ? keywordWords.map((word) => word.toLowerCase()) : keywordWords);
    const hashComments = new Set(["python", "ruby", "bash", "powershell", "r", "yaml"]);
    let output = "";
    let index = 0;

    while (index < source.length) {
      const rest = source.slice(index);
      if (rest.startsWith("/*")) {
        const end = source.indexOf("*/", index + 2);
        const next = end < 0 ? source.length : end + 2;
        output += syntaxToken("comment", source.slice(index, next));
        index = next;
        continue;
      }
      if (rest.startsWith("//") || (lang === "sql" && rest.startsWith("--")) || (hashComments.has(lang) && rest.startsWith("#"))) {
        const end = source.indexOf("\n", index);
        const next = end < 0 ? source.length : end;
        output += syntaxToken("comment", source.slice(index, next));
        index = next;
        continue;
      }

      const character = source[index];
      if (character === '"' || character === "'" || character === "`") {
        const triple = (character === '"' || character === "'") && source.slice(index, index + 3) === character.repeat(3);
        const delimiter = triple ? character.repeat(3) : character;
        let end = index + delimiter.length;
        while (end < source.length) {
          if (source.slice(end, end + delimiter.length) === delimiter && source[end - 1] !== "\\") {
            end += delimiter.length;
            break;
          }
          end += 1;
        }
        output += syntaxToken("string", source.slice(index, end));
        index = end;
        continue;
      }

      const number = rest.match(/^(?:0x[\da-f]+|0b[01]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i);
      if (number) {
        output += syntaxToken("number", number[0]);
        index += number[0].length;
        continue;
      }

      const identifier = rest.match(/^[$A-Za-z_][\w$-]*/);
      if (identifier) {
        const word = identifier[0];
        const lookup = lang === "sql" || lang === "dockerfile" ? word.toLowerCase() : word;
        const following = source.slice(index + word.length).match(/^\s*([(:])/)?.[1];
        let type = "plain";
        if (keywords.has(lookup)) type = "keyword";
        else if (CODE_CONSTANTS.has(word)) type = "constant";
        else if (CODE_BUILTINS.has(word)) type = "builtin";
        else if ((lang === "css" || lang === "yaml") && following === ":") type = "property";
        else if (following === "(") type = "function";
        else if (word.startsWith("$")) type = "variable";
        output += type === "plain" ? P.escapeHTML(word) : syntaxToken(type, word);
        index += word.length;
        continue;
      }

      if (/^[+\-*\/%=&|!<>?:~^.,;()[\]{}]$/.test(character)) output += syntaxToken(/[()[\]{}.,;]/.test(character) ? "punctuation" : "operator", character);
      else output += P.escapeHTML(character);
      index += 1;
    }
    return output;
  }

  function codeElement(pre) {
    if (!pre) return null;
    let code = pre.querySelector(":scope > code");
    if (!code) {
      code = document.createElement("code");
      code.textContent = pre.textContent || "";
      pre.replaceChildren(code);
    }
    return code;
  }

  function stripCodeHighlight(pre) {
    const code = codeElement(pre);
    if (!code || !code.dataset.highlighted) return;
    const value = code.textContent || "";
    code.textContent = value;
    delete code.dataset.highlighted;
    pre.classList.remove("syntax-highlighted");
  }

  function highlightCodeBlock(pre) {
    if (!pre || pre === state.editingCodeBlock) return;
    const code = codeElement(pre);
    const language = canonicalCodeLanguage(pre.dataset.language || code.dataset.language || "plain");
    pre.dataset.language = language;
    code.dataset.language = language;
    code.innerHTML = highlightCodeSource(code.textContent || "", language);
    code.dataset.highlighted = "true";
    pre.classList.add("syntax-highlighted");
  }

  function highlightAllCodeBlocks() {
    $$("pre", editor).forEach(highlightCodeBlock);
  }

  function selectionOffsetsWithin(root) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null;
    const range = selection.getRangeAt(0);
    const start = document.createRange();
    start.selectNodeContents(root);
    start.setEnd(range.startContainer, range.startOffset);
    const end = document.createRange();
    end.selectNodeContents(root);
    end.setEnd(range.endContainer, range.endOffset);
    return { start: start.toString().length, end: end.toString().length };
  }

  function restoreSelectionOffsets(root, offsets) {
    if (!offsets) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let position = 0;
    let startSet = false;
    let node;
    while ((node = walker.nextNode())) {
      const next = position + node.nodeValue.length;
      if (!startSet && offsets.start <= next) {
        range.setStart(node, Math.max(0, offsets.start - position));
        startSet = true;
      }
      if (offsets.end <= next) {
        range.setEnd(node, Math.max(0, offsets.end - position));
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
      position = next;
    }
  }

  function beginCodeEditing(pre) {
    if (!pre || state.editingCodeBlock === pre) return;
    if (state.editingCodeBlock && state.editingCodeBlock !== pre) finishCodeEditing(state.editingCodeBlock);
    state.editingCodeBlock = pre;
  }

  function scheduleCodeRehighlight(pre) {
    clearTimeout(state.codeHighlightTimer);
    state.codeHighlightTimer = setTimeout(() => {
      if (!pre?.isConnected) return;
      const code = codeElement(pre);
      const offsets = selectionOffsetsWithin(code);
      const wasEditing = state.editingCodeBlock === pre;
      if (wasEditing) state.editingCodeBlock = null;
      highlightCodeBlock(pre);
      if (wasEditing) state.editingCodeBlock = pre;
      restoreSelectionOffsets(code, offsets);
    }, 220);
  }

  function finishCodeEditing(pre = state.editingCodeBlock) {
    if (!pre) return;
    if (state.editingCodeBlock === pre) state.editingCodeBlock = null;
    highlightCodeBlock(pre);
  }

  function syncCodeLanguageControl(pre) {
    const select = $("#code-language");
    const language = canonicalCodeLanguage(pre?.dataset.language || codeElement(pre)?.dataset.language || "plain");
    if (![...select.options].some((option) => option.value === language)) {
      const option = document.createElement("option");
      option.value = language;
      option.textContent = language;
      select.append(option);
    }
    select.value = language;
  }

  function positionCodeBlockActions() {
    const pre = state.selectedCodeBlock;
    if (!pre || codeBlockActions.hidden) return;
    const rect = pre.getBoundingClientRect();
    const width = codeBlockActions.offsetWidth || 420;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2));
    const top = rect.top > 64 ? rect.top - 52 : Math.min(window.innerHeight - 54, rect.bottom + 8);
    codeBlockActions.style.left = left + "px";
    codeBlockActions.style.top = top + "px";
  }

  function selectCodeBlock(pre) {
    if (state.selectedCodeBlock && state.selectedCodeBlock !== pre) state.selectedCodeBlock.classList.remove("code-block-selected");
    state.selectedCodeBlock = pre;
    pre.classList.add("code-block-selected");
    syncCodeLanguageControl(pre);
    codeBlockActions.hidden = false;
    requestAnimationFrame(positionCodeBlockActions);
    requestAnimationFrame(() => beginCodeEditing(pre));
  }

  function clearCodeBlockSelection({ keepHighlight = false } = {}) {
    if (!keepHighlight) finishCodeEditing();
    state.selectedCodeBlock?.classList.remove("code-block-selected");
    state.selectedCodeBlock = null;
    codeBlockActions.hidden = true;
  }

  function collectLegacyCodeTokens() {
    const tokens = new Map();
    const text = editor.textContent || "";
    LEGACY_INLINE_CODE_PATTERN.lastIndex = 0;
    let match;
    while ((match = LEGACY_INLINE_CODE_PATTERN.exec(text))) {
      const token = match[0];
      if (!tokens.has(token)) {
        const start = Math.max(0, match.index - 58);
        const end = Math.min(text.length, match.index + token.length + 58);
        tokens.set(token, { token, index: Number(match[1]), context: text.slice(start, end) });
      }
    }
    return [...tokens.values()].sort((a, b) => a.index - b.index);
  }

  function rangeForTextOffsets(root, startOffset, endOffset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let position = 0;
    let startSet = false;
    let node;
    while ((node = walker.nextNode())) {
      const next = position + node.nodeValue.length;
      if (!startSet && startOffset <= next) {
        range.setStart(node, Math.max(0, startOffset - position));
        startSet = true;
      }
      if (startSet && endOffset <= next) {
        range.setEnd(node, Math.max(0, endOffset - position));
        return range;
      }
      position = next;
    }
    return null;
  }

  function updateLegacyRepairAvailability() {
    const count = collectLegacyCodeTokens().length;
    $("#repair-inline-code").hidden = count === 0;
    return count;
  }

  function openLegacyCodeRepair() {
    const tokens = collectLegacyCodeTokens();
    if (!tokens.length) {
      showToast("No legacy placeholders found");
      return;
    }
    const list = $("#legacy-code-list");
    list.replaceChildren();
    tokens.forEach((item, position) => {
      const field = document.createElement("div");
      field.className = "legacy-code-item";
      const label = document.createElement("label");
      const inputId = "legacy-code-value-" + position;
      label.htmlFor = inputId;
      label.textContent = "Inline code " + (position + 1);
      const context = document.createElement("p");
      context.textContent = item.context.replace(item.token, "[missing inline code]");
      const input = document.createElement("input");
      input.id = inputId;
      input.dataset.legacyToken = item.token;
      input.autocomplete = "off";
      input.placeholder = "Enter the original code value";
      field.append(label, context, input);
      list.append(field);
    });
    clearInlineAlert($("#legacy-code-error"));
    legacyCodeDialog.showModal();
    requestAnimationFrame(() => list.querySelector("input")?.focus());
  }

  function replaceLegacyCodeToken(token, value) {
    let index = (editor.textContent || "").indexOf(token);
    while (index >= 0) {
      const range = rangeForTextOffsets(editor, index, index + token.length);
      if (!range) break;
      const container = range.commonAncestorContainer.nodeType === Node.TEXT_NODE ? range.commonAncestorContainer.parentElement : range.commonAncestorContainer;
      const replacement = container?.closest?.("code") ? document.createTextNode(value) : document.createElement("code");
      replacement.textContent = value;
      range.deleteContents();
      range.insertNode(replacement);
      $$('em:empty, i:empty, strong:empty, span:empty', editor).forEach((element) => element.remove());
      index = (editor.textContent || "").indexOf(token);
    }
  }

  async function applyLegacyCodeRepairs() {
    const inputs = $$('[data-legacy-token]', $("#legacy-code-list"));
    const missing = inputs.find((input) => !input.value.trim());
    if (missing) {
      setInlineAlert($("#legacy-code-error"), "Enter the original value for every inline-code placeholder before applying the repair.");
      missing.focus();
      return;
    }
    inputs.forEach((input) => replaceLegacyCodeToken(input.dataset.legacyToken, input.value.trim()));
    legacyCodeDialog.close();
    state.legacyRepairDismissedForDocument = false;
    updateLegacyRepairAvailability();
    updateAllViews();
    await saveCurrent({ immediate: true });
    showToast("Inline code repaired", inputs.length + " legacy placeholder" + (inputs.length === 1 ? " was" : "s were") + " replaced with editable inline code.");
  }

  function offerLegacyCodeRepair({ automatic = true } = {}) {
    const count = updateLegacyRepairAvailability();
    if (count && automatic && !state.legacyRepairDismissedForDocument && !legacyCodeDialog.open) {
      setTimeout(openLegacyCodeRepair, 120);
    }
  }

  async function saveCurrent({ immediate = false } = {}) {
    if (!state.current) return;
    clearTimeout(state.saveTimer);
    const save = async () => {
      if (!state.current) return;
      $("#save-state").textContent = "Saving...";
      state.current.title = titleInput.value.trim() || "Untitled document";
      state.current.reviews.forEach((review) => {
        if (review.type === "insert") return;
        const mark = findReviewMark(review.id);
        const currentQuote = mark?.innerText?.trim() || mark?.textContent?.trim();
        if (currentQuote) review.quote = currentQuote;
      });
      state.current.html = P.sanitizeHTML(editor.innerHTML, { keepReviewMarks: true, localImagesOnly: false });
      state.current.globalInstruction = $("#global-instruction").value;
      state.current.updatedAt = nowISO();
      const record = structuredClone(state.current);
      try {
        await queueStorageWrite(() => DB.put(record));
        const index = state.documents.findIndex((item) => item.id === record.id);
        if (index >= 0) state.documents[index] = record;
        else if (state.current?.id === record.id) state.documents.unshift(record);
        state.documents.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        if (state.current?.id === record.id) $("#save-state").textContent = "Saved locally";
        renderDocumentList();
      } catch (error) {
        $("#save-state").textContent = "Save failed";
        showToast("Could not save", error.message);
      }
    };
    if (immediate) await save();
    else state.saveTimer = setTimeout(save, 480);
  }

  async function loadDocument(documentId) {
    if (state.current?.id === documentId) return;
    if (state.current) await saveCurrent({ immediate: true });
    const record = await DB.get(documentId);
    if (!record) return;
    state.current = record;
    state.legacyRepairDismissedForDocument = false;
    state.current.reviews ||= [];
    state.current.revisionHistory ||= [];
    titleInput.value = record.title || "Untitled document";
    editor.innerHTML = P.sanitizeHTML(record.html || "", { keepReviewMarks: true, localImagesOnly: false });
    $("#global-instruction").value = record.globalInstruction || "";
    setWorkspaceAvailability(true);
    updateAllViews();
    highlightAllCodeBlocks();
    offerLegacyCodeRepair();
    closeMobilePanels();
  }

  async function createDocument(options = {}) {
    if (state.current) await saveCurrent({ immediate: true });
    const record = makeDocument(options);
    await queueStorageWrite(() => DB.put(record));
    state.documents.unshift(structuredClone(record));
    state.current = record;
    state.legacyRepairDismissedForDocument = false;
    titleInput.value = record.title;
    editor.innerHTML = record.html;
    $("#global-instruction").value = "";
    setWorkspaceAvailability(true);
    updateAllViews();
    highlightAllCodeBlocks();
    offerLegacyCodeRepair();
    requestAnimationFrame(() => editor.focus());
    return record;
  }

  function renderDocumentList() {
    const list = $("#document-list");
    const search = $("#document-search").value.trim().toLowerCase();
    list.replaceChildren();
    const documents = state.documents.filter((doc) => !search || doc.title.toLowerCase().includes(search));
    $("#clear-documents").disabled = state.documents.length === 0;
    if (!documents.length) {
      const empty = document.createElement("p");
      empty.className = "muted-small";
      empty.textContent = search ? "No matching documents." : "No documents yet.";
      list.append(empty);
      return;
    }
    documents.forEach((doc) => {
      const row = document.createElement("div");
      row.className = "document-row";
      const button = document.createElement("button");
      button.type = "button";
      button.className = `document-item${doc.id === state.current?.id ? " active" : ""}`;
      button.dataset.documentId = doc.id;
      const name = document.createElement("strong");
      name.textContent = doc.title || "Untitled document";
      const details = document.createElement("span");
      const openCount = (doc.reviews || []).filter((review) => review.status !== "resolved").length;
      details.textContent = `${formatRelativeDate(doc.updatedAt)}${openCount ? `, ${openCount} review${openCount === 1 ? "" : "s"}` : ""}`;
      button.append(name, details);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "delete-document-button";
      remove.dataset.deleteDocumentId = doc.id;
      remove.setAttribute("aria-label", `Delete ${doc.title || "Untitled document"}`);
      remove.title = `Delete ${doc.title || "Untitled document"}`;
      remove.textContent = "×";
      row.append(button, remove);
      list.append(row);
    });
  }

  function openDeleteDocumentDialog(documentId) {
    const record = state.documents.find((document) => document.id === documentId);
    if (!record || state.documentMutationBusy) return;
    state.pendingDeleteDocumentId = record.id;
    $("#delete-document-title").textContent = record.title || "Untitled document";
    const reviewCount = (record.reviews || []).length;
    $("#delete-document-meta").textContent = `${record.sourceFormat || "Local document"} · Saved ${formatRelativeDate(record.updatedAt)}${reviewCount ? ` · ${reviewCount} review${reviewCount === 1 ? "" : "s"}` : ""}`;
    clearInlineAlert($("#delete-document-error"));
    $("#confirm-delete-document").disabled = false;
    deleteDocumentDialog.showModal();
  }

  async function confirmDeleteDocument() {
    if (state.documentMutationBusy) return;
    const documentId = state.pendingDeleteDocumentId;
    const plan = DL.deletePlan(state.documents, documentId, state.current?.id);
    if (!plan.found) {
      deleteDocumentDialog.close();
      renderDocumentList();
      showToast("Document already removed");
      return;
    }

    state.documentMutationBusy = true;
    const confirmButton = $("#confirm-delete-document");
    confirmButton.disabled = true;
    clearInlineAlert($("#delete-document-error"));
    if (plan.wasCurrent) clearTimeout(state.saveTimer);

    try {
      await state.storageQueue.idle();
      await queueStorageWrite(() => DB.remove(documentId));
      state.documents = plan.remaining;
      if (plan.wasCurrent) {
        state.current = null;
        if (plan.nextDocumentId) await loadDocument(plan.nextDocumentId);
        else showEmptyWorkspace();
      } else {
        renderDocumentList();
      }
      deleteDocumentDialog.close();
      showToast("Document deleted", "Its reviews and instructions were removed with it.");
    } catch (error) {
      setInlineAlert($("#delete-document-error"), `The document could not be deleted. ${error?.message || "Try again."}`);
    } finally {
      state.documentMutationBusy = false;
      confirmButton.disabled = false;
    }
  }

  function openClearDocumentsDialog() {
    if (!state.documents.length || state.documentMutationBusy) return;
    const count = state.documents.length;
    $("#clear-documents-count").textContent = `${count.toLocaleString()} document${count === 1 ? "" : "s"} will be deleted.`;
    $("#clear-documents-confirmation").value = "";
    $("#confirm-clear-documents").disabled = true;
    clearInlineAlert($("#clear-documents-error"));
    clearDocumentsDialog.showModal();
    requestAnimationFrame(() => $("#clear-documents-confirmation").focus());
  }

  async function confirmClearDocuments() {
    if (state.documentMutationBusy || !DL.clearPhraseMatches($("#clear-documents-confirmation").value)) return;
    state.documentMutationBusy = true;
    const confirmButton = $("#confirm-clear-documents");
    confirmButton.disabled = true;
    clearInlineAlert($("#clear-documents-error"));
    clearTimeout(state.saveTimer);

    try {
      await state.storageQueue.idle();
      await queueStorageWrite(() => DB.clear());
      const deletedCount = state.documents.length;
      state.documents = [];
      state.current = null;
      showEmptyWorkspace();
      clearDocumentsDialog.close();
      showToast("Library cleared", `${deletedCount.toLocaleString()} document${deletedCount === 1 ? " was" : "s were"} permanently removed.`);
    } catch (error) {
      setInlineAlert($("#clear-documents-error"), `The library could not be cleared. ${error?.message || "Try again."}`);
    } finally {
      state.documentMutationBusy = false;
      confirmButton.disabled = !DL.clearPhraseMatches($("#clear-documents-confirmation").value);
    }
  }

  function renderOutline() {
    const outline = $("#outline-list");
    outline.replaceChildren();
    const headings = $$(`h1, h2, h3`, editor);
    if (!headings.length) {
      const empty = document.createElement("p");
      empty.className = "muted-small";
      empty.textContent = "Headings appear here.";
      outline.append(empty);
      return;
    }
    headings.forEach((heading, index) => {
      if (!heading.id) heading.id = `heading-${index + 1}`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `outline-item level-${heading.tagName.slice(1)}`;
      button.textContent = heading.textContent.trim() || `Heading ${index + 1}`;
      button.addEventListener("click", () => heading.scrollIntoView({ behavior: "smooth", block: "start" }));
      outline.append(button);
    });
  }

  function updateStats() {
    const text = editor.innerText.trim();
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    const characters = text.length;
    const openReviews = (state.current?.reviews || []).filter((review) => review.status !== "resolved").length;
    $("#word-count").textContent = `${words.toLocaleString()} word${words === 1 ? "" : "s"}`;
    $("#character-count").textContent = `${characters.toLocaleString()} character${characters === 1 ? "" : "s"}`;
    $("#review-count").textContent = `${openReviews} open review${openReviews === 1 ? "" : "s"}`;
    $("#review-summary").textContent = openReviews ? `${openReviews} open review${openReviews === 1 ? "" : "s"}` : "No open reviews";
  }

  function reviewLabel(type) {
    return ({ question: "Question", simplify: "Simplify", rewrite: "Rewrite", verify: "Verify", note: "Note", insert: "Insert here" })[type] || "Review";
  }

  function insertionAnchorLabel(comment = "") {
    const compact = String(comment).replace(/\s+/g, " ").trim();
    if (!compact) return "Insert here";
    return `Insert: ${compact.length > 54 ? `${compact.slice(0, 54).trim()}…` : compact}`;
  }

  function syncInsertionAnchor(review) {
    if (review?.type !== "insert") return;
    const anchor = findReviewMark(review.id);
    if (!anchor) return;
    const label = document.createElement("span");
    label.className = "insertion-anchor-label";
    label.textContent = insertionAnchorLabel(review.comment);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "insertion-anchor-remove";
    remove.contentEditable = "false";
    remove.dataset.reviewId = review.id;
    remove.setAttribute("aria-label", "Delete insertion review");
    remove.title = "Delete this insertion review";
    remove.textContent = "×";
    anchor.replaceChildren(label, remove);
    anchor.title = review.comment;
    anchor.setAttribute("aria-label", `Insertion request: ${review.comment}`);
  }

  function findReviewMark(id) {
    return editor.querySelector(`[data-review-id="${CSS.escape(id)}"]`);
  }

  function activateReview(id, { scroll = false } = {}) {
    $$(".review-card.active").forEach((card) => card.classList.remove("active"));
    $$(".review-highlight.active, .insertion-anchor.active").forEach((mark) => mark.classList.remove("active"));
    const card = $(`.review-card[data-review-id="${CSS.escape(id)}"]`);
    const mark = findReviewMark(id);
    card?.classList.add("active");
    mark?.classList.add("active");
    if (scroll) {
      mark?.scrollIntoView({ behavior: "smooth", block: "center" });
      card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function closeReviewMarkerActions() {
    state.activeReviewMarkerId = null;
    reviewMarkerActions.hidden = true;
  }

  function showReviewMarkerActions(mark) {
    if (!mark?.dataset.reviewId) return;
    state.activeReviewMarkerId = mark.dataset.reviewId;
    reviewMarkerActions.hidden = false;
    const rect = mark.getBoundingClientRect();
    requestAnimationFrame(() => {
      const width = reviewMarkerActions.offsetWidth || 260;
      const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2));
      const top = rect.top > 58 ? rect.top - 46 : Math.min(window.innerHeight - 50, rect.bottom + 8);
      reviewMarkerActions.style.left = `${left}px`;
      reviewMarkerActions.style.top = `${top}px`;
    });
  }

  async function removeActiveReviewMarker() {
    const mark = state.activeReviewMarkerId ? findReviewMark(state.activeReviewMarkerId) : null;
    if (!mark || mark.classList.contains("insertion-anchor")) {
      closeReviewMarkerActions();
      return;
    }
    unwrapElement(mark);
    closeReviewMarkerActions();
    await saveCurrent({ immediate: true });
    showToast("Review highlight removed", "The review remains available in the review queue.");
  }

  function renderReviews() {
    const list = $("#review-list");
    list.replaceChildren();
    const allReviews = state.current?.reviews || [];
    allReviews.forEach(syncInsertionAnchor);
    const reviews = state.reviewFilter === "open" ? allReviews.filter((review) => review.status !== "resolved") : allReviews;

    if (!reviews.length) {
      const empty = document.createElement("div");
      empty.className = "empty-review-state";
      const mark = document.createElement("span");
      mark.className = "empty-review-mark";
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = "+";
      const heading = document.createElement("h3");
      heading.textContent = state.reviewFilter === "open" && allReviews.length ? "All reviews are resolved" : "No reviews yet";
      const text = document.createElement("p");
      text.textContent = state.reviewFilter === "open" && allReviews.length
        ? "Switch to All to revisit resolved review threads."
        : "Select a sentence or passage in the document, then choose what you want to ask or change.";
      empty.append(mark, heading, text);
      list.append(empty);
      updateStats();
      return;
    }

    reviews.forEach((review) => {
      const originalIndex = allReviews.findIndex((item) => item.id === review.id) + 1;
      const card = document.createElement("article");
      card.className = "review-card";
      card.dataset.reviewId = review.id;
      card.tabIndex = 0;

      const head = document.createElement("div");
      head.className = "review-card-head";
      const kind = document.createElement("span");
      kind.className = "review-kind";
      kind.textContent = review.status === "resolved" ? `${reviewLabel(review.type)} (resolved)` : reviewLabel(review.type);
      const index = document.createElement("span");
      index.className = "review-index";
      index.textContent = `#${originalIndex}`;
      head.append(kind, index);

      const quote = document.createElement("blockquote");
      quote.textContent = review.quote.length > 220 ? `${review.quote.slice(0, 220)}...` : review.quote;
      const comment = document.createElement("p");
      comment.className = "review-card-comment";
      comment.textContent = review.comment;
      card.append(head, quote, comment);

      if (review.replies?.length) {
        const replies = document.createElement("div");
        replies.className = "review-replies";
        review.replies.forEach((reply) => {
          const paragraph = document.createElement("p");
          paragraph.className = "review-reply";
          paragraph.textContent = reply.text;
          replies.append(paragraph);
        });
        card.append(replies);
      }

      const actions = document.createElement("div");
      actions.className = "review-card-actions";
      const edit = actionButton("Edit", "edit-review");
      const followUp = actionButton("Add follow-up", "reply-review");
      const resolve = actionButton(review.status === "resolved" ? "Reopen" : "Resolve", "resolve-review");
      const remove = actionButton("Delete", "delete-review");
      [edit, followUp, resolve, remove].forEach((button) => { button.dataset.reviewId = review.id; });
      actions.append(edit, followUp, resolve, remove);
      card.append(actions);
      card.addEventListener("click", (event) => {
        if (!event.target.closest("button")) activateReview(review.id, { scroll: true });
      });
      list.append(card);
    });
    updateStats();
  }

  function actionButton(label, className) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    return button;
  }

  function updateAllViews() {
    renderDocumentList();
    renderOutline();
    renderReviews();
    updateStats();
  }

  function selectionInsideEditor(selection) {
    if (!selection?.rangeCount || selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer.nodeType === Node.TEXT_NODE ? range.commonAncestorContainer.parentElement : range.commonAncestorContainer;
    return editor.contains(container) && selection.toString().trim().length > 0;
  }

  function rangeInsideEditor(range) {
    if (!range) return false;
    const container = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer;
    return container === editor || editor.contains(container);
  }

  const reviewBlockSelector = "table, pre, figure, img, svg, .information-block, [data-review-block]";

  function reviewBlockName(block) {
    if (!block) return "Block";
    if (block.matches("table")) return "Table";
    if (block.matches("pre")) return "Code block";
    if (block.matches("img")) return "Image";
    if (block.matches("svg")) return "Diagram";
    if (block.matches("figure")) return "Figure";
    if (block.matches(".information-block, [data-review-block]")) return "Information block";
    return "Block";
  }

  function describeReviewBlock(block) {
    const name = reviewBlockName(block);
    if (block?.matches("img")) return `${name}: ${block.getAttribute("alt") || block.getAttribute("aria-label") || "Untitled image"}`;
    if (block?.matches("svg")) return `${name}: ${block.getAttribute("aria-label") || "Untitled diagram"}`;
    const text = block?.innerText?.replace(/\s+/g, " ").trim() || block?.textContent?.replace(/\s+/g, " ").trim() || "";
    return text ? `${name}: ${text.slice(0, 240)}${text.length > 240 ? "…" : ""}` : `${name} selected for review`;
  }

  function positionBlockReviewActions() {
    if (!state.selectedBlock || blockReviewActions.hidden) return;
    const rect = state.selectedBlock.getBoundingClientRect();
    const width = blockReviewActions.offsetWidth || 300;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2));
    const top = rect.top > 58 ? rect.top - 46 : Math.min(window.innerHeight - 50, rect.bottom + 8);
    blockReviewActions.style.left = `${left}px`;
    blockReviewActions.style.top = `${top}px`;
  }

  function clearSelectedBlock() {
    state.selectedBlock?.classList.remove("block-review-target");
    state.selectedBlock = null;
    blockReviewActions.hidden = true;
  }

  function selectReviewBlock(block) {
    clearSelectedBlock();
    state.selectedBlock = block;
    block.classList.add("block-review-target");
    const range = document.createRange();
    range.selectNode(block);
    state.savedRange = range;
    state.caretRange = null;
    selectionActions.hidden = true;
    $("#add-review-toolbar").disabled = false;
    $("#add-insertion-toolbar").disabled = true;
    $("#highlight-menu-trigger").disabled = true;
    $("#block-review-label").textContent = `${reviewBlockName(block)} selected`;
    blockReviewActions.hidden = false;
    requestAnimationFrame(positionBlockReviewActions);
  }

  function updateSelectionToolbar() {
    const selection = window.getSelection();
    if (!composer.hidden) {
      selectionActions.hidden = true;
      return;
    }
    if (state.selectedBlock?.isConnected && !blockReviewActions.hidden) {
      selectionActions.hidden = true;
      return;
    }
    if (!selection?.rangeCount || !rangeInsideEditor(selection.getRangeAt(0))) {
      selectionActions.hidden = true;
      state.savedRange = null;
      state.caretRange = null;
      $("#add-review-toolbar").disabled = true;
      $("#add-insertion-toolbar").disabled = true;
      $("#highlight-menu-trigger").disabled = true;
      return;
    }
    if (selection.isCollapsed) {
      state.caretRange = selection.getRangeAt(0).cloneRange();
      state.savedRange = null;
      selectionActions.hidden = true;
      $("#add-review-toolbar").disabled = true;
      $("#add-insertion-toolbar").disabled = false;
      $("#highlight-menu-trigger").disabled = true;
      return;
    }
    if (!selectionInsideEditor(selection)) return;
    const range = selection.getRangeAt(0).cloneRange();
    state.savedRange = range;
    state.caretRange = null;
    $("#add-review-toolbar").disabled = false;
    $("#add-insertion-toolbar").disabled = true;
    $("#highlight-menu-trigger").disabled = false;
    const rect = range.getBoundingClientRect();
    selectionActions.hidden = false;
    const width = selectionActions.offsetWidth || 310;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2));
    const top = rect.top > 58 ? rect.top - 46 : rect.bottom + 8;
    selectionActions.style.left = `${left}px`;
    selectionActions.style.top = `${top}px`;
  }

  function defaultReviewPrompt(type) {
    return ({
      question: "Explain this passage clearly and revise it only if clarity requires a change.",
      simplify: "Rewrite this passage in simpler language without losing important meaning.",
      rewrite: "Rewrite this passage while preserving the surrounding tone and intent.",
      verify: "Check this claim for internal consistency. Flag anything that needs an external source.",
      note: "Consider this note when revising the document.",
      insert: "Insert the requested content at this exact position, matching the surrounding tone and formatting."
    })[type] || "";
  }

  function insertionContext(range) {
    if (!rangeInsideEditor(range)) return "Insert at the selected cursor position.";
    const beforeRange = document.createRange();
    beforeRange.selectNodeContents(editor);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    const afterRange = document.createRange();
    afterRange.selectNodeContents(editor);
    afterRange.setStart(range.endContainer, range.endOffset);
    const before = beforeRange.toString().replace(/\s+/g, " ").trim().slice(-90);
    const after = afterRange.toString().replace(/\s+/g, " ").trim().slice(0, 90);
    if (before && after) return `Insert between “…${before}” and “${after}…”.`;
    if (before) return `Insert after “…${before}”.`;
    if (after) return `Insert before “${after}…”.`;
    return "Insert at the selected cursor position.";
  }

  function positionComposer() {
    const rect = (state.reviewType === "insert" ? state.caretRange : state.savedRange)?.getBoundingClientRect();
    const width = Math.min(390, window.innerWidth - 24);
    const left = rect ? Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2)) : Math.max(12, (window.innerWidth - width) / 2);
    const preferredTop = rect ? rect.bottom + 12 : 100;
    const top = Math.max(12, Math.min(window.innerHeight - 360, preferredTop));
    composer.style.left = `${left}px`;
    composer.style.top = `${top}px`;
  }

  function openComposer(type = "question", reviewId = null) {
    const requestedRange = type === "insert" ? state.caretRange : state.savedRange;
    if (!reviewId && !requestedRange) {
      showToast(type === "insert" ? "Place the cursor first" : "Select a passage first", type === "insert" ? "Click the exact position where new content should be inserted." : "Highlight the text you want to discuss or change.");
      return;
    }
    state.reviewType = type;
    state.editingReviewId = reviewId;
    const review = reviewId ? state.current.reviews.find((item) => item.id === reviewId) : null;
    $("#composer-type").textContent = reviewLabel(review?.type || type);
    $("#composer-title").textContent = review ? "Edit review" : "Add your review";
    $("#composer-quote").textContent = review?.quote || (type === "insert" ? insertionContext(state.caretRange) : state.selectedBlock ? describeReviewBlock(state.selectedBlock) : state.savedRange.toString().trim());
    $("#composer-input").value = review?.comment || defaultReviewPrompt(type);
    $("#composer-save").textContent = review ? "Save review" : "Add to review queue";
    selectionActions.hidden = true;
    composer.hidden = false;
    positionComposer();
    requestAnimationFrame(() => $("#composer-input").focus());
  }

  function closeComposer() {
    composer.hidden = true;
    state.editingReviewId = null;
    if (state.selectedBlock) clearSelectedBlock();
  }

  function rangeOverlapsReview(range) {
    const fragment = range.cloneContents();
    if (fragment.querySelector?.("mark[data-review-id]")) return true;
    const start = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
    const end = range.endContainer.nodeType === Node.TEXT_NODE ? range.endContainer.parentElement : range.endContainer;
    return Boolean(start?.closest?.("mark[data-review-id]") || end?.closest?.("mark[data-review-id]"));
  }

  async function saveReviewFromComposer() {
    const comment = $("#composer-input").value.trim();
    if (!comment) {
      $("#composer-input").focus();
      showToast("Add an instruction", "Describe the question or change for this passage.");
      return;
    }

    if (state.editingReviewId) {
      const review = state.current.reviews.find((item) => item.id === state.editingReviewId);
      if (review) {
        review.comment = comment;
        syncInsertionAnchor(review);
      }
      closeComposer();
      renderReviews();
      await saveCurrent({ immediate: true });
      showToast("Review updated");
      return;
    }

    const range = state.reviewType === "insert" ? state.caretRange : state.savedRange;
    if (!range || !editor.contains(range.commonAncestorContainer)) {
      closeComposer();
      showToast("Selection expired", state.reviewType === "insert" ? "Place the cursor again at the exact insertion point." : "Select the passage again and add your review.");
      return;
    }
    if (state.reviewType !== "insert" && rangeOverlapsReview(range)) {
      closeComposer();
      showToast("Reviews cannot overlap", "Select text outside the existing highlighted review, or edit that review instead.");
      return;
    }

    const id = uid("review");
    const isBlockReview = Boolean(state.selectedBlock);
    const quote = state.reviewType === "insert" ? insertionContext(range) : isBlockReview ? describeReviewBlock(state.selectedBlock) : range.toString().trim();
    let mark;
    if (state.reviewType === "insert") {
      mark = document.createElement("span");
      mark.className = "insertion-anchor";
      mark.dataset.reviewId = id;
      mark.dataset.status = "open";
      mark.contentEditable = "false";
      mark.setAttribute("aria-label", `Insertion request: ${comment}`);
      mark.title = comment;
      const label = document.createElement("span");
      label.className = "insertion-anchor-label";
      label.textContent = insertionAnchorLabel(comment);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "insertion-anchor-remove";
      remove.contentEditable = "false";
      remove.dataset.reviewId = id;
      remove.setAttribute("aria-label", "Delete insertion review");
      remove.title = "Delete this insertion review";
      remove.textContent = "×";
      mark.append(label, remove);
      range.insertNode(mark);
    } else {
      mark = document.createElement("mark");
      mark.className = isBlockReview ? "review-highlight block-review-highlight" : "review-highlight";
      mark.dataset.reviewId = id;
      mark.dataset.status = "open";
      try {
        const contents = range.extractContents();
        mark.append(contents);
        range.insertNode(mark);
      } catch (error) {
        closeComposer();
        showToast("Could not anchor this review", "Try selecting a smaller passage within one paragraph.");
        return;
      }
    }

    state.current.reviews.push({
      id,
      type: state.reviewType,
      quote,
      marker: state.reviewType === "insert" ? `[INSERTION_REVIEW:${id}]` : undefined,
      comment,
      status: "open",
      replies: [],
      createdAt: nowISO()
    });
    window.getSelection()?.removeAllRanges();
    state.savedRange = null;
    state.caretRange = null;
    $("#add-review-toolbar").disabled = true;
    $("#add-insertion-toolbar").disabled = true;
    $("#highlight-menu-trigger").disabled = true;
    closeComposer();
    updateAllViews();
    activateReview(id);
    await saveCurrent({ immediate: true });
    showToast("Added to review queue", "It will be included in the exported review brief.");
  }

  function unwrapElement(element) {
    const parent = element.parentNode;
    while (element.firstChild) parent.insertBefore(element.firstChild, element);
    element.remove();
    parent.normalize();
  }

  function applyTextHighlight(color) {
    const range = state.savedRange;
    if (!range || !rangeInsideEditor(range) || range.collapsed) {
      showToast("Select text to highlight");
      return;
    }

    if (color === "clear") {
      const removable = $$("mark.text-highlight, mark.review-highlight", editor).filter((mark) => {
        try { return range.intersectsNode(mark); } catch (_) { return false; }
      });
      const reviewMarkers = removable.filter((mark) => mark.classList.contains("review-highlight")).length;
      removable.reverse().forEach((mark) => mark.isConnected && unwrapElement(mark));
      if (reviewMarkers) showToast("Review highlight removed", "The review remains available in the review queue.");
    } else {
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.textContent || node.parentElement?.closest(".insertion-anchor")) return NodeFilter.FILTER_REJECT;
          try { return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; }
          catch (_) { return NodeFilter.FILTER_REJECT; }
        }
      });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.reverse().forEach((node) => {
        const start = node === range.startContainer ? range.startOffset : 0;
        const end = node === range.endContainer ? range.endOffset : node.length;
        if (start >= end) return;
        const textRange = document.createRange();
        textRange.setStart(node, start);
        textRange.setEnd(node, end);
        const mark = document.createElement("mark");
        mark.className = "text-highlight";
        mark.dataset.highlightColor = color;
        try { textRange.surroundContents(mark); } catch (_) { /* A text-node range should always be safe. */ }
      });
    }

    window.getSelection()?.removeAllRanges();
    state.savedRange = null;
    $("#add-review-toolbar").disabled = true;
    $("#highlight-menu-trigger").disabled = true;
    $("#highlight-menu").hidden = true;
    $("#highlight-menu-trigger").setAttribute("aria-expanded", "false");
    scheduleEditorUpdate();
  }

  async function handleReviewAction(event) {
    const button = event.target.closest("button[data-review-id]");
    if (!button) return;
    const review = state.current.reviews.find((item) => item.id === button.dataset.reviewId);
    if (!review) return;

    if (button.classList.contains("edit-review")) {
      openComposer(review.type, review.id);
      return;
    }
    if (button.classList.contains("reply-review")) {
      const reply = window.prompt("Add a follow-up instruction or clarification:");
      if (reply?.trim()) {
        review.replies ||= [];
        review.replies.push({ id: uid("reply"), text: reply.trim(), createdAt: nowISO() });
        renderReviews();
        await saveCurrent({ immediate: true });
      }
      return;
    }
    if (button.classList.contains("resolve-review")) {
      review.status = review.status === "resolved" ? "open" : "resolved";
      const mark = findReviewMark(review.id);
      if (mark) mark.dataset.status = review.status;
      renderReviews();
      await saveCurrent({ immediate: true });
      return;
    }
    if (button.classList.contains("delete-review")) {
      openDeleteReviewDialog(review);
    }
  }

  function openDeleteReviewDialog(review) {
    if (!review) return;
    state.pendingDeleteReviewId = review.id;
    $("#delete-review-quote").textContent = review.type === "insert" ? `${review.quote} ${review.comment}` : `“${review.quote}”`;
    $("#delete-review-dialog").showModal();
  }

  async function confirmDeleteReview() {
    const id = state.pendingDeleteReviewId;
    const review = state.current?.reviews.find((item) => item.id === id);
    if (!review) {
      $("#delete-review-dialog").close();
      return;
    }
    const mark = findReviewMark(id);
    if (mark) {
      if (review.type === "insert" || mark.classList.contains("insertion-anchor")) mark.remove();
      else unwrapElement(mark);
    }
    state.current.reviews = state.current.reviews.filter((item) => item.id !== id);
    if (state.activeReviewMarkerId === id) closeReviewMarkerActions();
    state.pendingDeleteReviewId = null;
    $("#delete-review-dialog").close();
    updateAllViews();
    await saveCurrent({ immediate: true });
    showToast("Review deleted");
  }

  function insertHtmlAtSelection(html) {
    document.execCommand("insertHTML", false, html);
  }

  async function handleEditorPaste(event) {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    if (clipboard.files?.length) {
      event.preventDefault();
      queueFileForImport(clipboard.files[0]);
      return;
    }
    const html = clipboard.getData("text/html");
    const text = clipboard.getData("text/plain");
    if (!html && !text) return;
    event.preventDefault();
    let normalized;
    if (html) normalized = P.sanitizeHTML(html);
    else normalized = P.looksLikeMarkdown(text) ? P.markdownToHtml(text) : P.textToHtml(text);
    insertHtmlAtSelection(normalized);
    highlightAllCodeBlocks();
    offerLegacyCodeRepair();
    if (titleInput.value.trim() === "Untitled document") {
      const firstHeading = editor.querySelector("h1");
      if (firstHeading?.textContent.trim()) titleInput.value = firstHeading.textContent.trim();
    }
    scheduleEditorUpdate();
    showToast(html ? "Rich text pasted" : P.looksLikeMarkdown(text) ? "Markdown rendered" : "Text pasted");
  }

  function scheduleEditorUpdate() {
    updateStats();
    clearTimeout(scheduleEditorUpdate.outlineTimer);
    scheduleEditorUpdate.outlineTimer = setTimeout(renderOutline, 350);
    saveCurrent();
  }

  function openImportDialog(tab = "paste") {
    state.selectedFile = null;
    $("#selected-file").hidden = true;
    $("#file-input").value = "";
    $("#import-paste").value = "";
    clearInlineAlert($("#import-error"));
    resetImportProgress();
    switchImportTab(tab);
    importDialog.showModal();
    requestAnimationFrame(() => tab === "paste" ? $("#import-paste").focus() : $("#drop-zone").focus());
  }

  function switchImportTab(tab) {
    $$("[data-import-tab]").forEach((button) => {
      const active = button.dataset.importTab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    $("#paste-pane").hidden = tab !== "paste";
    $("#file-pane").hidden = tab !== "file";
  }

  function setSelectedFile(file) {
    state.selectedFile = file;
    const display = $("#selected-file");
    display.textContent = `${file.name} (${formatBytes(file.size)})`;
    display.hidden = false;
    clearInlineAlert($("#import-error"));
    resetImportProgress();
  }

  function queueFileForImport(file) {
    openImportDialog("file");
    setSelectedFile(file);
  }

  function resetImportProgress() {
    const container = $("#import-progress");
    const bar = $("#import-progress-bar");
    container.hidden = true;
    bar.max = 1;
    bar.value = 0;
    $("#import-progress-text").textContent = "Preparing document…";
  }

  function updateImportProgress({ current = 0, total = 1, message = "Importing document…" } = {}) {
    const container = $("#import-progress");
    const bar = $("#import-progress-bar");
    const safeTotal = Math.max(1, Number(total) || 1);
    bar.max = safeTotal;
    bar.value = Math.min(safeTotal, Math.max(0, Number(current) || 0));
    $("#import-progress-text").textContent = message;
    container.hidden = false;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }

  async function submitImport(event) {
    event.preventDefault();
    const button = $("#import-submit");
    const errorElement = $("#import-error");
    clearInlineAlert(errorElement);
    button.disabled = true;
    button.textContent = "Importing...";
    try {
      let result;
      if (!$("#file-pane").hidden) {
        if (!state.selectedFile) throw new Error("Choose a file to import.");
        result = await FI.fileToDocument(state.selectedFile, { onProgress: updateImportProgress });
      } else {
        const text = $("#import-paste").value;
        if (!text.trim()) throw new Error("Paste some content before importing.");
        const markdown = $("#paste-as-markdown").checked || P.looksLikeMarkdown(text);
        const parsedHtml = markdown ? P.markdownToHtml(text) : P.textToHtml(text);
        const titleProbe = document.createElement("div");
        titleProbe.innerHTML = parsedHtml;
        result = {
          title: titleProbe.querySelector("h1")?.textContent.trim() || "Imported document",
          html: parsedHtml,
          format: markdown ? "Markdown" : "Pasted text"
        };
      }
      await createDocument({ title: result.title, html: result.html, sourceFormat: result.format });
      importDialog.close();
      showToast("Document imported", `${result.format} was converted into an editable document.`);
    } catch (error) {
      setInlineAlert(errorElement, error.message || "The document could not be imported.");
    } finally {
      button.disabled = false;
      button.textContent = "Import document";
    }
  }

  function buildReviewBrief() {
    const reviews = (state.current?.reviews || []).filter((review) => review.status !== "resolved");
    const source = P.htmlToMarkdown(editor.innerHTML);
    const lines = [
      `# Revision brief: ${state.current?.title || "Untitled document"}`,
      "",
      "## Document-wide instruction",
      "",
      state.current?.globalInstruction?.trim() || "No document-wide instruction was provided.",
      "",
      "## Passage-level reviews",
      ""
    ];
    if (!reviews.length) lines.push("No passage-level reviews were provided.", "");
    reviews.forEach((review, index) => {
      lines.push(`### Review ${index + 1}: ${reviewLabel(review.type)}`, "");
      if (review.type === "insert") {
        lines.push(`Exact insertion marker: ${review.marker || `[INSERTION_REVIEW:${review.id}]`}`, "", `Position context: ${review.quote}`, "", `Content request: ${review.comment}`);
      } else {
        lines.push(`Selected passage: “${review.quote}”`, "", `Instruction: ${review.comment}`);
      }
      if (review.replies?.length) {
        lines.push("", "Follow-up notes:", ...review.replies.map((reply) => `- ${reply.text}`));
      }
      lines.push("");
    });
    lines.push("## Source document", "", source);
    return lines.join("\n");
  }

  function downloadBlob(content, type, filename) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function wordDocumentHtml(content, title) {
    return `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${P.escapeHTML(title)}</title><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.55;max-width:7.2in;margin:0 auto}h1,h2,h3{font-family:Calibri,Arial,sans-serif}h1{font-size:24pt}h2{font-size:18pt}h3{font-size:14pt}table{border-collapse:collapse;width:100%}th,td{border:1px solid #aaa;padding:6pt}blockquote{border-left:3px solid #bbb;padding-left:12pt;color:#555}.text-highlight[data-highlight-color=yellow]{background:#fde68a}.text-highlight[data-highlight-color=green]{background:#bbf7d0}.text-highlight[data-highlight-color=blue]{background:#bfdbfe}.text-highlight[data-highlight-color=pink]{background:#fbcfe8}</style></head><body>${content}</body></html>`;
  }

  function exportDocument(format, { html = editor.innerHTML, title = state.current?.title || "Untitled document" } = {}) {
    const cleanHtml = P.sanitizeHTML(html, { keepReviewMarks: false, localImagesOnly: false });
    const filename = safeFilename(title);
    if (format === "doc") {
      downloadBlob(wordDocumentHtml(cleanHtml, title), "application/msword;charset=utf-8", `${filename}.doc`);
      showToast("Word document exported", "Open the .doc file in Microsoft Word or LibreOffice.");
    } else if (format === "pdf") {
      document.title = title;
      window.print();
      setTimeout(() => { document.title = "Margin - Document review workspace"; }, 500);
      showToast("PDF export opened", "Choose Save as PDF in the print dialog.");
    } else if (format === "html") {
      downloadBlob(`<!doctype html><meta charset="utf-8"><title>${P.escapeHTML(title)}</title><article>${cleanHtml}</article>`, "text/html;charset=utf-8", `${filename}.html`);
    } else if (format === "markdown") {
      downloadBlob(P.htmlToMarkdown(cleanHtml), "text/markdown;charset=utf-8", `${filename}.md`);
    } else if (format === "text") {
      const container = document.createElement("div");
      container.innerHTML = cleanHtml;
      downloadBlob(container.innerText, "text/plain;charset=utf-8", `${filename}.txt`);
    }
    $("#more-menu").hidden = true;
  }

  function exportReviewBrief() {
    const brief = buildReviewBrief();
    downloadBlob(brief, "text/markdown;charset=utf-8", `${safeFilename(state.current?.title)} - review brief.md`);
    showToast("Review brief exported", "It includes every open review, global instruction, and the source document.");
  }

  function closeMobilePanels() {
    $("#library-panel").classList.remove("open");
    $("#review-panel").classList.remove("open");
    $("#panel-scrim").hidden = true;
    updatePanelControlStates();
  }

  function openMobilePanel(id) {
    closeMobilePanels();
    $(`#${id}`).classList.add("open");
    $("#panel-scrim").hidden = false;
    updatePanelControlStates();
  }

  function isMobileWorkspace() {
    return window.matchMedia("(max-width: 900px)").matches;
  }

  function updatePanelControlStates() {
    const mobile = isMobileWorkspace();
    const libraryExpanded = mobile ? $("#library-panel").classList.contains("open") : !state.panelLayout.libraryCollapsed;
    const reviewsExpanded = mobile ? $("#review-panel").classList.contains("open") : !state.panelLayout.reviewsCollapsed;
    const libraryToggle = $("#toggle-library");
    const reviewsToggle = $("#toggle-reviews");
    libraryToggle.setAttribute("aria-expanded", String(libraryExpanded));
    reviewsToggle.setAttribute("aria-expanded", String(reviewsExpanded));
    libraryToggle.setAttribute("aria-label", `${libraryExpanded ? "Collapse" : "Expand"} document library`);
    reviewsToggle.setAttribute("aria-label", `${reviewsExpanded ? "Collapse" : "Expand"} review panel`);
    libraryToggle.title = `${libraryExpanded ? "Collapse" : "Expand"} Library`;
    reviewsToggle.title = `${reviewsExpanded ? "Collapse" : "Expand"} Reviews`;
    $("#restore-library").setAttribute("aria-label", "Expand document library");
    $("#restore-reviews").setAttribute("aria-label", "Expand review panel");
  }

  function applyPanelLayout({ persist = false } = {}) {
    const workspace = $(".workspace");
    const layout = state.panelLayout;
    workspace.classList.toggle("library-collapsed", layout.libraryCollapsed);
    workspace.classList.toggle("reviews-collapsed", layout.reviewsCollapsed);
    workspace.style.setProperty("--library-width", layout.libraryCollapsed ? "0px" : `${layout.libraryWidth}px`);
    workspace.style.setProperty("--review-width", layout.reviewsCollapsed ? "0px" : `${layout.reviewWidth}px`);
    workspace.style.setProperty("--library-handle-width", layout.libraryCollapsed ? "0px" : "7px");
    workspace.style.setProperty("--review-handle-width", layout.reviewsCollapsed ? "0px" : "7px");
    updatePanelControlStates();
    $("#library-resizer").setAttribute("aria-valuenow", String(layout.libraryCollapsed ? 0 : layout.libraryWidth));
    $("#review-resizer").setAttribute("aria-valuenow", String(layout.reviewsCollapsed ? 0 : layout.reviewWidth));
    if (persist) localStorage.setItem("margin-panel-layout", JSON.stringify(layout));
  }

  function initializePanelLayout() {
    try {
      const saved = JSON.parse(localStorage.getItem("margin-panel-layout"));
      if (saved) state.panelLayout = { ...state.panelLayout, ...saved };
    } catch (_) { /* Use roomy defaults. */ }
    state.panelLayout.libraryWidth = Math.max(180, Math.min(460, Number(state.panelLayout.libraryWidth) || 220));
    state.panelLayout.reviewWidth = Math.max(260, Math.min(560, Number(state.panelLayout.reviewWidth) || 320));
    state.panelLayout.libraryCollapsed = state.panelLayout.libraryCollapsed === true;
    state.panelLayout.reviewsCollapsed = state.panelLayout.reviewsCollapsed === true;
    applyPanelLayout();
  }

  function togglePanel(side) {
    if (isMobileWorkspace()) {
      const id = side === "library" ? "library-panel" : "review-panel";
      if ($(`#${id}`).classList.contains("open")) closeMobilePanels();
      else openMobilePanel(id);
      return;
    }
    const key = side === "library" ? "libraryCollapsed" : "reviewsCollapsed";
    state.panelLayout[key] = !state.panelLayout[key];
    applyPanelLayout({ persist: true });
  }

  function expandPanel(side) {
    if (isMobileWorkspace()) {
      openMobilePanel(side === "library" ? "library-panel" : "review-panel");
      return;
    }
    const key = side === "library" ? "libraryCollapsed" : "reviewsCollapsed";
    state.panelLayout[key] = false;
    applyPanelLayout({ persist: true });
    requestAnimationFrame(() => $(side === "library" ? "#library-panel" : "#review-panel").focus({ preventScroll: true }));
  }

  function setPanelWidth(side, width, { persist = false } = {}) {
    const isLibrary = side === "library";
    const widthKey = isLibrary ? "libraryWidth" : "reviewWidth";
    const collapsedKey = isLibrary ? "libraryCollapsed" : "reviewsCollapsed";
    const min = isLibrary ? 180 : 260;
    const max = isLibrary ? 460 : 560;
    if (width < 120) {
      state.panelLayout[collapsedKey] = true;
    } else {
      state.panelLayout[collapsedKey] = false;
      state.panelLayout[widthKey] = Math.max(min, Math.min(max, Math.round(width)));
    }
    applyPanelLayout({ persist });
  }

  function bindPanelResizer(side, element) {
    element.addEventListener("pointerdown", (event) => {
      if (isMobileWorkspace() || event.button !== 0) return;
      event.preventDefault();
      element.setPointerCapture(event.pointerId);
      document.body.classList.add("resizing-panels");
    });
    element.addEventListener("pointermove", (event) => {
      if (!element.hasPointerCapture(event.pointerId)) return;
      const rect = $(".workspace").getBoundingClientRect();
      setPanelWidth(side, side === "library" ? event.clientX - rect.left : rect.right - event.clientX);
    });
    const finish = (event) => {
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      document.body.classList.remove("resizing-panels");
      applyPanelLayout({ persist: true });
    };
    element.addEventListener("pointerup", finish);
    element.addEventListener("pointercancel", finish);
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        togglePanel(side);
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setPanelWidth(side, 0, { persist: true });
        return;
      }
      if (!event.key.startsWith("Arrow")) return;
      event.preventDefault();
      const current = side === "library" ? state.panelLayout.libraryWidth : state.panelLayout.reviewWidth;
      const expands = side === "library" ? event.key === "ArrowRight" : event.key === "ArrowLeft";
      setPanelWidth(side, current + (expands ? 20 : -20), { persist: true });
    });
  }

  function initializeTheme() {
    const saved = localStorage.getItem("margin-theme");
    const dark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("margin-theme", next);
  }

  function bindEvents() {
    titleInput.addEventListener("input", () => saveCurrent());
    editor.addEventListener("input", (event) => {
      scheduleEditorUpdate();
      const pre = event.target.closest?.("pre") || window.getSelection()?.anchorNode?.parentElement?.closest?.("pre");
      if (pre && editor.contains(pre)) scheduleCodeRehighlight(pre);
    });
    editor.addEventListener("paste", handleEditorPaste);
    editor.addEventListener("click", (event) => {
      const insertionRemove = event.target.closest(".insertion-anchor-remove");
      if (insertionRemove) {
        event.preventDefault();
        event.stopPropagation();
        openDeleteReviewDialog(state.current?.reviews.find((review) => review.id === insertionRemove.dataset.reviewId));
        return;
      }
      const mark = event.target.closest("[data-review-id]");
      if (mark) {
        activateReview(mark.dataset.reviewId, { scroll: true });
        if (mark.classList.contains("review-highlight")) showReviewMarkerActions(mark);
        return;
      }
      closeReviewMarkerActions();
      const codeBlock = event.target.closest("pre");
      if (codeBlock && editor.contains(codeBlock)) {
        if (state.selectedBlock) clearSelectedBlock();
        selectCodeBlock(codeBlock);
        return;
      }
      clearCodeBlockSelection();
      const reviewBlock = event.target.closest(reviewBlockSelector);
      if (reviewBlock && editor.contains(reviewBlock)) selectReviewBlock(reviewBlock);
      else if (state.selectedBlock) clearSelectedBlock();
    });
    document.addEventListener("selectionchange", () => requestAnimationFrame(updateSelectionToolbar));
    window.addEventListener("resize", () => {
      selectionActions.hidden = true;
      if (!composer.hidden) positionComposer();
      positionBlockReviewActions();
      positionCodeBlockActions();
      if (state.activeReviewMarkerId) {
        const activeMark = findReviewMark(state.activeReviewMarkerId);
        if (activeMark?.classList.contains("review-highlight")) showReviewMarkerActions(activeMark);
      }
      applyPanelLayout();
    });

    $$("[data-command]").forEach((button) => {
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        editor.focus();
        document.execCommand(button.dataset.command, false);
        scheduleEditorUpdate();
      });
    });
    $("#block-format").addEventListener("change", (event) => {
      editor.focus();
      document.execCommand("formatBlock", false, event.target.value);
      scheduleEditorUpdate();
    });

    selectionActions.addEventListener("mousedown", (event) => event.preventDefault());
    selectionActions.addEventListener("click", (event) => {
      const button = event.target.closest("[data-review-type]");
      if (button) openComposer(button.dataset.reviewType);
    });
    $("#add-review-toolbar").addEventListener("mousedown", (event) => event.preventDefault());
    $("#add-review-toolbar").addEventListener("click", () => openComposer("question"));
    $("#add-insertion-toolbar").addEventListener("mousedown", (event) => event.preventDefault());
    $("#add-insertion-toolbar").addEventListener("click", () => openComposer("insert"));
    $("#highlight-menu-trigger").addEventListener("mousedown", (event) => event.preventDefault());
    $("#highlight-menu-trigger").addEventListener("click", () => {
      const menu = $("#highlight-menu");
      menu.hidden = !menu.hidden;
      $("#highlight-menu-trigger").setAttribute("aria-expanded", String(!menu.hidden));
    });
    $("#highlight-menu").addEventListener("mousedown", (event) => event.preventDefault());
    $("#highlight-menu").addEventListener("click", (event) => {
      const button = event.target.closest("[data-highlight-color]");
      if (button) applyTextHighlight(button.dataset.highlightColor);
    });
    $("#composer-close").addEventListener("click", closeComposer);
    $("#composer-cancel").addEventListener("click", closeComposer);
    $("#composer-save").addEventListener("click", saveReviewFromComposer);
    $("#add-block-review").addEventListener("click", () => openComposer("note"));
    $("#close-block-review").addEventListener("click", clearSelectedBlock);
    $("#code-language").addEventListener("change", (event) => {
      const pre = state.selectedCodeBlock;
      if (!pre) return;
      const language = canonicalCodeLanguage(event.target.value);
      const code = codeElement(pre);
      stripCodeHighlight(pre);
      state.editingCodeBlock = null;
      pre.dataset.language = language;
      code.dataset.language = language;
      highlightCodeBlock(pre);
      scheduleEditorUpdate();
      requestAnimationFrame(positionCodeBlockActions);
    });
    $("#copy-code-block").addEventListener("click", async () => {
      const code = codeElement(state.selectedCodeBlock);
      if (!code) return;
      await navigator.clipboard.writeText(code.textContent || "");
      showToast("Code copied");
    });
    $("#review-code-block").addEventListener("click", () => {
      const pre = state.selectedCodeBlock;
      if (!pre) return;
      finishCodeEditing(pre);
      clearCodeBlockSelection({ keepHighlight: true });
      selectReviewBlock(pre);
      blockReviewActions.hidden = true;
      openComposer("note");
    });
    $("#close-code-block").addEventListener("click", () => clearCodeBlockSelection());
    $("#remove-review-marker").addEventListener("click", removeActiveReviewMarker);
    $("#close-review-marker").addEventListener("click", closeReviewMarkerActions);

    $("#review-list").addEventListener("click", handleReviewAction);
    $("#confirm-delete-review").addEventListener("click", confirmDeleteReview);
    $("#delete-review-dialog").addEventListener("close", () => { state.pendingDeleteReviewId = null; });
    $("#confirm-delete-document").addEventListener("click", confirmDeleteDocument);
    deleteDocumentDialog.addEventListener("close", () => {
      state.pendingDeleteDocumentId = null;
      clearInlineAlert($("#delete-document-error"));
    });
    $("#clear-documents").addEventListener("click", openClearDocumentsDialog);
    $("#clear-documents-confirmation").addEventListener("input", (event) => {
      $("#confirm-clear-documents").disabled = state.documentMutationBusy || !DL.clearPhraseMatches(event.target.value);
    });
    $("#confirm-clear-documents").addEventListener("click", confirmClearDocuments);
    clearDocumentsDialog.addEventListener("close", () => {
      $("#clear-documents-confirmation").value = "";
      $("#confirm-clear-documents").disabled = true;
      clearInlineAlert($("#clear-documents-error"));
    });
    $$("[data-filter]").forEach((button) => button.addEventListener("click", () => {
      state.reviewFilter = button.dataset.filter;
      $$("[data-filter]").forEach((item) => item.classList.toggle("active", item === button));
      renderReviews();
    }));
    $("#global-instruction").addEventListener("input", () => saveCurrent());

    $("#new-document").addEventListener("click", () => createDocument());
    $("#empty-new-document").addEventListener("click", () => createDocument());
    $("#empty-import").addEventListener("click", () => openImportDialog());
    $("#import-trigger").addEventListener("click", () => openImportDialog());
    $("#document-search").addEventListener("input", renderDocumentList);
    $("#document-list").addEventListener("click", (event) => {
      const remove = event.target.closest("[data-delete-document-id]");
      if (remove) {
        openDeleteDocumentDialog(remove.dataset.deleteDocumentId);
        return;
      }
      const item = event.target.closest("[data-document-id]");
      if (item) loadDocument(item.dataset.documentId);
    });

    $$("[data-import-tab]").forEach((button) => button.addEventListener("click", () => switchImportTab(button.dataset.importTab)));
    $("#drop-zone").addEventListener("click", () => $("#file-input").click());
    $("#file-input").addEventListener("change", (event) => event.target.files[0] && setSelectedFile(event.target.files[0]));
    $("#file-input").accept = FI.acceptAttribute;
    ["dragenter", "dragover"].forEach((name) => $("#drop-zone").addEventListener(name, (event) => {
      event.preventDefault();
      $("#drop-zone").classList.add("dragging");
    }));
    ["dragleave", "drop"].forEach((name) => $("#drop-zone").addEventListener(name, (event) => {
      event.preventDefault();
      $("#drop-zone").classList.remove("dragging");
    }));
    $("#drop-zone").addEventListener("drop", (event) => event.dataTransfer.files[0] && setSelectedFile(event.dataTransfer.files[0]));
    $("#import-submit").addEventListener("click", submitImport);
    $("#repair-inline-code").addEventListener("click", () => {
      $("#more-menu").hidden = true;
      openLegacyCodeRepair();
    });
    $("#apply-legacy-code-repair").addEventListener("click", applyLegacyCodeRepairs);
    legacyCodeDialog.addEventListener("close", () => {
      if (collectLegacyCodeTokens().length) state.legacyRepairDismissedForDocument = true;
    });

    const stage = $("#document-stage");
    stage.addEventListener("dragover", (event) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    });
    stage.addEventListener("drop", (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      event.preventDefault();
      queueFileForImport(file);
    });

    $("#more-menu-trigger").addEventListener("click", () => {
      const menu = $("#more-menu");
      menu.hidden = !menu.hidden;
      $("#more-menu-trigger").setAttribute("aria-expanded", String(!menu.hidden));
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest("#more-menu, #more-menu-trigger")) $("#more-menu").hidden = true;
      if (!event.target.closest("#highlight-menu, #highlight-menu-trigger")) {
        $("#highlight-menu").hidden = true;
        $("#highlight-menu-trigger").setAttribute("aria-expanded", "false");
      }
      if (!event.target.closest("#code-block-actions") && !event.target.closest("#document-editor pre")) clearCodeBlockSelection();
    });
    $$('[data-export]').forEach((button) => button.addEventListener("click", () => exportDocument(button.dataset.export)));
    $("#export-review-pack").addEventListener("click", exportReviewBrief);

    $("#theme-toggle").addEventListener("click", toggleTheme);
    $("#toggle-library").addEventListener("click", () => togglePanel("library"));
    $("#toggle-reviews").addEventListener("click", () => togglePanel("reviews"));
    $("#restore-library").addEventListener("click", () => expandPanel("library"));
    $("#restore-reviews").addEventListener("click", () => expandPanel("reviews"));
    bindPanelResizer("library", $("#library-resizer"));
    bindPanelResizer("reviews", $("#review-resizer"));
    $$("[data-close-panel]").forEach((button) => button.addEventListener("click", closeMobilePanels));
    $("#panel-scrim").addEventListener("click", closeMobilePanels);

    document.addEventListener("keydown", (event) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveCurrent({ immediate: true }).then(() => showToast("Saved locally"));
      }
      if (modifier && event.key === "Enter") {
        event.preventDefault();
        exportReviewBrief();
      }
      if (event.key === "Escape") {
        selectionActions.hidden = true;
        if (!composer.hidden) closeComposer();
        clearSelectedBlock();
        clearCodeBlockSelection();
        closeReviewMarkerActions();
        closeMobilePanels();
      }
    });

    window.addEventListener("beforeunload", () => {
      if (!state.current) return;
      state.current.title = titleInput.value.trim() || "Untitled document";
      state.current.html = P.sanitizeHTML(editor.innerHTML, { keepReviewMarks: true, localImagesOnly: false });
      state.current.globalInstruction = $("#global-instruction").value;
      state.current.updatedAt = nowISO();
      DB.put(state.current).catch(() => {});
    });
  }

  async function initialize() {
    initializeTheme();
    initializePanelLayout();
    localStorage.removeItem("margin-ai-settings");
    sessionStorage.removeItem("margin-ai-session-key");
    bindEvents();
    try {
      await DB.open();
      state.documents = await DB.list();
      if (!state.documents.length) {
        showEmptyWorkspace();
        openImportDialog("paste");
      } else {
        await loadDocument(state.documents[0].id);
      }
    } catch (error) {
      showToast("Local storage is unavailable", `${error.message} The editor still works, but changes may not persist.`);
      state.current = makeDocument();
      titleInput.value = state.current.title;
      updateAllViews();
    }

    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    }
  }

  initialize();
})();
