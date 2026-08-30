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
exports.FargateServiceStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const acm = __importStar(require("aws-cdk-lib/aws-certificatemanager"));
const ec2 = __importStar(require("aws-cdk-lib/aws-ec2"));
const ecs = __importStar(require("aws-cdk-lib/aws-ecs"));
const elbv2 = __importStar(require("aws-cdk-lib/aws-elasticloadbalancingv2"));
const base_1 = require("./base");
/**
 * A long-running Fargate service, optionally registered behind an existing
 * Application Load Balancer.
 *
 * This stack attaches to infrastructure you already own — cluster, VPC, subnets,
 * load balancer, certificate — and creates only what belongs to this one
 * service: the task definition, the service, its target group and listener rule,
 * its log group, and (when you did not supply them) a security group and IAM
 * roles.
 */
class FargateServiceStack extends cdk.Stack {
    service;
    targetGroup;
    constructor(scope, id, props) {
        super(scope, id, props);
        const { config, image } = props;
        const context = (0, base_1.buildContext)(this, config, image);
        const { taskDefinition } = (0, base_1.buildTaskDefinition)(this, config, context, {
            containerPort: config.task.containerPort,
        });
        this.service = new ecs.FargateService(this, 'Service', {
            cluster: context.cluster,
            taskDefinition,
            serviceName: config.name,
            desiredCount: config.service.desiredCount,
            minHealthyPercent: config.service.minHealthyPercent,
            maxHealthyPercent: config.service.maxHealthyPercent,
            enableExecuteCommand: config.service.enableExecuteCommand,
            circuitBreaker: config.service.circuitBreaker ? { enable: true, rollback: true } : undefined,
            propagateTags: ecs.PropagatedTagSource.SERVICE,
            assignPublicIp: config.network.assignPublicIp,
            securityGroups: context.securityGroups,
            vpcSubnets: context.subnetSelection,
            ...(config.service.healthCheckGracePeriodSeconds !== undefined && {
                healthCheckGracePeriod: cdk.Duration.seconds(config.service.healthCheckGracePeriodSeconds),
            }),
        });
        if (config.loadBalancer) {
            this.targetGroup = this.attachToLoadBalancer(config, context, config.loadBalancer);
        }
        if (config.autoScaling) {
            this.configureAutoScaling(config, this.targetGroup);
        }
        this.addOutputs(config);
    }
    attachToLoadBalancer(config, context, lb) {
        const albSecurityGroup = lb.securityGroupId
            ? ec2.SecurityGroup.fromSecurityGroupId(this, 'AlbSecurityGroup', lb.securityGroupId, {
                mutable: false,
            })
            : undefined;
        // Let the ALB reach the container. On a security group we created this is a
        // plain ingress rule; on an imported one CDK emits a standalone
        // AWS::EC2::SecurityGroupIngress so the shared group itself is untouched.
        if (lb.manageSecurityGroupRules && albSecurityGroup) {
            for (const sg of context.securityGroups) {
                sg.addIngressRule(albSecurityGroup, ec2.Port.tcp(lb.targetPort), `Load balancer to ${config.name} on ${lb.targetPort}`);
            }
        }
        const targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
            vpc: context.vpc,
            port: lb.targetPort,
            protocol: lb.targetProtocol === 'HTTPS' ? elbv2.ApplicationProtocol.HTTPS : elbv2.ApplicationProtocol.HTTP,
            targetType: elbv2.TargetType.IP,
            targetGroupName: lb.targetGroupName,
            deregistrationDelay: cdk.Duration.seconds(lb.deregistrationDelaySeconds),
            healthCheck: {
                path: lb.healthCheck.path,
                protocol: lb.targetProtocol === 'HTTPS' ? elbv2.Protocol.HTTPS : elbv2.Protocol.HTTP,
                interval: cdk.Duration.seconds(lb.healthCheck.intervalSeconds),
                timeout: cdk.Duration.seconds(lb.healthCheck.timeoutSeconds),
                healthyThresholdCount: lb.healthCheck.healthyThresholdCount,
                unhealthyThresholdCount: lb.healthCheck.unhealthyThresholdCount,
                healthyHttpCodes: lb.healthCheck.healthyHttpCodes,
            },
        });
        targetGroup.addTarget(this.service);
        const listener = this.resolveListener(context, lb, albSecurityGroup);
        if (lb.defaultAction) {
            listener.addTargetGroups('DefaultRule', { targetGroups: [targetGroup] });
            return targetGroup;
        }
        const conditions = [];
        if (lb.hostHeaders.length > 0) {
            conditions.push(elbv2.ListenerCondition.hostHeaders(lb.hostHeaders));
        }
        if (lb.pathPatterns.length > 0) {
            conditions.push(elbv2.ListenerCondition.pathPatterns(lb.pathPatterns));
        }
        listener.addTargetGroups('Rule', {
            priority: lb.priority,
            conditions,
            targetGroups: [targetGroup],
        });
        return targetGroup;
    }
    /**
     * Attach to the listener named in the manifest, or create one on the given
     * load balancer.
     *
     * The load balancer is only looked up in the create case. Attaching by
     * listener ARN — the common path — needs no describe permissions on the ALB
     * at all, which keeps the deploy policy small.
     */
    resolveListener(context, lb, albSecurityGroup) {
        if (lb.listenerArn) {
            return elbv2.ApplicationListener.fromApplicationListenerAttributes(this, 'Listener', {
                listenerArn: lb.listenerArn,
                // Only consulted if something asks CDK to open the listener's security
                // group, which nothing here does. Pass the ALB's group when we know it
                // so any such rule would land on the right group rather than the tasks'.
                securityGroup: albSecurityGroup ?? context.securityGroups[0],
            });
        }
        const loadBalancer = elbv2.ApplicationLoadBalancer.fromLookup(this, 'LoadBalancer', {
            loadBalancerArn: lb.loadBalancerArn,
        });
        const listener = new elbv2.ApplicationListener(this, 'Listener', {
            loadBalancer,
            port: lb.listenerPort,
            protocol: lb.listenerProtocol === 'HTTPS'
                ? elbv2.ApplicationProtocol.HTTPS
                : elbv2.ApplicationProtocol.HTTP,
            // A listener with no rules needs a default action; 404 until a rule matches.
            defaultAction: elbv2.ListenerAction.fixedResponse(404, {
                contentType: 'text/plain',
                messageBody: 'Not Found',
            }),
            ...(lb.certificateArn && {
                certificates: [acm.Certificate.fromCertificateArn(this, 'Certificate', lb.certificateArn)],
            }),
        });
        return listener;
    }
    configureAutoScaling(config, targetGroup) {
        const as = config.autoScaling;
        const scaling = this.service.autoScaleTaskCount({
            minCapacity: as.minCapacity,
            maxCapacity: as.maxCapacity,
        });
        const scaleIn = cdk.Duration.seconds(as.scaleInCooldownSeconds);
        const scaleOut = cdk.Duration.seconds(as.scaleOutCooldownSeconds);
        if (as.cpuTargetPercent !== undefined) {
            scaling.scaleOnCpuUtilization('CpuScaling', {
                targetUtilizationPercent: as.cpuTargetPercent,
                scaleInCooldown: scaleIn,
                scaleOutCooldown: scaleOut,
            });
        }
        if (as.memoryTargetPercent !== undefined) {
            scaling.scaleOnMemoryUtilization('MemoryScaling', {
                targetUtilizationPercent: as.memoryTargetPercent,
                scaleInCooldown: scaleIn,
                scaleOutCooldown: scaleOut,
            });
        }
        if (as.requestsPerTarget !== undefined && targetGroup) {
            scaling.scaleOnRequestCount('RequestScaling', {
                requestsPerTarget: as.requestsPerTarget,
                targetGroup,
                scaleInCooldown: scaleIn,
                scaleOutCooldown: scaleOut,
            });
        }
    }
    addOutputs(config) {
        new cdk.CfnOutput(this, 'ServiceNameOutput', {
            key: 'ServiceName',
            value: this.service.serviceName,
            description: 'ECS service name',
        });
        new cdk.CfnOutput(this, 'ClusterNameOutput', {
            key: 'ClusterName',
            value: config.clusterName,
            description: 'ECS cluster name',
        });
        if (this.targetGroup) {
            new cdk.CfnOutput(this, 'TargetGroupArnOutput', {
                key: 'TargetGroupArn',
                value: this.targetGroup.targetGroupArn,
                description: 'ALB target group ARN',
            });
        }
    }
}
exports.FargateServiceStack = FargateServiceStack;
//# sourceMappingURL=service-stack.js.map