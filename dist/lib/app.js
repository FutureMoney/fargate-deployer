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
exports.createStack = createStack;
const cdk = __importStar(require("aws-cdk-lib"));
const service_stack_1 = require("./service-stack");
const scheduled_tasks_stack_1 = require("./scheduled-tasks-stack");
/**
 * Build the single-stack CDK app the CLI synthesizes.
 *
 * Exported so it can be reused: if you already have a CDK app of your own, pass
 * it in and this adds the stack to it rather than creating a second one.
 */
function createStack(options) {
    const { config, image } = options;
    const app = options.app ?? new cdk.App();
    const props = {
        stackName: config.stackName,
        env: { account: config.account, region: config.region },
        description: config.kind === 'Service'
            ? `Fargate service ${config.name} (fargate-deployer)`
            : `Scheduled tasks ${config.name} (fargate-deployer)`,
        tags: config.tags,
    };
    const stack = config.kind === 'Service'
        ? new service_stack_1.FargateServiceStack(app, config.stackName, { ...props, config, image })
        : new scheduled_tasks_stack_1.ScheduledTasksStack(app, config.stackName, { ...props, config, image });
    cdk.Tags.of(stack).add('ManagedBy', 'fargate-deployer');
    return stack;
}
//# sourceMappingURL=app.js.map