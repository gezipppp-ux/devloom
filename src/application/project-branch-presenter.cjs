function presentProjectBranches(result, defaultBranch) {
  return { branches: result.branches.map(({ name, commit }) => ({ name, commit })),
    fetchedAt: result.fetchedAt, defaultBranch: defaultBranch || "" };
}

module.exports = { presentProjectBranches };
