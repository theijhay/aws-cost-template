import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { GovernanceStackProps, ENVIRONMENT_CONFIGS } from './types';

export class GovernanceStack extends cdk.Stack {
  public readonly governanceRole: iam.Role;
  public readonly resourceValidationFunction: lambda.Function;
  public readonly complianceReportFunction: lambda.Function;
  public readonly governanceViolationTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: GovernanceStackProps) {
    super(scope, id, props);

    const { projectName, environment } = props;
    const envConfig = ENVIRONMENT_CONFIGS[environment] || ENVIRONMENT_CONFIGS.dev;

    // SNS topic for governance violations
    this.governanceViolationTopic = new sns.Topic(this, 'GovernanceViolationTopic', {
      topicName: `governance-violations-${projectName}-${environment}`,
      displayName: 'Resource Governance Violations',
    });

    // Email subscription
    const alertEmail = this.node.tryGetContext('alertEmail') || 'devops@company.com';
    this.governanceViolationTopic.addSubscription(
      new subscriptions.EmailSubscription(alertEmail)
    );

    // IAM role for governance automation
    this.governanceRole = new iam.Role(this, 'GovernanceRole', {
      roleName: `governance-role-${projectName}-${environment}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        GovernancePolicy: new iam.PolicyDocument({
          statements: [
            // EC2 permissions for instance type validation
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ec2:DescribeInstances',
                'ec2:DescribeInstanceTypes',
                'ec2:DescribeVolumes',
                'ec2:DescribeSnapshots',
                'ec2:DescribeImages',
                'ec2:TerminateInstances',
                'ec2:StopInstances',
                'ec2:ModifyInstanceAttribute',
                'ec2:CreateTags',
              ],
              resources: ['*'],
            }),
            // S3 permissions for storage governance
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:ListAllMyBuckets',
                's3:GetBucketLocation',
                's3:GetBucketVersioning',
                's3:GetBucketEncryption',
                's3:GetBucketPolicy',
                's3:PutBucketPolicy',
                's3:PutBucketEncryption',
                's3:PutBucketVersioning',
              ],
              resources: ['*'],
            }),
            // RDS permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'rds:DescribeDBInstances',
                'rds:DescribeDBClusters',
                'rds:ModifyDBInstance',
                'rds:ModifyDBCluster',
              ],
              resources: ['*'],
            }),
            // Organizations permissions for SCP management
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'organizations:ListPolicies',
                'organizations:DescribePolicy',
                'organizations:AttachPolicy',
                'organizations:DetachPolicy',
              ],
              resources: ['*'],
            }),
            // SNS permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['sns:Publish'],
              resources: [this.governanceViolationTopic.topicArn],
            }),
          ],
        }),
      },
    });

    // Lambda function for real-time resource validation
    this.resourceValidationFunction = new lambda.Function(this, 'ResourceValidationFunction', {
      functionName: `resource-validation-${projectName}-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      role: this.governanceRole,
      timeout: cdk.Duration.minutes(10),
      code: lambda.Code.fromInline(`
const AWS = require('aws-sdk');
const ec2 = new AWS.EC2();
const s3 = new AWS.S3();
const rds = new AWS.RDS();
const sns = new AWS.SNS();

const PROJECT_NAME = process.env.PROJECT_NAME;
const ENVIRONMENT = process.env.ENVIRONMENT;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;

// Environment-specific configurations
const ENV_CONFIGS = {
  dev: {
    maxInstanceTypes: ['t3.micro', 't3.small'],
    maxStorageSize: 100,
    allowedRegions: ['us-east-1', 'us-west-2'],
    restrictedServices: ['redshift', 'memorydb', 'neptune']
  },
  staging: {
    maxInstanceTypes: ['t3.micro', 't3.small', 't3.medium'],
    maxStorageSize: 500,
    allowedRegions: ['us-east-1', 'us-west-2', 'eu-west-1'],
    restrictedServices: ['redshift', 'memorydb']
  },
  prod: {
    maxInstanceTypes: ['t3.small', 't3.medium', 't3.large', 'm5.large', 'm5.xlarge'],
    maxStorageSize: 2000,
    allowedRegions: ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'],
    restrictedServices: []
  }
};

exports.handler = async (event) => {
  console.log('Resource validation event:', JSON.stringify(event, null, 2));
  
  try {
    const records = event.Records || [event];
    
    for (const record of records) {
      if (record.eventSource && record.eventName) {
        await validateResourceEvent(record);
      }
    }
    
    return { statusCode: 200, body: 'Resource validation completed' };
  } catch (error) {
    console.error('Error in resource validation:', error);
    throw error;
  }
};

async function validateResourceEvent(record) {
  const eventName = record.eventName;
  const eventSource = record.eventSource;
  const responseElements = record.responseElements;
  
  console.log(\`Validating event: \${eventName} from \${eventSource}\`);
  
  // Validate EC2 instance creation
  if (eventName === 'RunInstances' && eventSource === 'ec2.amazonaws.com') {
    await validateEC2Instances(record);
  }
  
  // Validate S3 bucket creation
  if (eventName === 'CreateBucket' && eventSource === 's3.amazonaws.com') {
    await validateS3Bucket(record);
  }
  
  // Validate RDS instance creation
  if (eventName === 'CreateDBInstance' && eventSource === 'rds.amazonaws.com') {
    await validateRDSInstance(record);
  }
  
  // Validate EBS volume creation
  if (eventName === 'CreateVolume' && eventSource === 'ec2.amazonaws.com') {
    await validateEBSVolume(record);
  }
}

async function validateEC2Instances(record) {
  const instances = record.responseElements?.instances || [];
  const config = ENV_CONFIGS[ENVIRONMENT] || ENV_CONFIGS.dev;
  
  for (const instance of instances) {
    const instanceType = instance.instanceType;
    const instanceId = instance.instanceId;
    
    // Check if instance type is allowed
    if (!config.maxInstanceTypes.includes(instanceType)) {
      await reportViolation({
        type: 'INSTANCE_TYPE_VIOLATION',
        resourceId: instanceId,
        resourceType: 'EC2 Instance',
        violation: \`Instance type '\${instanceType}' not allowed in \${ENVIRONMENT} environment\`,
        allowedTypes: config.maxInstanceTypes,
        actualType: instanceType,
        action: 'TERMINATE_REQUIRED',
        severity: 'HIGH'
      });
      
      // Auto-terminate if in dev environment
      if (ENVIRONMENT === 'dev') {
        try {
          await ec2.terminateInstances({
            InstanceIds: [instanceId]
          }).promise();
          
          console.log(\`Auto-terminated non-compliant instance: \${instanceId}\`);
        } catch (error) {
          console.error(\`Failed to auto-terminate instance \${instanceId}:\`, error);
        }
      }
    }
  }
}

async function validateS3Bucket(record) {
  const bucketName = record.responseElements?.bucketName;
  if (!bucketName) return;
  
  try {
    // Check encryption
    try {
      await s3.getBucketEncryption({ Bucket: bucketName }).promise();
    } catch (error) {
      if (error.code === 'ServerSideEncryptionConfigurationNotFoundError') {
        await reportViolation({
          type: 'S3_ENCRYPTION_VIOLATION',
          resourceId: bucketName,
          resourceType: 'S3 Bucket',
          violation: 'S3 bucket created without encryption',
          action: 'ENABLE_ENCRYPTION_REQUIRED',
          severity: 'MEDIUM'
        });
        
        // Auto-enable encryption
        await s3.putBucketEncryption({
          Bucket: bucketName,
          ServerSideEncryptionConfiguration: {
            Rules: [{
              ApplyServerSideEncryptionByDefault: {
                SSEAlgorithm: 'AES256'
              }
            }]
          }
        }).promise();
        
        console.log(\`Auto-enabled encryption for bucket: \${bucketName}\`);
      }
    }
    
    // Check versioning for production
    if (ENVIRONMENT === 'prod') {
      const versioning = await s3.getBucketVersioning({ Bucket: bucketName }).promise();
      if (versioning.Status !== 'Enabled') {
        await reportViolation({
          type: 'S3_VERSIONING_VIOLATION',
          resourceId: bucketName,
          resourceType: 'S3 Bucket',
          violation: 'S3 bucket in production without versioning enabled',
          action: 'ENABLE_VERSIONING_REQUIRED',
          severity: 'MEDIUM'
        });
      }
    }
    
  } catch (error) {
    console.error(\`Error validating S3 bucket \${bucketName}:\`, error);
  }
}

async function validateRDSInstance(record) {
  const dbInstance = record.responseElements?.dBInstance;
  if (!dbInstance) return;
  
  const instanceClass = dbInstance.dBInstanceClass;
  const instanceId = dbInstance.dBInstanceIdentifier;
  
  // Check instance class restrictions
  const config = ENV_CONFIGS[ENVIRONMENT] || ENV_CONFIGS.dev;
  
  // For RDS, translate EC2 instance types to RDS classes
  const allowedRDSClasses = config.maxInstanceTypes.map(type => {
    if (type.includes('micro')) return 'db.t3.micro';
    if (type.includes('small')) return 'db.t3.small';
    if (type.includes('medium')) return 'db.t3.medium';
    return type.replace('t3.', 'db.t3.');
  });
  
  if (!allowedRDSClasses.some(allowed => instanceClass.includes(allowed.split('.')[1]))) {
    await reportViolation({
      type: 'RDS_INSTANCE_CLASS_VIOLATION',
      resourceId: instanceId,
      resourceType: 'RDS Instance',
      violation: \`RDS instance class '\${instanceClass}' not allowed in \${ENVIRONMENT} environment\`,
      allowedClasses: allowedRDSClasses,
      actualClass: instanceClass,
      action: 'RESIZE_OR_TERMINATE_REQUIRED',
      severity: 'HIGH'
    });
  }
  
  // Check encryption
  if (!dbInstance.storageEncrypted && ENVIRONMENT !== 'dev') {
    await reportViolation({
      type: 'RDS_ENCRYPTION_VIOLATION',
      resourceId: instanceId,
      resourceType: 'RDS Instance',
      violation: 'RDS instance created without encryption',
      action: 'ENCRYPTION_REQUIRED_FOR_PRODUCTION',
      severity: 'HIGH'
    });
  }
}

async function validateEBSVolume(record) {
  const volumeId = record.responseElements?.volumeId;
  const size = record.responseElements?.size;
  
  if (!volumeId || !size) return;
  
  const config = ENV_CONFIGS[ENVIRONMENT] || ENV_CONFIGS.dev;
  
  if (size > config.maxStorageSize) {
    await reportViolation({
      type: 'EBS_SIZE_VIOLATION',
      resourceId: volumeId,
      resourceType: 'EBS Volume',
      violation: \`EBS volume size \${size}GB exceeds limit of \${config.maxStorageSize}GB for \${ENVIRONMENT} environment\`,
      maxSize: config.maxStorageSize,
      actualSize: size,
      action: 'RESIZE_OR_DELETE_REQUIRED',
      severity: 'MEDIUM'
    });
  }
}

async function reportViolation(violation) {
  const message = {
    timestamp: new Date().toISOString(),
    environment: ENVIRONMENT,
    project: PROJECT_NAME,
    ...violation
  };
  
  await sns.publish({
    TopicArn: SNS_TOPIC_ARN,
    Subject: \`Governance Violation: \${violation.type}\`,
    Message: JSON.stringify(message, null, 2)
  }).promise();
  
  console.log('Reported violation:', violation.type, 'for', violation.resourceId);
}
      `),
      environment: {
        PROJECT_NAME: projectName,
        ENVIRONMENT: environment,
        SNS_TOPIC_ARN: this.governanceViolationTopic.topicArn,
      },
    });

    // EventBridge rule for resource governance
    const governanceRule = new events.Rule(this, 'GovernanceRule', {
      ruleName: `resource-governance-${projectName}-${environment}`,
      description: 'Monitor resource creation for governance compliance',
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

    governanceRule.addTarget(new targets.LambdaFunction(this.resourceValidationFunction));

    // Compliance reporting function
    this.complianceReportFunction = new lambda.Function(this, 'ComplianceReportFunction', {
      functionName: `compliance-report-${projectName}-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      role: this.governanceRole,
      timeout: cdk.Duration.minutes(15),
      code: lambda.Code.fromInline(`
const AWS = require('aws-sdk');
const ec2 = new AWS.EC2();
const s3 = new AWS.S3();
const rds = new AWS.RDS();
const sns = new AWS.SNS();

const PROJECT_NAME = process.env.PROJECT_NAME;
const ENVIRONMENT = process.env.ENVIRONMENT;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;

const ENV_CONFIGS = {
  dev: {
    maxInstanceTypes: ['t3.micro', 't3.small'],
    maxStorageSize: 100
  },
  staging: {
    maxInstanceTypes: ['t3.micro', 't3.small', 't3.medium'],
    maxStorageSize: 500
  },
  prod: {
    maxInstanceTypes: ['t3.small', 't3.medium', 't3.large', 'm5.large', 'm5.xlarge'],
    maxStorageSize: 2000
  }
};

exports.handler = async (event) => {
  console.log('Generating compliance report...');
  
  try {
    const report = {
      timestamp: new Date().toISOString(),
      environment: ENVIRONMENT,
      project: PROJECT_NAME,
      compliance: {
        ec2: await checkEC2Compliance(),
        s3: await checkS3Compliance(),
        rds: await checkRDSCompliance(),
        ebs: await checkEBSCompliance()
      }
    };
    
    // Calculate overall compliance score
    const totalChecks = Object.values(report.compliance).reduce((sum, service) => sum + service.total, 0);
    const compliantChecks = Object.values(report.compliance).reduce((sum, service) => sum + service.compliant, 0);
    report.overallCompliance = totalChecks > 0 ? ((compliantChecks / totalChecks) * 100).toFixed(2) : 100;
    
    console.log(\`Overall compliance: \${report.overallCompliance}%\`);
    
    // Send report if compliance is below threshold
    if (parseFloat(report.overallCompliance) < 90) {
      await sendComplianceReport(report);
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        compliance: report.overallCompliance + '%',
        violations: totalChecks - compliantChecks
      })
    };
  } catch (error) {
    console.error('Error generating compliance report:', error);
    throw error;
  }
};

async function checkEC2Compliance() {
  const config = ENV_CONFIGS[ENVIRONMENT] || ENV_CONFIGS.dev;
  const compliance = { compliant: 0, violations: [], total: 0 };
  
  try {
    const instances = await ec2.describeInstances({
      Filters: [
        { Name: 'tag:Project', Values: [PROJECT_NAME] },
        { Name: 'tag:Environment', Values: [ENVIRONMENT] },
        { Name: 'instance-state-name', Values: ['running', 'stopped'] }
      ]
    }).promise();
    
    for (const reservation of instances.Reservations) {
      for (const instance of reservation.Instances) {
        compliance.total++;
        
        if (config.maxInstanceTypes.includes(instance.InstanceType)) {
          compliance.compliant++;
        } else {
          compliance.violations.push({
            resourceId: instance.InstanceId,
            violation: \`Invalid instance type: \${instance.InstanceType}\`,
            expected: config.maxInstanceTypes
          });
        }
      }
    }
  } catch (error) {
    console.error('Error checking EC2 compliance:', error);
  }
  
  return compliance;
}

async function checkS3Compliance() {
  const compliance = { compliant: 0, violations: [], total: 0 };
  
  try {
    const buckets = await s3.listBuckets().promise();
    
    for (const bucket of buckets.Buckets) {
      // Check if bucket belongs to this project
      try {
        const tagging = await s3.getBucketTagging({ Bucket: bucket.Name }).promise();
        const projectTag = tagging.TagSet.find(tag => tag.Key === 'Project')?.Value;
        const envTag = tagging.TagSet.find(tag => tag.Key === 'Environment')?.Value;
        
        if (projectTag === PROJECT_NAME && envTag === ENVIRONMENT) {
          compliance.total++;
          
          // Check encryption
          let encryptionCompliant = false;
          try {
            await s3.getBucketEncryption({ Bucket: bucket.Name }).promise();
            encryptionCompliant = true;
          } catch (error) {
            // No encryption
          }
          
          // Check versioning for production
          let versioningCompliant = true;
          if (ENVIRONMENT === 'prod') {
            const versioning = await s3.getBucketVersioning({ Bucket: bucket.Name }).promise();
            versioningCompliant = versioning.Status === 'Enabled';
          }
          
          if (encryptionCompliant && versioningCompliant) {
            compliance.compliant++;
          } else {
            const violations = [];
            if (!encryptionCompliant) violations.push('No encryption');
            if (!versioningCompliant) violations.push('No versioning');
            
            compliance.violations.push({
              resourceId: bucket.Name,
              violation: violations.join(', ')
            });
          }
        }
      } catch (error) {
        // Skip buckets without tags
      }
    }
  } catch (error) {
    console.error('Error checking S3 compliance:', error);
  }
  
  return compliance;
}

async function checkRDSCompliance() {
  const compliance = { compliant: 0, violations: [], total: 0 };
  
  try {
    const instances = await rds.describeDBInstances().promise();
    
    for (const instance of instances.DBInstances) {
      // Check tags to see if it belongs to this project
      try {
        const tags = await rds.listTagsForResource({
          ResourceName: instance.DBInstanceArn
        }).promise();
        
        const projectTag = tags.TagList.find(tag => tag.Key === 'Project')?.Value;
        const envTag = tags.TagList.find(tag => tag.Key === 'Environment')?.Value;
        
        if (projectTag === PROJECT_NAME && envTag === ENVIRONMENT) {
          compliance.total++;
          
          const violations = [];
          
          // Check encryption for non-dev environments
          if (ENVIRONMENT !== 'dev' && !instance.StorageEncrypted) {
            violations.push('No storage encryption');
          }
          
          // Check instance class
          const config = ENV_CONFIGS[ENVIRONMENT] || ENV_CONFIGS.dev;
          const isValidClass = config.maxInstanceTypes.some(type => 
            instance.DBInstanceClass.includes(type.replace('t3.', ''))
          );
          
          if (!isValidClass) {
            violations.push(\`Invalid instance class: \${instance.DBInstanceClass}\`);
          }
          
          if (violations.length === 0) {
            compliance.compliant++;
          } else {
            compliance.violations.push({
              resourceId: instance.DBInstanceIdentifier,
              violation: violations.join(', ')
            });
          }
        }
      } catch (error) {
        // Skip instances without tags
      }
    }
  } catch (error) {
    console.error('Error checking RDS compliance:', error);
  }
  
  return compliance;
}

async function checkEBSCompliance() {
  const config = ENV_CONFIGS[ENVIRONMENT] || ENV_CONFIGS.dev;
  const compliance = { compliant: 0, violations: [], total: 0 };
  
  try {
    const volumes = await ec2.describeVolumes({
      Filters: [
        { Name: 'tag:Project', Values: [PROJECT_NAME] },
        { Name: 'tag:Environment', Values: [ENVIRONMENT] }
      ]
    }).promise();
    
    for (const volume of volumes.Volumes) {
      compliance.total++;
      
      if (volume.Size <= config.maxStorageSize) {
        compliance.compliant++;
      } else {
        compliance.violations.push({
          resourceId: volume.VolumeId,
          violation: \`Volume size \${volume.Size}GB exceeds limit of \${config.maxStorageSize}GB\`
        });
      }
    }
  } catch (error) {
    console.error('Error checking EBS compliance:', error);
  }
  
  return compliance;
}

async function sendComplianceReport(report) {
  await sns.publish({
    TopicArn: SNS_TOPIC_ARN,
    Subject: \`Compliance Report - \${report.overallCompliance}% Compliant\`,
    Message: JSON.stringify(report, null, 2)
  }).promise();
  
  console.log(\`Sent compliance report: \${report.overallCompliance}% compliant\`);
}
      `),
      environment: {
        PROJECT_NAME: projectName,
        ENVIRONMENT: environment,
        SNS_TOPIC_ARN: this.governanceViolationTopic.topicArn,
      },
    });

    // Schedule compliance reports
    const complianceRule = new events.Rule(this, 'ComplianceRule', {
      ruleName: `compliance-report-${projectName}-${environment}`,
      description: 'Daily compliance reporting',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '10',
        day: '*',
        month: '*',
        year: '*',
      }),
    });

    complianceRule.addTarget(new targets.LambdaFunction(this.complianceReportFunction));

    // Service Control Policies for resource restrictions
    const resourceRestrictionPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'DenyLargeInstanceTypes',
          Effect: 'Deny',
          Action: 'ec2:RunInstances',
          Resource: 'arn:aws:ec2:*:*:instance/*',
          Condition: {
            'StringNotEquals': {
              'ec2:InstanceType': envConfig.maxInstanceTypes,
            },
          },
        },
        {
          Sid: 'DenyLargeEBSVolumes',
          Effect: 'Deny',
          Action: 'ec2:CreateVolume',
          Resource: '*',
          Condition: {
            'NumericGreaterThan': {
              'ec2:VolumeSize': envConfig.maxStorageSize.toString(),
            },
          },
        },
        {
          Sid: 'DenyUnencryptedS3',
          Effect: 'Deny',
          Action: 's3:PutObject',
          Resource: '*',
          Condition: {
            'StringNotEquals': {
              's3:x-amz-server-side-encryption': ['AES256', 'aws:kms'],
            },
          },
        },
        {
          Sid: 'RestrictRegions',
          Effect: 'Deny',
          NotAction: [
            'iam:*',
            'organizations:*',
            'support:*',
            'trustedadvisor:*',
          ],
          Resource: '*',
          Condition: {
            'StringNotEquals': {
              'aws:RequestedRegion': envConfig.allowedRegions,
            },
          },
        },
      ],
    };

    // Add restricted services policy for dev environments
    if (envConfig.restrictedServices.length > 0) {
      (resourceRestrictionPolicy.Statement as any[]).push({
        Sid: 'DenyRestrictedServices',
        Effect: 'Deny',
        Action: envConfig.restrictedServices.map(service => `${service}:*`),
        Resource: '*',
      });
    }

    // Outputs
    new cdk.CfnOutput(this, 'ResourceRestrictionPolicy', {
      value: JSON.stringify(resourceRestrictionPolicy, null, 2),
      description: 'Service Control Policy for resource restrictions',
      exportName: `${id}-ResourceRestrictionPolicy`,
    });

    new cdk.CfnOutput(this, 'GovernanceViolationTopicArn', {
      value: this.governanceViolationTopic.topicArn,
      description: 'SNS topic for governance violations',
      exportName: `${id}-GovernanceViolationTopic`,
    });

    new cdk.CfnOutput(this, 'EnvironmentLimits', {
      value: JSON.stringify(envConfig),
      description: 'Environment-specific resource limits',
      exportName: `${id}-EnvironmentLimits`,
    });
  }
}