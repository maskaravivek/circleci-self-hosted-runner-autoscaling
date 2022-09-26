import {
  aws_secretsmanager as secretsmanager,
  aws_events as events,
  aws_ec2 as ec2,
  aws_lambda as lambda,
  aws_iam as iam,
  aws_autoscaling as autoscaling,
  aws_events_targets as targets,
  Duration,
  Stack, SecretValue
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { readFileSync } from 'fs';
import * as cdk from 'aws-cdk-lib';
const { env } = require("process");

export interface CircleciSelfHostedRunnerAutoscalingStackProps extends cdk.StackProps {
  maxInstances: string;
  keypairName: string;
  runnerName: string;
}

export class CircleciSelfHostedRunnerAutoscalingStack extends Stack {
  constructor(scope: Construct, id: string, props?: CircleciSelfHostedRunnerAutoscalingStackProps) {
    super(scope, id, props);

    // configuring EC2
    const circleCIVpc = new ec2.Vpc(this, "CircleCISelfHostedRunnerVPC", {
      maxAzs: 1,
      subnetConfiguration: [{
        name: 'public-subnet-1',
        subnetType: ec2.SubnetType.PUBLIC,
        cidrMask: 24,
      }]
    });

    const circleCISecurityGroup = new ec2.SecurityGroup(this, 'CircleCISelfHostedRunnerSecurityGroup', {
      vpc: circleCIVpc,
    });

    circleCISecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      'allow SSH access from anywhere',
    );

    const instanceTypeName = "t3.micro"
    const instanceType = new ec2.InstanceType(instanceTypeName);

    const amiSamParameterName = '/aws/service/canonical/ubuntu/server/focal/stable/current/amd64/hvm/ebs-gp2/ami-id'
    
    const ami = ec2.MachineImage.fromSsmParameter(
      amiSamParameterName, {
      os: ec2.OperatingSystemType.LINUX
    });
    
    const circleCiAutoScalingGroup = new autoscaling.AutoScalingGroup(this, 'CircleCiSelfHostedRunnerASG', {
      vpc: circleCIVpc,
      instanceType: instanceType,
      machineImage: ami,
      securityGroup: circleCISecurityGroup,
      keyName: props!!.keypairName,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC
      },
      minCapacity: 0,
      maxCapacity: Number(props!!.maxInstances),
    });

    let userDataScript = readFileSync('./scripts/install_runner.sh', 'utf8');
    
    userDataScript = userDataScript.replace('<SELF_HOSTED_RUNNER_AUTH_TOKEN>', env.SELF_HOSTED_RUNNER_AUTH_TOKEN);
    userDataScript = userDataScript.replace('<SELF_HOSTED_RUNNER_NAME>', props!!.runnerName);

    circleCiAutoScalingGroup.addUserData(userDataScript);

    const circleCISecret = new secretsmanager.Secret(this, 'CircleCiSelfHostedRunnerSecret', {
      secretName: 'circleci-self-hosted-runner-secret',
      secretObjectValue: {
        "resource_class": SecretValue.unsafePlainText(env.SELF_HOSTED_RUNNER_RESOURCE_CLASS),
        "circle_token": SecretValue.unsafePlainText(env.CIRCLECI_TOKEN),
      }
    });

    const lambdaPolicyDocument = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          resources: [circleCiAutoScalingGroup.autoScalingGroupArn],
          actions: ["autoscaling:UpdateAutoScalingGroup"],
        }),
        new iam.PolicyStatement({
          resources: [circleCISecret.secretArn],
          actions: ["secretsmanager:GetSecretValue"],
        })
      ],
    });

    const inferenceLambdaRole = new iam.Role(this, `CircleCIAutoScalingLambdaRole`, {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "Role assumed by auto scaling lambda",
      inlinePolicies: {
        lambdaPolicy: lambdaPolicyDocument,
      },
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")
      ]
    });

    const autoScalingLambda = new lambda.Function(this, 'CircleCiSelfHostedRunnerAutoScalingLambda', {
      functionName: 'CircleCiSelfHostedRunnerAutoScalingLambda',
      code: lambda.Code.fromAsset('./lambda/auto-scaling-lambda/'),
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: "index.handler",
      environment: {
        "SECRET_NAME": circleCISecret.secretName,
        "SECRET_REGION": props?.env?.region || 'us-west-2',
        "AUTO_SCALING_MAX": props!!.maxInstances,
        "AUTO_SCALING_GROUP_NAME": circleCiAutoScalingGroup.autoScalingGroupName,
        "AUTO_SCALING_GROUP_REGION": props?.env?.region || 'us-west-2'
      },
      timeout: Duration.minutes(1),
      role: inferenceLambdaRole
    });

    const eventRule = new events.Rule(this, 'CircleCiLambdaSchedule', {
      schedule: events.Schedule.rate(Duration.minutes(1)),
    });

    eventRule.addTarget(new targets.LambdaFunction(autoScalingLambda))
  }
}
