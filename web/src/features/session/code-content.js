import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import sql from "highlight.js/lib/languages/sql";
import json from "highlight.js/lib/languages/json";
import css from "highlight.js/lib/languages/css";
import bash from "highlight.js/lib/languages/bash";
import python from "highlight.js/lib/languages/python";
import markdown from "highlight.js/lib/languages/markdown";
import yaml from "highlight.js/lib/languages/yaml";

for (const [name, language] of Object.entries({ javascript, typescript, xml, sql, json, css, bash, python, markdown, yaml })) hljs.registerLanguage(name, language);

export function highlightCode(text, path) {
  const extension = path.split(".").at(-1)?.toLowerCase();
  const language = { js: "javascript", cjs: "javascript", mjs: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", vue: "xml", html: "xml", svg: "xml", xml: "xml", sql: "sql", json: "json", css: "css", sh: "bash", py: "python", md: "markdown", yml: "yaml", yaml: "yaml" }[extension];
  if (language && text.length < 20000) return hljs.highlight(text, { language, ignoreIllegals: true }).value;
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export function diffRows(hunks) {
  return hunks.flatMap((hunk, index) => {
    let old = hunk.oldStart, next = hunk.newStart;
    return [{ key: `h${index}`, type: "hunk", text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@` }, ...hunk.lines.map((line, i) => {
      const mark = line[0];
      const row = { key: `${index}-${i}`, type: mark === "+" ? "added" : mark === "-" ? "removed" : mark === "\\" ? "note" : "context", text: line.slice(1), mark };
      if ([" ", "-"].includes(mark)) row.old = old++;
      if ([" ", "+"].includes(mark)) row.next = next++;
      return row;
    })];
  });
}

export function splitRows(rows) {
  const result = [];
  for (let i = 0; i < rows.length;) {
    const row = rows[i];
    if (!["removed", "added"].includes(row.type)) { result.push({ key: row.key, left: row, right: row, type: row.type }); i++; continue; }
    const left = [], right = [];
    while (i < rows.length && ["removed", "added"].includes(rows[i].type)) {
      (rows[i].type === "removed" ? left : right).push(rows[i++]);
    }
    for (let j = 0; j < Math.max(left.length, right.length); j++) result.push({ key: `s-${row.key}-${j}`, left: left[j], right: right[j], type: "change" });
  }
  return result;
}
