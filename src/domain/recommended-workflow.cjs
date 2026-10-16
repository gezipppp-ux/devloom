const { defaultWorkflow } = require("./issue-workflows.cjs");

// A loadable template, never an implicit change to a published definition.
function recommendedWorkflow(type) {
  const definition = defaultWorkflow(type);
  const initial = definition.nodes.find(node => node.kind === "initial");
  const submission = definition.transitions.find(edge => edge.trigger === "delivery.submitted");
  for (const [from, actor, name] of [[initial.id, "handler", "提交人工成果"], ["ready", "developer", "提交已有成果"]]) {
    definition.transitions.push({ ...submission, id: from + "_" + submission.to, from, actor, name });
  }
  const rework = definition.nodes.find(node => node.id === "rework");
  rework.handler = "businessOwner";
  definition.transitions.find(edge => edge.from === "rework" && edge.trigger === "delivery.submitted").actor = "handler";
  definition.transitions.push({ ...definition.transitions.find(edge => edge.trigger === "development.assigned"), id: "rework_ready", from: "rework" });
  for (const edge of definition.transitions.filter(edge => edge.to === "rework" && ["verification.returned", "manual"].includes(edge.trigger))) {
    edge.assignment = "submitter";
    edge.requireDelivery = true;
  }
  return definition;
}

module.exports = { recommendedWorkflow };
