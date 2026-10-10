function toolVersion(value) {
  const match = /(?:^|\s|v)(\d+\.\d+\.\d+(?:\.windows\.\d+)?)(?=$|[\s+-])/.exec(String(value));
  return match?.[1] || null;
}

function compareVersions(left, right) {
  if (!/^\d+\.\d+\.\d+(?:\.windows\.\d+)?$/.test(left || "") || !/^\d+\.\d+\.\d+(?:\.windows\.\d+)?$/.test(right || ""))
    throw new Error("版本号无效。");
  const a = left.replace(".windows.", ".").split(".").map(Number), b = right.replace(".windows.", ".").split(".").map(Number);
  for (let index = 0; index < 4; index++) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1;
  }
  return 0;
}

module.exports = { toolVersion, compareVersions };
