import options from "../../shared/task-metadata.json";
export const taskTypes = options.types;
export const taskProgresses = options.progresses;
export function taskTypeLabel(value) {
  return taskTypes.find((entry) => entry.value === value)?.label || "需求";
}
export function taskProgressLabel(value) {
  return (
    taskProgresses.find((entry) => entry.value === value)?.label || "进行中"
  );
}
