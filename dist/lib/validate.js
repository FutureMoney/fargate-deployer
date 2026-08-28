"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateManifest = validateManifest;
const errors_1 = require("./errors");
/**
 * Manifest validation.
 *
 * Hand written rather than schema driven, because the useful errors here are the
 * cross-field ones — "you asked for a HTTPS listener but gave no certificate",
 * "4096 MiB of memory is not valid with 1024 CPU units". A JSON Schema
 * (`schema/manifest.schema.json`) ships alongside for editor autocomplete, and
 * a test keeps the examples valid under both.
 *
 * Every check appends to a collector rather than throwing, so one run reports
 * every problem in the file.
 */
/** Valid Fargate CPU → memory (MiB) combinations. */
const FARGATE_SIZES = {
    256: { min: 512, max: 2048, step: 512 },
    512: { min: 1024, max: 4096, step: 1024 },
    1024: { min: 2048, max: 8192, step: 1024 },
    2048: { min: 4096, max: 16384, step: 1024 },
    4096: { min: 8192, max: 30720, step: 1024 },
    8192: { min: 16384, max: 61440, step: 4096 },
    16384: { min: 32768, max: 122880, step: 8192 },
};
const VALID_LOG_RETENTION_DAYS = [
    0, 1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922,
    3288, 3653,
];
const KINDS = ['Service', 'ScheduledTasks'];
const SCHEDULE_PATTERN = /^(cron\(.+\)|rate\(\d+\s+(minute|minutes|hour|hours|day|days)\))$/;
function validateManifest(raw, source) {
    const issues = new errors_1.IssueCollector();
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        issues.add('(root)', 'manifest must be a YAML or JSON object', 'The file parsed to something else — check for a stray list or an empty file.');
        issues.throwIfAny(source);
    }
    const m = raw;
    // -- identity ------------------------------------------------------------
    if (!KINDS.includes(m.kind)) {
        issues.add('kind', `must be one of ${KINDS.join(' | ')}${m.kind ? `, got ${JSON.stringify(m.kind)}` : ''}`, '`Service` for a long-running container, `ScheduledTasks` for cron jobs.');
    }
    requireString(issues, m, 'name');
    if (typeof m.name === 'string' && !/^[a-z0-9][a-z0-9-]{0,239}$/.test(m.name)) {
        issues.add('name', 'must be lowercase letters, digits and hyphens, starting with a letter or digit', 'It becomes the ECS service name, task family and (by default) the stack name.');
    }
    if (typeof m.account !== 'string' || !/^\d{12}$/.test(m.account)) {
        issues.add('account', 'must be a 12-digit AWS account ID as a string', 'Quote it in YAML — an unquoted number loses leading zeros.');
    }
    requireString(issues, m, 'region');
    optionalString(issues, m, 'stackName');
    optionalStringMap(issues, m, 'tags');
    // -- cluster / network ---------------------------------------------------
    if (!isObject(m.cluster)) {
        issues.add('cluster', 'is required', 'e.g. `cluster: { name: my-ecs-cluster }`');
    }
    else {
        requireString(issues, m.cluster, 'name', 'cluster.name');
    }
    if (!isObject(m.network)) {
        issues.add('network', 'is required', 'Supply at least `vpcId` and `subnets`.');
    }
    else {
        const n = m.network;
        if (typeof n.vpcId !== 'string' || !/^vpc-[0-9a-f]{8,}$/.test(n.vpcId)) {
            issues.add('network.vpcId', 'must be a VPC ID like `vpc-0abc123def456789`');
        }
        if (!Array.isArray(n.subnets) || n.subnets.length === 0) {
            issues.add('network.subnets', 'must list at least one subnet ID', 'Two subnets in different availability zones is the usual minimum for a load-balanced service.');
        }
        else {
            n.subnets.forEach((s, i) => {
                if (typeof s !== 'string' || !/^subnet-[0-9a-f]{8,}$/.test(s)) {
                    issues.add(`network.subnets[${i}]`, 'must be a subnet ID like `subnet-0abc123def456789`');
                }
            });
        }
        if (n.securityGroups !== undefined) {
            if (!Array.isArray(n.securityGroups)) {
                issues.add('network.securityGroups', 'must be a list of security group IDs', 'Omit it entirely to have one created for you.');
            }
            else {
                n.securityGroups.forEach((sg, i) => {
                    if (typeof sg !== 'string' || !/^sg-[0-9a-f]{8,}$/.test(sg)) {
                        issues.add(`network.securityGroups[${i}]`, 'must be a security group ID like `sg-0abc123def456789`');
                    }
                });
            }
        }
        optionalBoolean(issues, n, 'assignPublicIp', 'network.assignPublicIp');
    }
    // -- roles ---------------------------------------------------------------
    if (m.roles !== undefined) {
        if (!isObject(m.roles)) {
            issues.add('roles', 'must be an object with `executionRoleArn` and/or `taskRoleArn`');
        }
        else {
            optionalArn(issues, m.roles, 'executionRoleArn', 'iam', 'roles.executionRoleArn');
            optionalArn(issues, m.roles, 'taskRoleArn', 'iam', 'roles.taskRoleArn');
        }
    }
    // -- task ----------------------------------------------------------------
    if (!isObject(m.task)) {
        issues.add('task', 'is required', 'At minimum `cpu` and `memory`.');
    }
    else {
        validateTaskSize(issues, m.task.cpu, m.task.memory, 'task');
        optionalPort(issues, m.task, 'containerPort', 'task.containerPort');
        optionalStringArray(issues, m.task, 'command', 'task.command');
        optionalStringArray(issues, m.task, 'entryPoint', 'task.entryPoint');
        optionalStringMap(issues, m.task, 'environment', 'task.environment');
        validateSecrets(issues, m.task.secrets);
        optionalString(issues, m.task, 'logGroupName', 'task.logGroupName');
        if (m.task.logRetentionDays !== undefined && !VALID_LOG_RETENTION_DAYS.includes(m.task.logRetentionDays)) {
            issues.add('task.logRetentionDays', `must be one of ${VALID_LOG_RETENTION_DAYS.join(', ')}`, 'CloudWatch only accepts these retention periods. 0 means never expire.');
        }
        optionalBoolean(issues, m.task, 'retainLogsOnDelete', 'task.retainLogsOnDelete');
        optionalNumberRange(issues, m.task, 'stopTimeoutSeconds', 2, 120, 'task.stopTimeoutSeconds');
        optionalNumberRange(issues, m.task, 'ephemeralStorageGiB', 21, 200, 'task.ephemeralStorageGiB');
        if (m.task.runtimePlatform !== undefined) {
            const arch = m.task.runtimePlatform?.cpuArchitecture;
            if (arch !== undefined && arch !== 'X86_64' && arch !== 'ARM64') {
                issues.add('task.runtimePlatform.cpuArchitecture', 'must be `X86_64` or `ARM64`', 'Use ARM64 only if your image is built for it (`docker buildx --platform linux/arm64`).');
            }
        }
    }
    // -- kind-specific -------------------------------------------------------
    if (m.kind === 'Service') {
        validateService(issues, m);
        if (m.tasks !== undefined) {
            issues.add('tasks', 'is only valid when `kind: ScheduledTasks`', 'A `Service` runs continuously; it has no schedule.');
        }
    }
    else if (m.kind === 'ScheduledTasks') {
        validateScheduledTasks(issues, m);
        for (const field of ['service', 'loadBalancer', 'autoScaling']) {
            if (m[field] !== undefined) {
                issues.add(field, 'is only valid when `kind: Service`', 'Scheduled tasks run to completion, so they are not load balanced or auto scaled.');
            }
        }
    }
    issues.throwIfAny(source);
    return m;
}
// ---------------------------------------------------------------------------
function validateService(issues, m) {
    if (m.service !== undefined) {
        if (!isObject(m.service)) {
            issues.add('service', 'must be an object');
        }
        else {
            const s = m.service;
            optionalNumberRange(issues, s, 'desiredCount', 0, 5000, 'service.desiredCount');
            optionalNumberRange(issues, s, 'minHealthyPercent', 0, 100, 'service.minHealthyPercent');
            optionalNumberRange(issues, s, 'maxHealthyPercent', 100, 200, 'service.maxHealthyPercent');
            optionalBoolean(issues, s, 'enableExecuteCommand', 'service.enableExecuteCommand');
            optionalBoolean(issues, s, 'circuitBreaker', 'service.circuitBreaker');
            optionalNumberRange(issues, s, 'healthCheckGracePeriodSeconds', 0, 2147483647, 'service.healthCheckGracePeriodSeconds');
        }
    }
    const lb = m.loadBalancer;
    const lbEnabled = isObject(lb) && lb.enabled !== false;
    if (lb !== undefined && !isObject(lb)) {
        issues.add('loadBalancer', 'must be an object', 'Omit it entirely for a service with no load balancer.');
    }
    else if (lbEnabled) {
        if (!lb.listenerArn && !lb.loadBalancerArn) {
            issues.add('loadBalancer', 'needs either `listenerArn` or `loadBalancerArn`', 'Attach to an existing listener with `listenerArn` (recommended, lets services share one ALB), ' +
                'or give `loadBalancerArn` to have a listener created on that load balancer.');
        }
        optionalArn(issues, lb, 'listenerArn', 'elasticloadbalancing', 'loadBalancer.listenerArn');
        optionalArn(issues, lb, 'loadBalancerArn', 'elasticloadbalancing', 'loadBalancer.loadBalancerArn');
        optionalArn(issues, lb, 'certificateArn', 'acm', 'loadBalancer.certificateArn');
        if (lb.securityGroupId !== undefined && !/^sg-[0-9a-f]{8,}$/.test(String(lb.securityGroupId))) {
            issues.add('loadBalancer.securityGroupId', 'must be a security group ID like `sg-0abc123def456789`', "This is the *load balancer's* security group. It is used to allow the ALB into the task security group.");
        }
        if (lb.securityGroupId === undefined && lb.manageSecurityGroupRules !== false) {
            issues.add('loadBalancer.securityGroupId', 'is required so the ALB can reach your tasks', 'Give the load balancer\'s security group ID, or set `manageSecurityGroupRules: false` if you ' +
                'manage that ingress rule yourself.');
        }
        const protocol = lb.listenerProtocol ?? 'HTTPS';
        if (protocol !== 'HTTP' && protocol !== 'HTTPS') {
            issues.add('loadBalancer.listenerProtocol', 'must be `HTTP` or `HTTPS`');
        }
        if (lb.loadBalancerArn && !lb.listenerArn && protocol === 'HTTPS' && !lb.certificateArn) {
            issues.add('loadBalancer.certificateArn', 'is required to create an HTTPS listener', 'Either give an ACM certificate ARN, set `listenerProtocol: HTTP`, or attach to an existing ' +
                'listener with `listenerArn` (its certificate is used instead).');
        }
        if (lb.targetProtocol !== undefined && lb.targetProtocol !== 'HTTP' && lb.targetProtocol !== 'HTTPS') {
            issues.add('loadBalancer.targetProtocol', 'must be `HTTP` or `HTTPS`');
        }
        optionalPort(issues, lb, 'listenerPort', 'loadBalancer.listenerPort');
        optionalPort(issues, lb, 'targetPort', 'loadBalancer.targetPort');
        if (lb.targetPort === undefined && m.task?.containerPort === undefined) {
            issues.add('task.containerPort', 'is required for a load-balanced service', 'Set `task.containerPort` (and optionally a different `loadBalancer.targetPort`).');
        }
        optionalNumberRange(issues, lb, 'priority', 1, 50000, 'loadBalancer.priority');
        optionalNumberRange(issues, lb, 'deregistrationDelaySeconds', 0, 3600, 'loadBalancer.deregistrationDelaySeconds');
        optionalBoolean(issues, lb, 'defaultAction', 'loadBalancer.defaultAction');
        optionalBoolean(issues, lb, 'manageSecurityGroupRules', 'loadBalancer.manageSecurityGroupRules');
        const hosts = toArray(lb.hostHeaders);
        const paths = toArray(lb.pathPatterns);
        if (lb.defaultAction === true && (hosts.length > 0 || paths.length > 0)) {
            issues.add('loadBalancer.defaultAction', 'cannot be combined with `hostHeaders` or `pathPatterns`', 'A default action matches everything the other rules do not, so it takes no conditions.');
        }
        if (lb.defaultAction !== true && hosts.length === 0 && paths.length === 0) {
            issues.add('loadBalancer.hostHeaders', 'is required unless `defaultAction: true`', 'Without a condition the listener has nothing to match on. Give a host header ' +
                '(e.g. `api.example.com`), a path pattern, or make this the listener default.');
        }
        if (lb.targetGroupName !== undefined && !/^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/.test(String(lb.targetGroupName))) {
            issues.add('loadBalancer.targetGroupName', 'must be ≤32 characters of letters, digits and hyphens');
        }
        validateHealthCheck(issues, lb.healthCheck);
    }
    const as = m.autoScaling;
    if (as !== undefined) {
        if (!isObject(as)) {
            issues.add('autoScaling', 'must be an object', 'Omit it entirely for a fixed task count.');
        }
        else if (as.enabled !== false) {
            if (typeof as.maxCapacity !== 'number') {
                issues.add('autoScaling.maxCapacity', 'is required when auto scaling is enabled');
            }
            optionalNumberRange(issues, as, 'minCapacity', 0, 5000, 'autoScaling.minCapacity');
            optionalNumberRange(issues, as, 'maxCapacity', 1, 5000, 'autoScaling.maxCapacity');
            if (typeof as.minCapacity === 'number' &&
                typeof as.maxCapacity === 'number' &&
                as.minCapacity > as.maxCapacity) {
                issues.add('autoScaling.minCapacity', `(${as.minCapacity}) cannot exceed maxCapacity (${as.maxCapacity})`);
            }
            optionalNumberRange(issues, as, 'cpuTargetPercent', 1, 100, 'autoScaling.cpuTargetPercent');
            optionalNumberRange(issues, as, 'memoryTargetPercent', 1, 100, 'autoScaling.memoryTargetPercent');
            optionalNumberRange(issues, as, 'requestsPerTarget', 1, 1000000, 'autoScaling.requestsPerTarget');
            optionalNumberRange(issues, as, 'scaleInCooldownSeconds', 0, 86400, 'autoScaling.scaleInCooldownSeconds');
            optionalNumberRange(issues, as, 'scaleOutCooldownSeconds', 0, 86400, 'autoScaling.scaleOutCooldownSeconds');
            const hasPolicy = as.cpuTargetPercent !== undefined ||
                as.memoryTargetPercent !== undefined ||
                as.requestsPerTarget !== undefined;
            if (!hasPolicy) {
                issues.add('autoScaling', 'needs at least one scaling target', 'Set `cpuTargetPercent`, `memoryTargetPercent` and/or `requestsPerTarget`. ' +
                    'Without one, capacity would never change.');
            }
            if (as.requestsPerTarget !== undefined && !isObject(m.loadBalancer)) {
                issues.add('autoScaling.requestsPerTarget', 'requires a load balancer', 'Request-count scaling reads ALB metrics. Use CPU or memory targets for a service with no ALB.');
            }
        }
    }
}
function validateScheduledTasks(issues, m) {
    if (!Array.isArray(m.tasks) || m.tasks.length === 0) {
        issues.add('tasks', 'must list at least one scheduled job', 'e.g. `- { name: nightly-sync, schedule: "cron(0 6 * * ? *)" }`');
        return;
    }
    const seen = new Set();
    m.tasks.forEach((task, i) => {
        const at = `tasks[${i}]`;
        if (!isObject(task)) {
            issues.add(at, 'must be an object');
            return;
        }
        if (typeof task.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(task.name)) {
            issues.add(`${at}.name`, 'must be ≤64 characters of letters, digits, dots, hyphens and underscores', 'It becomes part of the EventBridge rule name.');
        }
        else if (seen.has(task.name)) {
            issues.add(`${at}.name`, `duplicates an earlier task named "${task.name}"`, 'Rule names must be unique within the stack.');
        }
        else {
            seen.add(task.name);
        }
        if (typeof task.schedule !== 'string' || !SCHEDULE_PATTERN.test(task.schedule)) {
            issues.add(`${at}.schedule`, 'must be a `cron(...)` or `rate(...)` expression', 'e.g. `cron(0 6 * * ? *)` for 06:00 UTC daily, or `rate(1 hour)`. ' +
                'EventBridge cron has six fields and needs `?` in either day-of-month or day-of-week.');
        }
        optionalString(issues, task, 'description', `${at}.description`);
        optionalBoolean(issues, task, 'enabled', `${at}.enabled`);
        optionalStringArray(issues, task, 'command', `${at}.command`);
        optionalStringMap(issues, task, 'environment', `${at}.environment`);
        optionalNumberRange(issues, task, 'maxEventAgeMinutes', 1, 1440, `${at}.maxEventAgeMinutes`);
        optionalNumberRange(issues, task, 'retryAttempts', 0, 185, `${at}.retryAttempts`);
        if (task.cpu !== undefined || task.memory !== undefined) {
            validateTaskSize(issues, task.cpu ?? m.task?.cpu, task.memory ?? m.task?.memory, at);
        }
    });
}
function validateHealthCheck(issues, hc) {
    if (hc === undefined)
        return;
    if (!isObject(hc)) {
        issues.add('loadBalancer.healthCheck', 'must be an object');
        return;
    }
    const h = hc;
    if (h.path !== undefined && (typeof h.path !== 'string' || !h.path.startsWith('/'))) {
        issues.add('loadBalancer.healthCheck.path', 'must be a path starting with `/`', 'e.g. `/health`');
    }
    optionalNumberRange(issues, h, 'intervalSeconds', 5, 300, 'loadBalancer.healthCheck.intervalSeconds');
    optionalNumberRange(issues, h, 'timeoutSeconds', 2, 120, 'loadBalancer.healthCheck.timeoutSeconds');
    optionalNumberRange(issues, h, 'healthyThresholdCount', 2, 10, 'loadBalancer.healthCheck.healthyThresholdCount');
    optionalNumberRange(issues, h, 'unhealthyThresholdCount', 2, 10, 'loadBalancer.healthCheck.unhealthyThresholdCount');
    const interval = h.intervalSeconds ?? 30;
    const timeout = h.timeoutSeconds ?? 5;
    if (typeof interval === 'number' && typeof timeout === 'number' && timeout >= interval) {
        issues.add('loadBalancer.healthCheck.timeoutSeconds', `(${timeout}s) must be less than intervalSeconds (${interval}s)`, 'The ALB rejects a timeout that is not shorter than the interval.');
    }
    if (h.healthyHttpCodes !== undefined && !/^\d{3}(-\d{3})?(,\d{3}(-\d{3})?)*$/.test(String(h.healthyHttpCodes))) {
        issues.add('loadBalancer.healthCheck.healthyHttpCodes', 'must be codes or ranges, e.g. `200`, `200,301`, `200-399`');
    }
}
function validateTaskSize(issues, cpu, memory, at) {
    if (typeof cpu !== 'number') {
        issues.add(`${at}.cpu`, 'is required and must be a number', `Valid Fargate values: ${Object.keys(FARGATE_SIZES).join(', ')} (1024 = 1 vCPU).`);
        return;
    }
    const size = FARGATE_SIZES[cpu];
    if (!size) {
        issues.add(`${at}.cpu`, `${cpu} is not a valid Fargate CPU value`, `Valid values: ${Object.keys(FARGATE_SIZES).join(', ')} (1024 = 1 vCPU).`);
        return;
    }
    if (typeof memory !== 'number') {
        issues.add(`${at}.memory`, 'is required and must be a number in MiB', `With cpu ${cpu}, memory must be ${size.min}–${size.max} MiB in ${size.step} MiB steps.`);
        return;
    }
    if (memory < size.min || memory > size.max || (memory - size.min) % size.step !== 0) {
        issues.add(`${at}.memory`, `${memory} MiB is not valid with cpu ${cpu}`, `With cpu ${cpu}, memory must be ${size.min}–${size.max} MiB in ${size.step} MiB steps.`);
    }
}
function validateSecrets(issues, secrets) {
    if (secrets === undefined)
        return;
    if (!isObject(secrets)) {
        issues.add('task.secrets', 'must be a map of environment variable name to ARN');
        return;
    }
    for (const [key, value] of Object.entries(secrets)) {
        if (typeof value !== 'string') {
            issues.add(`task.secrets.${key}`, 'must be a string ARN');
            continue;
        }
        const isSecretsManager = value.includes(':secretsmanager:');
        const isSsm = value.includes(':ssm:');
        if (!value.startsWith('arn:') || (!isSecretsManager && !isSsm)) {
            issues.add(`task.secrets.${key}`, 'must be a Secrets Manager or SSM Parameter Store ARN', 'e.g. `arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/db-AbCdEf:password::` ' +
                'or `arn:aws:ssm:us-east-1:111122223333:parameter/prod/api-key`');
        }
    }
}
// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function toArray(value) {
    if (value === undefined || value === null)
        return [];
    return Array.isArray(value) ? value.map(String) : [String(value)];
}
function requireString(issues, obj, field, path = field) {
    if (typeof obj[field] !== 'string' || obj[field].length === 0) {
        issues.add(path, 'is required and must be a non-empty string');
    }
}
function optionalString(issues, obj, field, path = field) {
    if (obj[field] !== undefined && typeof obj[field] !== 'string') {
        issues.add(path, 'must be a string');
    }
}
function optionalBoolean(issues, obj, field, path = field) {
    if (obj[field] !== undefined && typeof obj[field] !== 'boolean') {
        issues.add(path, 'must be true or false');
    }
}
function optionalPort(issues, obj, field, path = field) {
    const value = obj[field];
    if (value === undefined)
        return;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) {
        issues.add(path, 'must be a port number between 1 and 65535');
    }
}
function optionalNumberRange(issues, obj, field, min, max, path = field) {
    const value = obj[field];
    if (value === undefined)
        return;
    if (typeof value !== 'number' || Number.isNaN(value)) {
        issues.add(path, 'must be a number');
    }
    else if (value < min || value > max) {
        issues.add(path, `must be between ${min} and ${max}, got ${value}`);
    }
}
function optionalStringArray(issues, obj, field, path = field) {
    const value = obj[field];
    if (value === undefined)
        return;
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
        issues.add(path, 'must be a list of strings', 'Use argv form: `["node", "dist/job.js"]`, not a single shell string.');
    }
}
function optionalStringMap(issues, obj, field, path = field) {
    const value = obj[field];
    if (value === undefined)
        return;
    if (!isObject(value)) {
        issues.add(path, 'must be a map of string to string');
        return;
    }
    for (const [k, v] of Object.entries(value)) {
        if (typeof v !== 'string') {
            issues.add(`${path}.${k}`, `must be a string, got ${typeof v}`, typeof v === 'number' || typeof v === 'boolean'
                ? `Quote it: "${String(v)}". Container environment values are always strings.`
                : undefined);
        }
    }
}
function optionalArn(issues, obj, field, service, path = field) {
    const value = obj[field];
    if (value === undefined)
        return;
    if (typeof value !== 'string' || !value.startsWith('arn:')) {
        issues.add(path, `must be an ARN`);
        return;
    }
    if (!value.includes(`:${service}:`)) {
        issues.add(path, `must be a ${service} ARN, got ${value.split(':')[2] ?? 'something else'}`);
    }
}
//# sourceMappingURL=validate.js.map