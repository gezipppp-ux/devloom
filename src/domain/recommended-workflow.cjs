const { defaultWorkflow } = require("./issue-workflows.cjs");

// A loadable template, never an implicit change to a published definition.
function recommendedWorkflow(type) {
  const definition = defaultWorkflow(type);
  const submission = definition.transitions.find(edge => edge.trigger === "delivery.submitted");
  definition.transitions.push({ ...submission, id: "ready_" + submission.to, from: "ready", actor: "developer", name: "线下处理" });
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
