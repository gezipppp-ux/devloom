const projectPath = "/projects/12345678-1234-4123-8123-123456789abc";

const pageLocations = [
  "/", "/login", "/setup", "/password", "/projects", "/work",
  "/issues", "/development", "/deliveries", "/departments", "/personal",
  "/system", "/environment", "/accounts",
  "/work?bucket=verify",
  projectPath,
  `${projectPath}?tab=issues&issue=issue-1`,
  `${projectPath}?tab=bugs&issue=bug-1`,
  `${projectPath}?tab=tasks&task=task-1&taskStart=1`,
  `${projectPath}?tab=releases&release=release-1`,
  "/deliveries?projectId=12345678-1234-4123-8123-123456789abc&delivery=delivery-1",
  `${projectPath}?tab=assets&asset=asset-1`,
  "/?workspace=workspace-1&task=manual:run-1&returnTo=%2Fprojects",
  "/projects/", "/work/", `${projectPath}/?tab=tasks&task=task-1`,
  projectPath.toUpperCase(),
];

module.exports = { pageLocations };
