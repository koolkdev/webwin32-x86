import { runMetricsCommand } from "./metrics-command.js";

process.exitCode = runMetricsCommand(process.argv.slice(2));
