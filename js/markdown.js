// Small, safe Markdown renderer for AI output.
// Everything is HTML-escaped first, so model output can never inject markup or scripts.
// Maths ( \( \), \[ \], $$ $$ ) is protected from Markdown and later rendered by KaTeX.
import { esc } from "./core.js";

const PH = "\u0000";

export function renderMarkdown(src) {
  const vault = [];
  const keep = function (html) { vault.push(html); return PH + (vault.length - 1) + PH; };

  let text = String(src || "").replace(/\r\n?/g, "\n");

  // 1. fenced code blocks
  text = text.replace(/```([\w+-]*)\n?([\s\S]*?)(```|$)/g, function (_, lang, code) {
    return "\n" + keep("<pre><code" + (lang ? " data-lang='" + esc(lang) + "'" : "") + ">" + esc(code.replace(/\n$/, "")) + "</code></pre>") + "\n";
  });
  // 2. maths (kept verbatim, escaped) so * and _ inside formulas are not treated as Markdown
  text = text.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g, function (m) {
    return keep(esc(m));
  });
  // 3. inline code
  text = text.replace(/`([^`\n]+)`/g, function (_, c) { return keep("<code>" + esc(c) + "</code>"); });

  // 4. escape everything else
  text = esc(text);

  const lines = text.split("\n");
  const out = [];
  let para = [];
  let listStack = []; // {type, indent}
  let quote = [];

  function flushPara() {
    if (para.length) { out.push("<p>" + inline(para.join("<br>")) + "</p>"); para = []; }
  }
  function closeLists(toIndent) {
    while (listStack.length && (toIndent == null || listStack[listStack.length - 1].indent > toIndent)) {
      out.push("</li></" + listStack.pop().type + ">");
    }
  }
  function flushQuote() {
    if (quote.length) { out.push("<blockquote>" + inline(quote.join("<br>")) + "</blockquote>"); quote = []; }
  }
  function flushAll() { flushPara(); closeLists(); flushQuote(); }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    if (!line) { flushPara(); flushQuote(); if (!nextIsList(lines, i)) closeLists(); continue; }

    // stand-alone placeholder (code block)
    if (/^\u0000\d+\u0000$/.test(line) && vault[+line.slice(1, -1)].indexOf("<pre>") === 0) {
      flushAll(); out.push(line); continue;
    }

    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flushAll();
      const lvl = Math.min(4, m[1].length + 1);
      out.push("<h" + lvl + ">" + inline(m[2].replace(/\s#+$/, "")) + "</h" + lvl + ">");
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { flushAll(); out.push("<hr>"); continue; }

    if ((m = line.match(/^&gt;\s?(.*)$/))) { flushPara(); closeLists(); quote.push(m[1]); continue; }
    flushQuote();

    // tables
    if (line.charAt(0) === "|" && i + 1 < lines.length && /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1].trim())) {
      flushAll();
      const head = splitRow(line);
      let html = "<table><thead><tr>" + head.map(function (c) { return "<th>" + inline(c) + "</th>"; }).join("") + "</tr></thead><tbody>";
      i += 2;
      while (i < lines.length && lines[i].trim().charAt(0) === "|") {
        const cells = splitRow(lines[i].trim());
        html += "<tr>" + head.map(function (_, ci) { return "<td>" + inline(cells[ci] || "") + "</td>"; }).join("") + "</tr>";
        i++;
      }
      i--;
      out.push(html + "</tbody></table>");
      continue;
    }

    const indent = raw.match(/^\s*/)[0].replace(/\t/g, "  ").length;
    const ul = raw.match(/^\s*[-*+•]\s+(.*)$/);
    const ol = raw.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const type = ul ? "ul" : "ol";
      const body = ul ? ul[1] : ol[2];
      const top = listStack[listStack.length - 1];
      if (!top || indent > top.indent) {
        out.push("<" + type + (ol && ol[1] !== "1" && !top ? " start='" + (+ol[1]) + "'" : "") + "><li>");
        listStack.push({ type: type, indent: indent });
      } else {
        closeLists(indent);
        const t2 = listStack[listStack.length - 1];
        if (t2 && t2.type !== type && t2.indent === indent) {
          out.push("</li></" + listStack.pop().type + "><" + type + "><li>");
          listStack.push({ type: type, indent: indent });
        } else if (t2) {
          out.push("</li><li>");
        } else {
          out.push("<" + type + "><li>");
          listStack.push({ type: type, indent: indent });
        }
      }
      out.push(inline(body));
      continue;
    }

    // continuation of a list item
    if (listStack.length && indent > 0) { out.push("<br>" + inline(line)); continue; }
    closeLists();
    para.push(line);
  }
  flushAll();

  let html = out.join("");
  // restore protected chunks (twice, in case a chunk sits inside another)
  for (let k = 0; k < 2; k++) {
    html = html.replace(/\u0000(\d+)\u0000/g, function (_, n) { return vault[+n]; });
  }
  return html;
}

function nextIsList(lines, i) {
  for (let j = i + 1; j < lines.length; j++) {
    if (!lines[j].trim()) continue;
    return /^\s+\S/.test(lines[j]) || /^\s*([-*+•]|\d+[.)])\s+/.test(lines[j]);
  }
  return false;
}

function splitRow(line) {
  return line.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map(function (c) { return c.trim(); });
}

function inline(s) {
  return s
    .replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+?)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_(?!\s)([^_]+?)_(?!\w)/g, "$1<em>$2</em>")
    .replace(/==([^=]+?)==/g, "<mark>$1</mark>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "<a href=\"$2\" target=\"_blank\" rel=\"noopener noreferrer\">$1</a>");
}

// Render KaTeX in an element if the library has loaded (it is optional).
export function renderMath(el) {
  if (typeof window.renderMathInElement !== "function") return;
  try {
    window.renderMathInElement(el, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false }
      ],
      throwOnError: false,
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"]
    });
  } catch (e) { /* leave raw maths */ }
}

export function setRich(el, md) {
  el.innerHTML = renderMarkdown(md);
  renderMath(el);
}
