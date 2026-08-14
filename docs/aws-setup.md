# AWS setup

What has to exist in your AWS account before the first deploy, and how to give
GitHub Actions permission to do it.

- [Prerequisites](#prerequisites)
- [1. Bootstrap CDK](#1-bootstrap-cdk)
- [2. Create the GitHub OIDC provider](#2-create-the-github-oidc-provider)
- [3. Create the deploy role](#3-create-the-deploy-role)
- [Everything at once: CloudFormation](#everything-at-once-cloudformation)
- [Finding the ARNs your manifest needs](#finding-the-arns-your-manifest-needs)
- [Starting from nothing](#starting-from-nothing)
- [Using static access keys instead](#using-static-access-keys-instead)
- [Tightening the blast radius](#tightening-the-blast-radius)

---

## Prerequisites

| | Why |
| --- | --- |
| A VPC with at least one subnet | Where tasks run |
| An ECS cluster | `aws ecs create-cluster --cluster-name my-cluster` — nothing else needed |
| An Application Load Balancer with a listener | Only for `kind: Service` with a load balancer |
| CDK bootstrapped in the account and region | The deployer runs on CDK |

If you have none of these, see [starting from nothing](#starting-from-nothing).

## 1. Bootstrap CDK

Once per account **and** region, from a shell with administrator credentials:

```bash
npx cdk bootstrap aws://111122223333/us-east-1
```

This creates a small CloudFormation stack (`CDKToolkit`) holding a staging
bucket and four IAM roles. Deployments assume those roles, which is what keeps
the permissions your GitHub role needs so small.

The action can do this for you on a first run with `bootstrap: true`, but that
requires giving the workflow far more permission than it otherwise needs. Do it
once by hand and leave the input off.

## 2. Create the GitHub OIDC provider

Once per account. This lets GitHub Actions exchange a short-lived workflow token
for AWS credentials, so no long-lived keys live in your repository.

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com
```

If it already exists you will get `EntityAlreadyExists` — that is fine, accounts
only get one.

## 3. Create the deploy role

### Trust policy

Restrict it to the repositories and branches that should be able to deploy. The
`sub` condition below allows only `main` of one repository:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::111122223333:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:my-org/my-repo:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

> Never leave the `sub` condition as `repo:my-org/*` or omit it. Without it, any
> repository on GitHub can assume your role.
>
> For deploys gated on a GitHub environment, `repo:my-org/my-repo:environment:production`
> is stronger still — it cannot be satisfied by a pull request.

### Permissions policy

Deliberately short. The heavy lifting is done by the bootstrap roles, which this
role is only allowed to assume:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AssumeCdkBootstrapRoles",
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": "arn:aws:iam::111122223333:role/cdk-hnb659fds-*-111122223333-us-east-1"
    },
    {
      "Sid": "EcrAuth",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "PushImages",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:PutImage",
        "ecr:BatchGetImage",
        "ecr:DescribeRepositories",
        "ecr:DescribeImages"
      ],
      "Resource": "arn:aws:ecr:us-east-1:111122223333:repository/*"
    },
    {
      "Sid": "CreateRepositoryOnFirstDeploy",
      "Effect": "Allow",
      "Action": "ecr:CreateRepository",
      "Resource": "*"
    },
    {
      "Sid": "WaitForServiceStability",
      "Effect": "Allow",
      "Action": ["ecs:DescribeServices"],
      "Resource": "*"
    }
  ]
}
```

Notes:

- `hnb659fds` is CDK's default bootstrap qualifier. If you bootstrapped with
  `--qualifier`, substitute yours.
- Drop `CreateRepositoryOnFirstDeploy` once the repository exists, and set
  `create-ecr-repository: false` on the action.
- Drop `WaitForServiceStability` if you set `wait-for-stability: false`.
- For a pull-request diff job, a role with only `sts:AssumeRole` on the
  bootstrap **lookup** role is enough — no push, no deploy.

## Everything at once: CloudFormation

Deploy this after bootstrapping to create the OIDC provider and the role:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: GitHub Actions deploy role for fargate-deployer

Parameters:
  GitHubRepository:
    Type: String
    Description: owner/repo allowed to deploy
  GitHubRef:
    Type: String
    Default: refs/heads/main
  CreateOidcProvider:
    Type: String
    AllowedValues: ['true', 'false']
    Default: 'true'
    Description: Set false if the account already has the GitHub OIDC provider

Conditions:
  ShouldCreateProvider: !Equals [!Ref CreateOidcProvider, 'true']

Resources:
  GitHubOidcProvider:
    Type: AWS::IAM::OIDCProvider
    Condition: ShouldCreateProvider
    Properties:
      Url: https://token.actions.githubusercontent.com
      ClientIdList: [sts.amazonaws.com]

  DeployRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: github-actions-deploy
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Federated: !Sub arn:${AWS::Partition}:iam::${AWS::AccountId}:oidc-provider/token.actions.githubusercontent.com
            Action: sts:AssumeRoleWithWebIdentity
            Condition:
              StringEquals:
                token.actions.githubusercontent.com:aud: sts.amazonaws.com
              StringLike:
                token.actions.githubusercontent.com:sub: !Sub repo:${GitHubRepository}:ref:${GitHubRef}
      Policies:
        - PolicyName: fargate-deployer
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action: sts:AssumeRole
                Resource: !Sub arn:${AWS::Partition}:iam::${AWS::AccountId}:role/cdk-hnb659fds-*-${AWS::AccountId}-${AWS::Region}
              - Effect: Allow
                Action:
                  - ecr:GetAuthorizationToken
                  - ecr:CreateRepository
                  - ecs:DescribeServices
                Resource: '*'
              - Effect: Allow
                Action:
                  - ecr:BatchCheckLayerAvailability
                  - ecr:InitiateLayerUpload
                  - ecr:UploadLayerPart
                  - ecr:CompleteLayerUpload
                  - ecr:PutImage
                  - ecr:BatchGetImage
                  - ecr:DescribeRepositories
                  - ecr:DescribeImages
                Resource: !Sub arn:${AWS::Partition}:ecr:${AWS::Region}:${AWS::AccountId}:repository/*

Outputs:
  RoleArn:
    Description: Pass this as role-to-assume
    Value: !GetAtt DeployRole.Arn
```

```bash
aws cloudformation deploy \
  --template-file github-deploy-role.yaml \
  --stack-name github-actions-deploy-role \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides GitHubRepository=my-org/my-repo
```

## Finding the ARNs your manifest needs

```bash
# VPC and subnets
aws ec2 describe-vpcs --query 'Vpcs[].[VpcId,Tags[?Key==`Name`].Value|[0]]' --output table
aws ec2 describe-subnets --filters Name=vpc-id,Values=vpc-0abc123def4567890 \
  --query 'Subnets[].[SubnetId,AvailabilityZone,MapPublicIpOnLaunch]' --output table

# Clusters
aws ecs list-clusters

# Load balancers, their listeners and their security groups
aws elbv2 describe-load-balancers \
  --query 'LoadBalancers[].[LoadBalancerName,LoadBalancerArn,SecurityGroups[0],Scheme]' --output table
aws elbv2 describe-listeners --load-balancer-arn <alb-arn> \
  --query 'Listeners[].[Port,Protocol,ListenerArn]' --output table

# Certificates
aws acm list-certificates --query 'CertificateSummaryList[].[DomainName,CertificateArn]' --output table

# Secrets — note the ARN suffix, it is part of the ARN
aws secretsmanager list-secrets --query 'SecretList[].[Name,ARN]' --output table
```

## Starting from nothing

If the account is empty, the shortest path to a first deploy:

```bash
# 1. A cluster (free — Fargate bills per task, not per cluster)
aws ecs create-cluster --cluster-name my-cluster

# 2. Bootstrap CDK
npx cdk bootstrap aws://111122223333/us-east-1
```

Then deploy a **worker-style** manifest first — no `loadBalancer` block. It
needs only the VPC, subnets and cluster, so you can confirm the pipeline works
before dealing with load balancers and certificates. Use the default VPC's
subnets with `assignPublicIp: true` if you have no NAT gateway.

Once that deploys, create a load balancer, request a certificate, add the
`loadBalancer` block, and deploy again.

## Using static access keys instead

Supported, but a last resort — the keys are long-lived and live in your
repository secrets:

```yaml
- uses: futuremoney/fargate-deployer@v1
  with:
    manifest: deploy/production.yaml
    aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

The IAM user needs the same permissions policy as the role above. Rotate the
keys on a schedule, and move to OIDC when you can.

## Tightening the blast radius

By default `cdk bootstrap` gives the CloudFormation execution role
`AdministratorAccess`. That role is what actually creates resources, so it
bounds what any deployment can do. To narrow it:

```bash
npx cdk bootstrap aws://111122223333/us-east-1 \
  --cloudformation-execution-policies arn:aws:iam::111122223333:policy/my-deploy-boundary
```

The policy has to cover everything the stacks create: `ecs:*`,
`elasticloadbalancing:*`, `logs:*`, `events:*`, `application-autoscaling:*`,
`ec2:*SecurityGroup*`, plus `iam:*Role*` and `iam:PassRole` if you let the
deployer create task roles. Supplying `roles` in every manifest lets you drop
the IAM permissions entirely — a reasonable trade for a locked-down account.
