"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScheduledTasksStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const events = __importStar(require("aws-cdk-lib/aws-events"));
const targets = __importStar(require("aws-cdk-lib/aws-events-targets"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const base_1 = require("./base");
/**
 * A set of cron jobs: one EventBridge rule per job, each starting a Fargate task.
 *
 * Jobs that share the manifest's CPU and memory share a single task definition;
 * a job that overrides either gets its own, because task size is a property of
 * the task definition rather than of the RunTask call. Command and environment
 * differences are handled with per-rule container overrides, so they never cause
 * an extra task definition.
 */
class ScheduledTasksStack extends cdk.Stack {
    rules = [];
    constructor(scope, id, props) {
        super(scope, id, props);
        const { config, image } = props;
        const context = (0, base_1.buildContext)(this, config, image);
        // CDK gives each EcsTask target its own EventBridge invoke role by default.
        // One shared role for the whole stack keeps a ten-job manifest from adding
        // ten near-identical roles to the account.
        const invokeRole = new iam.Role(this, 'EventsInvokeRole', {
            assumedBy: new iam.ServicePrincipal('events.amazonaws.com'),
            description: `EventBridge invoke role for ${config.name}`,
        });
        /** Task definitions keyed by `cpu/memory`, created on first use. */
        const definitions = new Map();
        const taskDefinitionFor = (cpu, memory) => {
            const key = `${cpu}/${memory}`;
            const existing = definitions.get(key);
            if (existing) {
                return existing;
            }
            const isDefaultSize = cpu === config.task.cpu && memory === config.task.memory;
            const built = (0, base_1.buildTaskDefinition)(this, config, context, {
                idSuffix: isDefaultSize ? '' : `-${cpu}-${memory}`,
                family: isDefaultSize ? config.name : `${config.name}-${cpu}-${memory}`,
                cpu,
                memory,
            });
            built.taskDefinition.grantRun(invokeRole);
            const entry = {
                taskDefinition: built.taskDefinition,
                containerName: built.container.containerName,
            };
            definitions.set(key, entry);
            return entry;
        };
        for (const task of config.tasks) {
            const { taskDefinition, containerName } = taskDefinitionFor(task.cpu, task.memory);
            const rule = new events.Rule(this, `Rule-${task.name}`, {
                ruleName: `${config.name}-${task.name}`,
                description: task.description ?? `${config.name}: ${task.name}`,
                schedule: events.Schedule.expression(task.schedule),
                enabled: task.enabled,
            });
            // Only send overrides that actually differ from the task definition —
            // an empty override block makes every RunTask call look like a change.
            const environmentOverride = diffEnvironment(config.task.environment, task.environment);
            const commandOverride = JSON.stringify(task.command) === JSON.stringify(config.task.command) ? undefined : task.command;
            const hasOverrides = commandOverride !== undefined || environmentOverride.length > 0;
            rule.addTarget(new targets.EcsTask({
                cluster: context.cluster,
                taskDefinition,
                taskCount: 1,
                subnetSelection: context.subnetSelection,
                securityGroups: context.securityGroups,
                assignPublicIp: config.network.assignPublicIp,
                role: invokeRole,
                retryAttempts: task.retryAttempts,
                ...(hasOverrides && {
                    containerOverrides: [
                        {
                            containerName,
                            ...(commandOverride !== undefined && { command: commandOverride }),
                            ...(environmentOverride.length > 0 && { environment: environmentOverride }),
                        },
                    ],
                }),
                ...(task.maxEventAgeMinutes !== undefined && {
                    maxEventAge: cdk.Duration.minutes(task.maxEventAgeMinutes),
                }),
            }));
            this.rules.push(rule);
        }
        new cdk.CfnOutput(this, 'ClusterNameOutput', {
            key: 'ClusterName',
            value: config.clusterName,
            description: 'ECS cluster name',
        });
        new cdk.CfnOutput(this, 'RuleNamesOutput', {
            key: 'RuleNames',
            value: this.rules.map((r) => r.ruleName).join(','),
            description: 'EventBridge rule names created by this stack',
        });
    }
}
exports.ScheduledTasksStack = ScheduledTasksStack;
/** Environment entries in `task` that differ from the shared `base`. */
function diffEnvironment(base, task) {
    return Object.entries(task)
        .filter(([name, value]) => base[name] !== value)
        .map(([name, value]) => ({ name, value }));
}
//# sourceMappingURL=scheduled-tasks-stack.js.map