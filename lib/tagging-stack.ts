import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { TaggingStackProps, ResourceTags } from './types';
import { join } from 'path';

export class TaggingStack extends cdk.Stack {
  public readonly tagValidationFunction: lambda.Function;
  public readonly tagComplianceReportFunction: lambda.Function;
  public readonly tagViolationTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: TaggingStackProps) {
    super(scope, id, props);

    const { projectName, environment } = props;

    // SNS topic for tag violations
    this.tagViolationTopic = new sns.Topic(this, 'TagViolationTopic', {
      topicName: `tag-violations-${projectName}-${environment}`,
      displayName: 'Tag Compliance Violations',
    });

    // Email subscription for tag violations
    const emailAddress = cdk.Stack.of(this).node.tryGetContext('alertEmail') || 'devops@company.com';
    this.tagViolationTopic.addSubscription(
      new subscriptions.EmailSubscription(emailAddress)
    );

    // Lambda function for tag validation
    this.tagValidationFunction = new lambda.Function(this, 'TagValidationFunction', {
      functionName: `tag-validation-${projectName}-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
const AWS = require('aws-sdk');
const sns = new AWS.SNS();

const REQUIRED_TAGS = ['Project', 'Environment', 'Owner', 'CostCenter'];
const SNS_TOPIC_ARN = '${this.tagViolationTopic.topicArn}';

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  try {
    // Parse CloudTrail event
    const records = event.Records || [event];
    
    for (const record of records) {
      if (record.eventSource === 'ec2.amazonaws.com' || 
          record.eventSource === 's3.amazonaws.com' ||
          record.eventSource === 'rds.amazonaws.com') {
        
        const eventName = record.eventName;
        const resourceArn = extractResourceArn(record);
        
        if (isResourceCreationEvent(eventName) && resourceArn) {
          await validateResourceTags(resourceArn, record);
        }
      }
    }
    
    return { statusCode: 200, body: 'Tag validation completed' };
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
};

function extractResourceArn(record) {
  // Extract resource ARN based on service and event
  const eventName = record.eventName;
  const responseElements = record.responseElements;
  
  if (eventName.includes('RunInstances') && responseElements?.instances) {
    return responseElements.instances[0]?.instanceId;
  }
  
  if (eventName.includes('CreateBucket') && responseElements?.bucketName) {
    return \`arn:aws:s3:::\${responseElements.bucketName}\`;
  }
  
  if (eventName.includes('CreateDBInstance') && responseElements?.dBInstance) {
    return responseElements.dBInstance.dBInstanceArn;
  }
  
  return null;
}

function isResourceCreationEvent(eventName) {
  const creationEvents = [
    'RunInstances',
    'CreateBucket',
    'CreateDBInstance',
    'CreateVolume',
    'CreateSnapshot',
    'CreateLoadBalancer'
  ];
  
  return creationEvents.some(event => eventName.includes(event));
}

async function validateResourceTags(resourceArn, record) {
  const resourceId = resourceArn.split('/').pop() || resourceArn;
  const service = record.eventSource.split('.')[0];
  
  // Wait a moment for tags to be applied
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  let tags = [];
  
  try {
    if (service === 'ec2') {
      const ec2 = new AWS.EC2({ region: record.awsRegion });
      const result = await ec2.describeTags({
        Filters: [{ Name: 'resource-id', Values: [resourceId] }]
      }).promise();
      tags = result.Tags || [];
    }
    // Add other service tag retrieval logic here
    
    const missingTags = REQUIRED_TAGS.filter(requiredTag => 
      !tags.some(tag => tag.Key === requiredTag)
    );
    
    if (missingTags.length > 0) {
      await sendTagViolationAlert({
        resourceArn,
        resourceId,
        missingTags,
        service,
        region: record.awsRegion,
        user: record.userIdentity?.principalId || 'Unknown',
        timestamp: record.eventTime
      });
    }
    
  } catch (error) {
    console.error(\`Error validating tags for \${resourceId}:\`, error);
  }
}

async function sendTagViolationAlert(violation) {
  const message = {
    alert: 'TAG_COMPLIANCE_VIOLATION',
    severity: 'HIGH',
    resource: violation.resourceArn,
    resourceId: violation.resourceId,
    missingTags: violation.missingTags,
    service: violation.service,
    region: violation.region,
    user: violation.user,
    timestamp: violation.timestamp,
    action: 'Please add the missing tags to the resource immediately',
    requiredTags: REQUIRED_TAGS
  };
  
  await sns.publish({
    TopicArn: SNS_TOPIC_ARN,
    Subject: \`Tag Compliance Violation: \${violation.resourceId}\`,
    Message: JSON.stringify(message, null, 2)
  }).promise();
  
  console.log('Tag violation alert sent for:', violation.resourceId);
}
      `),
      timeout: cdk.Duration.minutes(5),
      environment: {
        SNS_TOPIC_ARN: this.tagViolationTopic.topicArn,
        PROJECT_NAME: projectName,
        ENVIRONMENT: environment,
      },
    });

    // Grant SNS publish permissions to the Lambda function
    this.tagViolationTopic.grantPublish(this.tagValidationFunction);

    // Grant EC2 describe permissions
    this.tagValidationFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ec2:DescribeTags',
        'ec2:DescribeInstances',
        'ec2:DescribeVolumes',
        'ec2:DescribeSnapshots',
        's3:GetBucketTagging',
        'rds:DescribeDBInstances',
        'rds:ListTagsForResource',
      ],
      resources: ['*'],
    }));

    // EventBridge rule for CloudTrail events
    const tagValidationRule = new events.Rule(this, 'TagValidationRule', {
      ruleName: `tag-validation-rule-${projectName}-${environment}`,
      description: 'Trigger tag validation on resource creation',
      eventPattern: {
        source: ['aws.ec2', 'aws.s3', 'aws.rds'],
        detailType: ['AWS API Call via CloudTrail'],
        detail: {
          eventSource: ['ec2.amazonaws.com', 's3.amazonaws.com', 'rds.amazonaws.com'],
          eventName: [
            'RunInstances',
            'CreateBucket',
            'CreateDBInstance',
            'CreateVolume',
            'CreateSnapshot',
          ],
        },
      },
    });

    tagValidationRule.addTarget(new targets.LambdaFunction(this.tagValidationFunction));

    // Lambda function for tag compliance reporting
    this.tagComplianceReportFunction = new lambda.Function(this, 'TagComplianceReportFunction', {
      functionName: `tag-compliance-report-${projectName}-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const ec2 = new AWS.EC2();
const sns = new AWS.SNS();

const REQUIRED_TAGS = ['Project', 'Environment', 'Owner', 'CostCenter'];
const SNS_TOPIC_ARN = '${this.tagViolationTopic.topicArn}';
const BUCKET_NAME = process.env.REPORT_BUCKET;

exports.handler = async (event) => {
  console.log('Generating tag compliance report...');
  
  try {
    const report = await generateComplianceReport();
    await saveReportToS3(report);
    
    if (report.nonCompliantResources.length > 0) {
      await sendComplianceSummary(report);
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Tag compliance report generated',
        compliantResources: report.compliantResources.length,
        nonCompliantResources: report.nonCompliantResources.length
      })
    };
  } catch (error) {
    console.error('Error generating compliance report:', error);
    throw error;
  }
};

async function generateComplianceReport() {
  const report = {
    timestamp: new Date().toISOString(),
    compliantResources: [],
    nonCompliantResources: [],
    summary: {}
  };
  
  // Check EC2 instances
  await checkEC2Compliance(report);
  
  // Check S3 buckets
  await checkS3Compliance(report);
  
  // Generate summary
  report.summary = {
    totalResources: report.compliantResources.length + report.nonCompliantResources.length,
    compliantResources: report.compliantResources.length,
    nonCompliantResources: report.nonCompliantResources.length,
    compliancePercentage: ((report.compliantResources.length / (report.compliantResources.length + report.nonCompliantResources.length)) * 100).toFixed(2)
  };
  
  return report;
}

async function checkEC2Compliance(report) {
  try {
    const instances = await ec2.describeInstances().promise();
    
    for (const reservation of instances.Reservations) {
      for (const instance of reservation.Instances) {
        if (instance.State.Name === 'terminated') continue;
        
        const tags = instance.Tags || [];
        const missingTags = REQUIRED_TAGS.filter(requiredTag => 
          !tags.some(tag => tag.Key === requiredTag)
        );
        
        const resource = {
          resourceId: instance.InstanceId,
          resourceType: 'EC2 Instance',
          resourceArn: \`arn:aws:ec2:\${process.env.AWS_REGION}:\${process.env.AWS_ACCOUNT_ID}:instance/\${instance.InstanceId}\`,
          tags: tags.reduce((acc, tag) => ({ ...acc, [tag.Key]: tag.Value }), {}),
          missingTags
        };
        
        if (missingTags.length === 0) {
          report.compliantResources.push(resource);
        } else {
          report.nonCompliantResources.push(resource);
        }
      }
    }
  } catch (error) {
    console.error('Error checking EC2 compliance:', error);
  }
}

async function checkS3Compliance(report) {
  try {
    const buckets = await s3.listBuckets().promise();
    
    for (const bucket of buckets.Buckets) {
      try {
        const tagging = await s3.getBucketTagging({ Bucket: bucket.Name }).promise();
        const tags = tagging.TagSet || [];
        
        const missingTags = REQUIRED_TAGS.filter(requiredTag => 
          !tags.some(tag => tag.Key === requiredTag)
        );
        
        const resource = {
          resourceId: bucket.Name,
          resourceType: 'S3 Bucket',
          resourceArn: \`arn:aws:s3:::\${bucket.Name}\`,
          tags: tags.reduce((acc, tag) => ({ ...acc, [tag.Key]: tag.Value }), {}),
          missingTags
        };
        
        if (missingTags.length === 0) {
          report.compliantResources.push(resource);
        } else {
          report.nonCompliantResources.push(resource);
        }
      } catch (error) {
        // No tags on bucket
        report.nonCompliantResources.push({
          resourceId: bucket.Name,
          resourceType: 'S3 Bucket',
          resourceArn: \`arn:aws:s3:::\${bucket.Name}\`,
          tags: {},
          missingTags: REQUIRED_TAGS
        });
      }
    }
  } catch (error) {
    console.error('Error checking S3 compliance:', error);
  }
}

async function saveReportToS3(report) {
  if (!BUCKET_NAME) return;
  
  const key = \`tag-compliance/\${new Date().toISOString().split('T')[0]}/report-\${Date.now()}.json\`;
  
  await s3.putObject({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: JSON.stringify(report, null, 2),
    ContentType: 'application/json'
  }).promise();
  
  console.log(\`Report saved to s3://\${BUCKET_NAME}/\${key}\`);
}

async function sendComplianceSummary(report) {
  const message = {
    alert: 'TAG_COMPLIANCE_SUMMARY',
    severity: 'MEDIUM',
    summary: report.summary,
    nonCompliantCount: report.nonCompliantResources.length,
    timestamp: report.timestamp,
    action: 'Review and fix non-compliant resources',
    topViolations: report.nonCompliantResources.slice(0, 10)
  };
  
  await sns.publish({
    TopicArn: SNS_TOPIC_ARN,
    Subject: \`Tag Compliance Report - \${report.summary.compliancePercentage}% Compliant\`,
    Message: JSON.stringify(message, null, 2)
  }).promise();
}
      `),
      timeout: cdk.Duration.minutes(15),
      environment: {
        SNS_TOPIC_ARN: this.tagViolationTopic.topicArn,
        PROJECT_NAME: projectName,
        ENVIRONMENT: environment,
        AWS_ACCOUNT_ID: cdk.Stack.of(this).account,
      },
    });

    // Grant permissions for compliance reporting
    this.tagComplianceReportFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ec2:DescribeInstances',
        'ec2:DescribeTags',
        's3:ListAllMyBuckets',
        's3:GetBucketTagging',
        's3:PutObject',
        'sns:Publish',
      ],
      resources: ['*'],
    }));

    // Schedule compliance report generation (daily)
    const complianceReportRule = new events.Rule(this, 'ComplianceReportRule', {
      ruleName: `tag-compliance-report-${projectName}-${environment}`,
      description: 'Generate daily tag compliance report',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '8',
        day: '*',
        month: '*',
        year: '*',
      }),
    });

    complianceReportRule.addTarget(new targets.LambdaFunction(this.tagComplianceReportFunction));

    // Service Control Policy for tag enforcement (JSON document)
    const tagEnforcementPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'DenyResourceCreationWithoutRequiredTags',
          Effect: 'Deny',
          Action: [
            'ec2:RunInstances',
            'ec2:CreateVolume',
            'ec2:CreateSnapshot',
            's3:CreateBucket',
            'rds:CreateDBInstance',
            'elasticloadbalancing:CreateLoadBalancer',
          ],
          Resource: '*',
          Condition: {
            'Null': {
              'aws:RequestedRegion': 'false',
            },
            'ForAllValues:StringNotEquals': {
              'aws:TagKeys': ['Project', 'Environment', 'Owner', 'CostCenter'],
            },
          },
        },
        {
          Sid: 'DenyTagDeletion',
          Effect: 'Deny',
          Action: [
            'ec2:DeleteTags',
            's3:DeleteBucketTagging',
            'rds:RemoveTagsFromResource',
          ],
          Resource: '*',
          Condition: {
            'ForAnyValue:StringEquals': {
              'aws:TagKeys': ['Project', 'Environment', 'Owner', 'CostCenter', 'ManagedBy'],
            },
          },
        },
      ],
    };

    // Store the SCP as a parameter for organization-level deployment
    new cdk.CfnOutput(this, 'TagEnforcementPolicy', {
      value: JSON.stringify(tagEnforcementPolicy, null, 2),
      description: 'Service Control Policy for tag enforcement',
      exportName: `${id}-TagEnforcementPolicy`,
    });

    // Outputs
    new cdk.CfnOutput(this, 'TagViolationTopicArn', {
      value: this.tagViolationTopic.topicArn,
      description: 'SNS topic for tag violation alerts',
      exportName: `${id}-TagViolationTopic`,
    });

    new cdk.CfnOutput(this, 'TagValidationFunctionArn', {
      value: this.tagValidationFunction.functionArn,
      description: 'Lambda function for tag validation',
      exportName: `${id}-TagValidationFunction`,
    });

    new cdk.CfnOutput(this, 'RequiredTags', {
      value: JSON.stringify(['Project', 'Environment', 'Owner', 'CostCenter']),
      description: 'List of required tags for all resources',
      exportName: `${id}-RequiredTags`,
    });
  }
}