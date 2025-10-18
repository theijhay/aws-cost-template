import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { CostControlStackProps, ResourceTags, ENVIRONMENT_CONFIGS } from './types';

export class CostControlStack extends cdk.Stack {
  public readonly costTrackingTable: dynamodb.Table;
  public readonly costReportBucket: s3.Bucket;
  public readonly costControlRole: iam.Role;

  constructor(scope: Construct, id: string, props: CostControlStackProps) {
    super(scope, id, props);

    const { projectName, environment, budget } = props;
    const envConfig = ENVIRONMENT_CONFIGS[environment] || ENVIRONMENT_CONFIGS.dev;

    // DynamoDB table for cost tracking and resource metadata
    this.costTrackingTable = new dynamodb.Table(this, 'CostTrackingTable', {
      tableName: `cost-tracking-${projectName}-${environment}`,
      partitionKey: {
        name: 'resourceId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: environment === 'prod',
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // Global Secondary Index for querying by project and environment
    this.costTrackingTable.addGlobalSecondaryIndex({
      indexName: 'ProjectEnvironmentIndex',
      partitionKey: {
        name: 'project',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'environment',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // S3 bucket for cost reports and analysis
    this.costReportBucket = new s3.Bucket(this, 'CostReportBucket', {
      bucketName: `cost-reports-${projectName}-${environment}-${cdk.Stack.of(this).account}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          id: 'cost-report-lifecycle',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
          expiration: cdk.Duration.days(365),
        },
      ],
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // IAM role for cost control automation
    this.costControlRole = new iam.Role(this, 'CostControlRole', {
      roleName: `cost-control-role-${projectName}-${environment}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        CostControlPolicy: new iam.PolicyDocument({
          statements: [
            // DynamoDB permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'dynamodb:GetItem',
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
                'dynamodb:DeleteItem',
                'dynamodb:Query',
                'dynamodb:Scan',
              ],
              resources: [this.costTrackingTable.tableArn, `${this.costTrackingTable.tableArn}/index/*`],
            }),
            // S3 permissions for cost reports
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
                's3:ListBucket',
              ],
              resources: [
                this.costReportBucket.bucketArn,
                `${this.costReportBucket.bucketArn}/*`,
              ],
            }),
            // Cost Explorer and Billing permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ce:GetCostAndUsage',
                'ce:GetDimensions',
                'ce:GetRightsizingRecommendation',
                'ce:GetUsageReport',
                'ce:DescribeCostCategoryDefinition',
                'ce:GetCostCategories',
                'budgets:ViewBudget',
                'budgets:ModifyBudget',
              ],
              resources: ['*'],
            }),
            // EC2 permissions for auto-shutdown
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ec2:DescribeInstances',
                'ec2:DescribeImages',
                'ec2:DescribeSnapshots',
                'ec2:DescribeVolumes',
                'ec2:StopInstances',
                'ec2:StartInstances',
                'ec2:TerminateInstances',
                'ec2:DeleteSnapshot',
                'ec2:DeleteVolume',
                'ec2:CreateTags',
                'ec2:DescribeTags',
              ],
              resources: ['*'],
              conditions: {
                StringEquals: {
                  'ec2:ResourceTag/Project': projectName,
                  'ec2:ResourceTag/Environment': environment,
                },
              },
            }),
            // CloudWatch permissions for monitoring
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'cloudwatch:PutMetricData',
                'cloudwatch:GetMetricStatistics',
                'cloudwatch:DescribeAlarms',
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents',
              ],
              resources: ['*'],
            }),
            // SNS permissions for notifications
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'sns:Publish',
                'sns:Subscribe',
                'sns:Unsubscribe',
              ],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    // Outputs
    new cdk.CfnOutput(this, 'CostTrackingTableName', {
      value: this.costTrackingTable.tableName,
      description: 'DynamoDB table for cost tracking',
      exportName: `${id}-CostTrackingTable`,
    });

    new cdk.CfnOutput(this, 'CostReportBucketName', {
      value: this.costReportBucket.bucketName,
      description: 'S3 bucket for cost reports',
      exportName: `${id}-CostReportBucket`,
    });

    new cdk.CfnOutput(this, 'CostControlRoleArn', {
      value: this.costControlRole.roleArn,
      description: 'IAM role for cost control automation',
      exportName: `${id}-CostControlRole`,
    });

    new cdk.CfnOutput(this, 'ProjectBudget', {
      value: budget.toString(),
      description: 'Monthly budget limit in USD',
      exportName: `${id}-Budget`,
    });

    new cdk.CfnOutput(this, 'EnvironmentConfig', {
      value: JSON.stringify(envConfig),
      description: 'Environment-specific configuration',
      exportName: `${id}-EnvironmentConfig`,
    });
  }
}