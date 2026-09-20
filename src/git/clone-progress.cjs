const stages = {
  "Counting objects": "counting", "Compressing objects": "compressing",
  "Receiving objects": "receiving", "Resolving deltas": "resolving",
  "Updating files": "checkout", "Checking out files": "checkout",
  "Filtering content": "checkout",
};

function cloneProgressParser(onProgress) {
  let pending = "", last = "";
  return chunk => {
    // Git uses carriage returns; never forward raw stderr, URLs or remote text.
    const lines = (pending + chunk).split(/[\r\n]/);
    pending = lines.pop().slice(-2048);
    for (const line of lines) {
      const match = /^(?:remote:\s*)?(Counting objects|Compressing objects|Receiving objects|Resolving deltas|Updating files|Checking out files|Filtering content):\s+(\d{1,3})%/.exec(line.trim());
      if (!match || Number(match[2]) > 100) continue;
      const stage = stages[match[1]], percent = Number(match[2]);
      const key = stage + percent;
      if (key !== last) { last = key; onProgress({ stage, percent }); }
    }
  };
}
module.exports = { cloneProgressParser };
