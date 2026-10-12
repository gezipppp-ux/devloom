function presentProjectBranches(result) {
  return { branches: result.branches.map(({ name, commit }) => ({ name, commit })),
    fetchedAt: result.fetchedAt };
}

module.exports = { presentProjectBranches };
