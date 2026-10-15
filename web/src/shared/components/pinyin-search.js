import { match } from "pinyin-pro";

export function filterPinyinOption(input, option) {
  const query = String(input ?? "").trim();
  if (!query) return true;
  const label = String(option?.label ?? "");
  return label.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ||
    match(label, query, {
      continuous: true,
      precision: "start",
      space: "ignore",
      insensitive: true,
      v: true,
    }) !== null;
}
