import { formatDate, i18n, translate } from "./index.js";

export function formatRelativeTime(value, now = Date.now()) {
  if (value === null || value === undefined || value === "") return translate("时间未知");
  const date = new Date(value);
  const current = new Date(now);
  if (Number.isNaN(date.getTime()) || Number.isNaN(current.getTime())) return translate("时间未知");
  const elapsed = current - date;
  const absolute = () => formatDate(date, { year: date.getFullYear() === current.getFullYear() ? undefined : "numeric" });
  // Future timestamps are shown exactly instead of being described as past activity.
  if (elapsed < 0) return formatDate(date, { hour: "2-digit", minute: "2-digit", hour12: false });
  const today = new Date(current.getFullYear(), current.getMonth(), current.getDate());
  const yesterday = new Date(current.getFullYear(), current.getMonth(), current.getDate() - 1);
  const relative = new Intl.RelativeTimeFormat(i18n.global.locale.value, { numeric: "auto" });
  // Calendar boundaries follow the viewer's timezone, including daylight-saving days.
  if (date < yesterday) return absolute();
  if (date < today) return relative.format(-1, "day");
  if (elapsed < 60000) return translate("刚刚");
  if (elapsed < 3600000) return relative.format(-Math.floor(elapsed / 60000), "minute");
  if (elapsed < 21600000) return relative.format(-Math.floor(elapsed / 3600000), "hour");
  return relative.format(0, "day");
}
