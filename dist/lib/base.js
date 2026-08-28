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
exports.buildContext = buildContext;
exports.buildTaskDefinition = buildTaskDefinition;
const cdk = __importStar(require("aws-cdk-lib"));
const ec2 = __importStar(require("aws-cdk-lib/aws-ec2"));
const ecs = __importStar(require("aws-cdk-lib/aws-ecs"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const image_1 = require("./image");
const secrets_1 = require("./secrets");
function buildContext(scope, config, image) {
    // `fromLookup` reads the real VPC at synth time, which is what makes explicit
    // subnet IDs safe to use — CDK can confirm they belong to this VPC.
    const vpc = ec2.Vpc.fromLookup(scope, 'Vpc', { vpcId: config.network.vpcId });
    const securityGroups = config.network.securityGroups.length === 0
        ? [
            new ec2.SecurityGroup(scope, 'TaskSecurityGroup', {
                vpc,
                description: `Tasks for ${config.name}`,
                allowAllOutbound: true,
            }),
        ]
        : config.network.securityGroups.map((id) => ec2.SecurityGroup.fromSecurityGroupId(scope, `SecurityGroup-${id}`, id, {
            // Imported groups are assumed to allow egress already; saying so
            // stops CDK adding a redundant allow-all egress rule to a security
            // group that other workloads may share.
            allowAllOutbound: true,
        }));
    const cluster = ecs.Cluster.fromClusterAttributes(scope, 'Cluster', {
        clusterName: config.clusterName,
        vpc,
        securityGroups,
    });
    return {
        vpc,
        cluster,
        securityGroups,
        subnetSelection: { subnetFilters: [ec2.SubnetFilter.byIds(config.network.subnets)] },
        // Roles are resolved once per stack rather than per task definition, so a
        // scheduled-tasks manifest with several task sizes still produces one pair.
        // A created role starts empty and picks up exactly what the task needs —
        // image pull, log writes, secret reads, ECS Exec — through CDK's grants.
        // An imported one is immutable and receives none of them.
        executionRole: config.roles.executionRoleArn
            ? iam.Role.fromRoleArn(scope, 'ExecutionRole', config.roles.executionRoleArn, {
                mutable: false,
            })
            : new iam.Role(scope, 'ExecutionRole', {
                assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
                description: `Task execution role for ${config.name}`,
            }),
        taskRole: config.roles.taskRoleArn
            ? iam.Role.fromRoleArn(scope, 'TaskRole', config.roles.taskRoleArn, { mutable: false })
            : new iam.Role(scope, 'TaskRole', {
                assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
                description: `Task role for ${config.name}`,
            }),
        image: (0, image_1.containerImage)(scope, image),
        secrets: (0, secrets_1.buildSecrets)(scope, config.task.secrets),
        logGroup: buildLogGroup(scope, config),
    };
}
function buildTaskDefinition(scope, config, context, options = {}) {
    const suffix = options.idSuffix ?? '';
    const task = config.task;
    const taskDefinition = new ecs.FargateTaskDefinition(scope, `TaskDefinition${suffix}`, {
        family: options.family ?? config.name,
        cpu: options.cpu ?? task.cpu,
        memoryLimitMiB: options.memory ?? task.memory,
        executionRole: context.executionRole,
        taskRole: context.taskRole,
        runtimePlatform: {
            cpuArchitecture: task.cpuArchitecture === 'ARM64' ? ecs.CpuArchitecture.ARM64 : ecs.CpuArchitecture.X86_64,
            operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
        ...(task.ephemeralStorageGiB !== undefined && {
            ephemeralStorageGiB: task.ephemeralStorageGiB,
        }),
    });
    const container = taskDefinition.addContainer(`Container${suffix}`, {
        containerName: config.name,
        image: context.image,
        environment: options.environment ?? task.environment,
        secrets: context.secrets,
        entryPoint: task.entryPoint,
        command: options.command ?? task.command,
        logging: ecs.LogDrivers.awsLogs({
            streamPrefix: config.name,
            logGroup: context.logGroup,
        }),
        stopTimeout: cdk.Duration.seconds(task.stopTimeoutSeconds),
        ...(options.containerPort !== undefined && {
            portMappings: [{ containerPort: options.containerPort, protocol: ecs.Protocol.TCP }],
        }),
    });
    return { taskDefinition, container };
}
/**
 * One log group per stack, shared by every task definition in it.
 *
 * Created explicitly rather than through CDK's `logRetention` option so that
 * retention is a property of a real resource instead of a custom-resource
 * Lambda — one fewer permission the deploying principal needs, and one fewer
 * Lambda left behind in the account.
 */
function buildLogGroup(scope, config) {
    return new logs.LogGroup(scope, 'LogGroup', {
        logGroupName: config.task.logGroupName,
        retention: config.task.logRetentionDays === 0
            ? logs.RetentionDays.INFINITE
            : config.task.logRetentionDays,
        // Retaining is the safe default for an audit trail, but it means a destroyed
        // stack leaves the group behind and recreating it fails with "already
        // exists". `task.retainLogsOnDelete: false` is the way out.
        removalPolicy: config.task.retainLogsOnDelete
            ? cdk.RemovalPolicy.RETAIN
            : cdk.RemovalPolicy.DESTROY,
    });
}
//# sourceMappingURL=base.js.map