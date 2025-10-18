import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { AutomationStackProps, ENVIRONMENT_CONFIGS } from './types';

export class AutomationStack extends cdk.Stack {
  public readonly autoShutdownFunction: lambda.Function;
  public readonly resourceCleanupFunction: lambda.Function;
  public readonly lifecycleManagementFunction: lambda.Function;
  public readonly automationNotificationTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: AutomationStackProps) {
    super(scope, id, props);

    const { projectName, environment } = props;
    const envConfig = ENVIRONMENT_CONFIGS[environment] || ENVIRONMENT_CONFIGS.dev;

    // SNS topic for automation notifications
    this.automationNotificationTopic = new sns.Topic(this, 'AutomationNotificationTopic', {
      topicName: `automation-notifications-${projectName}-${environment}`,
      displayName: 'Automated Lifecycle Management Notifications',
    });

    // Email subscription
    const alertEmail = this.node.tryGetContext('alertEmail') || 'devops@company.com';
    this.automationNotificationTopic.addSubscription(
      new subscriptions.EmailSubscription(alertEmail)
    );

    // Auto-shutdown function for development environments
    this.autoShutdownFunction = new lambda.Function(this, 'AutoShutdownFunction', {
      functionName: `auto-shutdown-${projectName}-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(15),
      code: lambda.Code.fromInline(`
const AWS = require('aws-sdk');
const ec2 = new AWS.EC2();
const rds = new AWS.RDS();
const autoscaling = new AWS.AutoScaling();
const sns = new AWS.SNS();

const PROJECT_NAME = process.env.PROJECT_NAME;
const ENVIRONMENT = process.env.ENVIRONMENT;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;

exports.handler = async (event) => {
  console.log('Auto-shutdown event:', JSON.stringify(event, null, 2));
  
  try {
    const shutdownType = event.shutdownType || 'daily';
    const actions = [];
    
    if (ENVIRONMENT === 'dev' || ENVIRONMENT === 'qa') {
      actions.push(...await shutdownEC2Instances());
      actions.push(...await shutdownRDSInstances());
      
      if (shutdownType === 'weekend') {
        actions.push(...await scaleDownAutoScalingGroups());
      }
    }
    
    if (actions.length > 0) {
      await sendShutdownNotification(actions, shutdownType);
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Auto-shutdown completed',
        actionsPerformed: actions.length,
        actions: actions
      })
    };
  } catch (error) {
    console.error('Error in auto-shutdown:', error);
    throw error;
  }
};

async function shutdownEC2Instances() {
  const actions = [];
  
  try {
    const instances = await ec2.describeInstances({
      Filters: [
        { Name: 'tag:Project', Values: [PROJECT_NAME] },
        { Name: 'tag:Environment', Values: [ENVIRONMENT] },
        { Name: 'tag:AutoShutdown', Values: ['true', 'yes', '1'] },
        { Name: 'instance-state-name', Values: ['running'] }
      ]
    }).promise();
    
    const instanceIds = [];
    instances.Reservations.forEach(reservation => {
      reservation.Instances.forEach(instance => {
        instanceIds.push(instance.InstanceId);
      });
    });
    
    if (instanceIds.length > 0) {
      await ec2.stopInstances({ InstanceIds: instanceIds }).promise();
      actions.push(\`Stopped \${instanceIds.length} EC2 instances: \${instanceIds.join(', ')}\`);
      console.log(\`Stopped EC2 instances: \${instanceIds.join(', ')}\`);
    }
  } catch (error) {
    console.error('Error stopping EC2 instances:', error);
    actions.push(\`Error stopping EC2 instances: \${error.message}\`);
  }
  
  return actions;
}

async function shutdownRDSInstances() {
  const actions = [];
  
  try {
    const instances = await rds.describeDBInstances().promise();
    
    for (const instance of instances.DBInstances) {
      if (instance.DBInstanceStatus !== 'available') continue;
      
      try {
        const tags = await rds.listTagsForResource({
          ResourceName: instance.DBInstanceArn
        }).promise();
        
        const projectTag = tags.TagList.find(tag => tag.Key === 'Project')?.Value;
        const envTag = tags.TagList.find(tag => tag.Key === 'Environment')?.Value;
        const autoShutdownTag = tags.TagList.find(tag => tag.Key === 'AutoShutdown')?.Value;
        
        if (projectTag === PROJECT_NAME && envTag === ENVIRONMENT && 
            ['true', 'yes', '1'].includes(autoShutdownTag?.toLowerCase())) {
          
          await rds.stopDBInstance({
            DBInstanceIdentifier: instance.DBInstanceIdentifier
          }).promise();
          
          actions.push(\`Stopped RDS instance: \${instance.DBInstanceIdentifier}\`);
          console.log(\`Stopped RDS instance: \${instance.DBInstanceIdentifier}\`);
        }
      } catch (error) {
        console.error(\`Error processing RDS instance \${instance.DBInstanceIdentifier}:\`, error);
      }
    }
  } catch (error) {
    console.error('Error shutting down RDS instances:', error);
    actions.push(\`Error shutting down RDS instances: \${error.message}\`);
  }
  
  return actions;
}

async function scaleDownAutoScalingGroups() {
  const actions = [];
  
  try {
    const groups = await autoscaling.describeAutoScalingGroups().promise();
    
    for (const group of groups.AutoScalingGroups) {
      const projectTag = group.Tags.find(tag => tag.Key === 'Project')?.Value;
      const envTag = group.Tags.find(tag => tag.Key === 'Environment')?.Value;
      const autoShutdownTag = group.Tags.find(tag => tag.Key === 'AutoShutdown')?.Value;
      
      if (projectTag === PROJECT_NAME && envTag === ENVIRONMENT && 
          ['true', 'yes', '1'].includes(autoShutdownTag?.toLowerCase())) {
        
        // Scale down to 0 for weekend shutdown
        await autoscaling.updateAutoScalingGroup({
          AutoScalingGroupName: group.AutoScalingGroupName,
          MinSize: 0,
          DesiredCapacity: 0
        }).promise();
        
        actions.push(\`Scaled down ASG: \${group.AutoScalingGroupName} to 0 instances\`);
        console.log(\`Scaled down ASG: \${group.AutoScalingGroupName}\`);
      }
    }
  } catch (error) {
    console.error('Error scaling down Auto Scaling Groups:', error);
    actions.push(\`Error scaling down ASGs: \${error.message}\`);
  }
  
  return actions;
}

async function sendShutdownNotification(actions, shutdownType) {
  const message = {
    timestamp: new Date().toISOString(),
    shutdownType: shutdownType,
    environment: ENVIRONMENT,
    project: PROJECT_NAME,
    actionsPerformed: actions,
    totalActions: actions.length
  };
  
  await sns.publish({
    TopicArn: SNS_TOPIC_ARN,
    Subject: \`Auto-Shutdown Report - \${ENVIRONMENT} Environment\`,
    Message: JSON.stringify(message, null, 2)
  }).promise();
  
  console.log('Sent shutdown notification');
}
      `),
      environment: {
        PROJECT_NAME: projectName,
        ENVIRONMENT: environment,
        SNS_TOPIC_ARN: this.automationNotificationTopic.topicArn,
      },
    });

    // Resource cleanup function
    this.resourceCleanupFunction = new lambda.Function(this, 'ResourceCleanupFunction', {
      functionName: `resource-cleanup-${projectName}-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(15),
      code: lambda.Code.fromInline(`
const AWS = require('aws-sdk');
const ec2 = new AWS.EC2();
const s3 = new AWS.S3();
const sns = new AWS.SNS();

const PROJECT_NAME = process.env.PROJECT_NAME;
const ENVIRONMENT = process.env.ENVIRONMENT;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;

exports.handler = async (event) => {
  console.log('Resource cleanup event:', JSON.stringify(event, null, 2));
  
  try {
    const cleanupActions = [];
    
    // Clean up unattached EBS volumes
    cleanupActions.push(...await cleanupUnattachedEBSVolumes());
    
    // Clean up unattached Elastic IPs
    cleanupActions.push(...await cleanupUnattachedElasticIPs());
    
    // Clean up old snapshots
    cleanupActions.push(...await cleanupOldSnapshots());
    
    // Clean up unused security groups
    cleanupActions.push(...await cleanupUnusedSecurityGroups());
    
    // Clean up incomplete multipart uploads
    cleanupActions.push(...await cleanupIncompleteMultipartUploads());
    
    if (cleanupActions.length > 0) {
      await sendCleanupReport(cleanupActions);
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Resource cleanup completed',
        actionsPerformed: cleanupActions.length,
        actions: cleanupActions
      })
    };
  } catch (error) {
    console.error('Error in resource cleanup:', error);
    throw error;
  }
};

async function cleanupUnattachedEBSVolumes() {
  const actions = [];
  const RETENTION_DAYS = 7;
  
  try {
    const volumes = await ec2.describeVolumes({
      Filters: [
        { Name: 'tag:Project', Values: [PROJECT_NAME] },
        { Name: 'tag:Environment', Values: [ENVIRONMENT] },
        { Name: 'status', Values: ['available'] }
      ]
    }).promise();
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
    
    for (const volume of volumes.Volumes) {
      if (new Date(volume.CreateTime) < cutoffDate) {
        try {
          await ec2.deleteVolume({ VolumeId: volume.VolumeId }).promise();
          actions.push(\`Deleted unattached EBS volume: \${volume.VolumeId} (created \${volume.CreateTime})\`);
          console.log(\`Deleted unattached EBS volume: \${volume.VolumeId}\`);
        } catch (error) {
          console.error(\`Error deleting volume \${volume.VolumeId}:\`, error);
        }
      }
    }
  } catch (error) {
    console.error('Error cleaning up EBS volumes:', error);
  }
  
  return actions;
}

async function cleanupUnattachedElasticIPs() {
  const actions = [];
  const RETENTION_HOURS = 24;
  
  try {
    const addresses = await ec2.describeAddresses().promise();
    
    for (const address of addresses.Addresses) {
      // Skip if attached to an instance
      if (address.InstanceId || address.NetworkInterfaceId) continue;
      
      // Check if it belongs to our project (if tagged)
      const projectTag = address.Tags?.find(tag => tag.Key === 'Project')?.Value;
      const envTag = address.Tags?.find(tag => tag.Key === 'Environment')?.Value;
      
      if (projectTag === PROJECT_NAME && envTag === ENVIRONMENT) {
        try {
          await ec2.releaseAddress({ AllocationId: address.AllocationId }).promise();
          actions.push(\`Released unattached Elastic IP: \${address.PublicIp}\`);
          console.log(\`Released unattached Elastic IP: \${address.PublicIp}\`);
        } catch (error) {
          console.error(\`Error releasing Elastic IP \${address.PublicIp}:\`, error);
        }
      }
    }
  } catch (error) {
    console.error('Error cleaning up Elastic IPs:', error);
  }
  
  return actions;
}

async function cleanupOldSnapshots() {
  const actions = [];
  const RETENTION_DAYS = 30;
  
  try {
    const snapshots = await ec2.describeSnapshots({
      OwnerIds: ['self'],
      Filters: [
        { Name: 'tag:Project', Values: [PROJECT_NAME] },
        { Name: 'tag:Environment', Values: [ENVIRONMENT] }
      ]
    }).promise();
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
    
    for (const snapshot of snapshots.Snapshots) {
      if (new Date(snapshot.StartTime) < cutoffDate) {
        try {
          await ec2.deleteSnapshot({ SnapshotId: snapshot.SnapshotId }).promise();
          actions.push(\`Deleted old snapshot: \${snapshot.SnapshotId} (created \${snapshot.StartTime})\`);
          console.log(\`Deleted old snapshot: \${snapshot.SnapshotId}\`);
        } catch (error) {
          console.error(\`Error deleting snapshot \${snapshot.SnapshotId}:\`, error);
        }
      }
    }
  } catch (error) {
    console.error('Error cleaning up snapshots:', error);
  }
  
  return actions;
}

async function cleanupUnusedSecurityGroups() {
  const actions = [];
  
  try {
    const securityGroups = await ec2.describeSecurityGroups({
      Filters: [
        { Name: 'tag:Project', Values: [PROJECT_NAME] },
        { Name: 'tag:Environment', Values: [ENVIRONMENT] }
      ]
    }).promise();
    
    for (const sg of securityGroups.SecurityGroups) {
      // Skip default security groups
      if (sg.GroupName === 'default') continue;
      
      try {
        // Check if security group is in use
        const instances = await ec2.describeInstances({
          Filters: [{ Name: 'instance.group-id', Values: [sg.GroupId] }]
        }).promise();
        
        const networkInterfaces = await ec2.describeNetworkInterfaces({
          Filters: [{ Name: 'group-id', Values: [sg.GroupId] }]
        }).promise();
        
        // If not in use, delete it
        if (instances.Reservations.length === 0 && networkInterfaces.NetworkInterfaces.length === 0) {
          await ec2.deleteSecurityGroup({ GroupId: sg.GroupId }).promise();
          actions.push(\`Deleted unused security group: \${sg.GroupId} (\${sg.GroupName})\`);
          console.log(\`Deleted unused security group: \${sg.GroupId}\`);
        }
      } catch (error) {
        // Security group might be in use by another resource
        console.log(\`Cannot delete security group \${sg.GroupId}: \${error.message}\`);
      }
    }
  } catch (error) {
    console.error('Error cleaning up security groups:', error);
  }
  
  return actions;
}

async function cleanupIncompleteMultipartUploads() {
  const actions = [];
  const RETENTION_DAYS = 7;
  
  try {
    const buckets = await s3.listBuckets().promise();
    
    for (const bucket of buckets.Buckets) {
      try {
        // Check if bucket belongs to our project
        const tagging = await s3.getBucketTagging({ Bucket: bucket.Name }).promise();
        const projectTag = tagging.TagSet.find(tag => tag.Key === 'Project')?.Value;
        const envTag = tagging.TagSet.find(tag => tag.Key === 'Environment')?.Value;
        
        if (projectTag === PROJECT_NAME && envTag === ENVIRONMENT) {
          const uploads = await s3.listMultipartUploads({ Bucket: bucket.Name }).promise();
          
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
          
          for (const upload of uploads.Uploads) {
            if (new Date(upload.Initiated) < cutoffDate) {
              await s3.abortMultipartUpload({
                Bucket: bucket.Name,
                Key: upload.Key,
                UploadId: upload.UploadId
              }).promise();
              
              actions.push(\`Aborted incomplete multipart upload: \${upload.Key} in \${bucket.Name}\`);
              console.log(\`Aborted incomplete multipart upload: \${upload.Key}\`);
            }
          }
        }
      } catch (error) {
        // Skip buckets without tags or with errors
        console.log(\`Skipping bucket \${bucket.Name}: \${error.message}\`);
      }
    }
  } catch (error) {
    console.error('Error cleaning up multipart uploads:', error);
  }
  
  return actions;
}

async function sendCleanupReport(actions) {
  const message = {
    timestamp: new Date().toISOString(),
    environment: ENVIRONMENT,
    project: PROJECT_NAME,
    cleanupActions: actions,
    totalActions: actions.length,
    message: 'Automated resource cleanup completed'
  };
  
  await sns.publish({
    TopicArn: SNS_TOPIC_ARN,
    Subject: \`Resource Cleanup Report - \${actions.length} actions performed\`,
    Message: JSON.stringify(message, null, 2)
  }).promise();
  
  console.log('Sent cleanup report');
}
      `),
      environment: {
        PROJECT_NAME: projectName,
        ENVIRONMENT: environment,
        SNS_TOPIC_ARN: this.automationNotificationTopic.topicArn,
      },
    });

    // Storage lifecycle management function
    this.lifecycleManagementFunction = new lambda.Function(this, 'LifecycleManagementFunction', {
      functionName: `lifecycle-management-${projectName}-${environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      timeout: cdk.Duration.minutes(10),
      code: lambda.Code.fromInline(`
const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const sns = new AWS.SNS();

const PROJECT_NAME = process.env.PROJECT_NAME;
const ENVIRONMENT = process.env.ENVIRONMENT;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;

exports.handler = async (event) => {
  console.log('Storage lifecycle management event:', JSON.stringify(event, null, 2));
  
  try {
    const actions = [];
    
    // Apply lifecycle policies to S3 buckets
    actions.push(...await applyS3LifecyclePolicies());
    
    if (actions.length > 0) {
      await sendLifecycleReport(actions);
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Storage lifecycle management completed',
        actionsPerformed: actions.length,
        actions: actions
      })
    };
  } catch (error) {
    console.error('Error in lifecycle management:', error);
    throw error;
  }
};

async function applyS3LifecyclePolicies() {
  const actions = [];
  
  try {
    const buckets = await s3.listBuckets().promise();
    
    for (const bucket of buckets.Buckets) {
      try {
        // Check if bucket belongs to our project
        const tagging = await s3.getBucketTagging({ Bucket: bucket.Name }).promise();
        const projectTag = tagging.TagSet.find(tag => tag.Key === 'Project')?.Value;
        const envTag = tagging.TagSet.find(tag => tag.Key === 'Environment')?.Value;
        
        if (projectTag === PROJECT_NAME && envTag === ENVIRONMENT) {
          // Check if lifecycle policy already exists
          let hasLifecyclePolicy = false;
          try {
            await s3.getBucketLifecycleConfiguration({ Bucket: bucket.Name }).promise();
            hasLifecyclePolicy = true;
          } catch (error) {
            // No lifecycle policy exists
          }
          
          if (!hasLifecyclePolicy) {
            const lifecycleConfig = createLifecycleConfiguration(ENVIRONMENT);
            
            await s3.putBucketLifecycleConfiguration({
              Bucket: bucket.Name,
              LifecycleConfiguration: lifecycleConfig
            }).promise();
            
            actions.push(\`Applied lifecycle policy to bucket: \${bucket.Name}\`);
            console.log(\`Applied lifecycle policy to bucket: \${bucket.Name}\`);
          }
        }
      } catch (error) {
        // Skip buckets without tags or with errors
        console.log(\`Skipping bucket \${bucket.Name}: \${error.message}\`);
      }
    }
  } catch (error) {
    console.error('Error applying S3 lifecycle policies:', error);
  }
  
  return actions;
}

function createLifecycleConfiguration(environment) {
  const rules = [
    {
      ID: 'CostOptimizedLifecycle',
      Status: 'Enabled',
      Filter: {},
      Transitions: [
        {
          Days: environment === 'prod' ? 30 : 7,
          StorageClass: 'STANDARD_INFREQUENT_ACCESS'
        },
        {
          Days: environment === 'prod' ? 90 : 30,
          StorageClass: 'GLACIER'
        },
        {
          Days: environment === 'prod' ? 365 : 90,
          StorageClass: 'DEEP_ARCHIVE'
        }
      ]
    },
    {
      ID: 'DeleteIncompleteMultipartUploads',
      Status: 'Enabled',
      Filter: {},
      AbortIncompleteMultipartUpload: {
        DaysAfterInitiation: 7
      }
    }
  ];
  
  // Add expiration rule for non-production environments
  if (environment !== 'prod') {
    rules.push({
      ID: 'DeleteOldObjects',
      Status: 'Enabled',
      Filter: {},
      Expiration: {
        Days: environment === 'dev' ? 90 : 180
      }
    });
  }
  
  return { Rules: rules };
}

async function sendLifecycleReport(actions) {
  const message = {
    timestamp: new Date().toISOString(),
    environment: ENVIRONMENT,
    project: PROJECT_NAME,
    lifecycleActions: actions,
    totalActions: actions.length,
    message: 'Storage lifecycle policies applied'
  };
  
  await sns.publish({
    TopicArn: SNS_TOPIC_ARN,
    Subject: \`Storage Lifecycle Report - \${actions.length} policies applied\`,
    Message: JSON.stringify(message, null, 2)
  }).promise();
  
  console.log('Sent lifecycle report');
}
      `),
      environment: {
        PROJECT_NAME: projectName,
        ENVIRONMENT: environment,
        SNS_TOPIC_ARN: this.automationNotificationTopic.topicArn,
      },
    });

    // Grant necessary permissions to all functions
    const automationPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        // EC2 permissions
        'ec2:DescribeInstances',
        'ec2:DescribeVolumes',
        'ec2:DescribeSnapshots',
        'ec2:DescribeAddresses',
        'ec2:DescribeSecurityGroups',
        'ec2:DescribeNetworkInterfaces',
        'ec2:StopInstances',
        'ec2:StartInstances',
        'ec2:DeleteVolume',
        'ec2:DeleteSnapshot',
        'ec2:ReleaseAddress',
        'ec2:DeleteSecurityGroup',
        // RDS permissions
        'rds:DescribeDBInstances',
        'rds:StopDBInstance',
        'rds:StartDBInstance',
        'rds:ListTagsForResource',
        // Auto Scaling permissions
        'autoscaling:DescribeAutoScalingGroups',
        'autoscaling:UpdateAutoScalingGroup',
        // S3 permissions
        's3:ListAllMyBuckets',
        's3:GetBucketTagging',
        's3:GetBucketLifecycleConfiguration',
        's3:PutBucketLifecycleConfiguration',
        's3:ListMultipartUploads',
        's3:AbortMultipartUpload',
        // SNS permissions
        'sns:Publish',
      ],
      resources: ['*'],
    });

    this.autoShutdownFunction.addToRolePolicy(automationPolicy);
    this.resourceCleanupFunction.addToRolePolicy(automationPolicy);
    this.lifecycleManagementFunction.addToRolePolicy(automationPolicy);

    // Schedule auto-shutdown for development environments
    if (envConfig.autoShutdown) {
      // Daily shutdown at 7 PM
      const dailyShutdownRule = new events.Rule(this, 'DailyShutdownRule', {
        ruleName: `daily-shutdown-${projectName}-${environment}`,
        description: 'Daily auto-shutdown for development resources',
        schedule: events.Schedule.cron({
          minute: '0',
          hour: '19', // 7 PM
          day: '*',
          month: '*',
          year: '*',
        }),
      });

      dailyShutdownRule.addTarget(new targets.LambdaFunction(this.autoShutdownFunction, {
        event: events.RuleTargetInput.fromObject({ shutdownType: 'daily' }),
      }));

      // Weekend shutdown if enabled
      if (envConfig.weekendShutdown) {
        const weekendShutdownRule = new events.Rule(this, 'WeekendShutdownRule', {
          ruleName: `weekend-shutdown-${projectName}-${environment}`,
          description: 'Weekend auto-shutdown for development resources',
          schedule: events.Schedule.cron({
            minute: '0',
            hour: '18', // 6 PM Friday
            month: '*',
            year: '*',
            weekDay: 'FRI',
          }),
        });

        weekendShutdownRule.addTarget(new targets.LambdaFunction(this.autoShutdownFunction, {
          event: events.RuleTargetInput.fromObject({ shutdownType: 'weekend' }),
        }));
      }
    }

    // Schedule resource cleanup (daily)
    const cleanupRule = new events.Rule(this, 'ResourceCleanupRule', {
      ruleName: `resource-cleanup-${projectName}-${environment}`,
      description: 'Daily resource cleanup automation',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '2', // 2 AM
        day: '*',
        month: '*',
        year: '*',
      }),
    });

    cleanupRule.addTarget(new targets.LambdaFunction(this.resourceCleanupFunction));

    // Schedule lifecycle management (weekly)
    const lifecycleRule = new events.Rule(this, 'LifecycleManagementRule', {
      ruleName: `lifecycle-management-${projectName}-${environment}`,
      description: 'Weekly storage lifecycle management',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '3', // 3 AM Sunday
        month: '*',
        year: '*',
        weekDay: 'SUN',
      }),
    });

    lifecycleRule.addTarget(new targets.LambdaFunction(this.lifecycleManagementFunction));

    // Outputs
    new cdk.CfnOutput(this, 'AutoShutdownFunctionArn', {
      value: this.autoShutdownFunction.functionArn,
      description: 'Lambda function for auto-shutdown',
      exportName: `${id}-AutoShutdownFunction`,
    });

    new cdk.CfnOutput(this, 'ResourceCleanupFunctionArn', {
      value: this.resourceCleanupFunction.functionArn,
      description: 'Lambda function for resource cleanup',
      exportName: `${id}-ResourceCleanupFunction`,
    });

    new cdk.CfnOutput(this, 'AutomationNotificationTopicArn', {
      value: this.automationNotificationTopic.topicArn,
      description: 'SNS topic for automation notifications',
      exportName: `${id}-AutomationNotificationTopic`,
    });

    new cdk.CfnOutput(this, 'AutomationSchedule', {
      value: JSON.stringify({
        autoShutdown: envConfig.autoShutdown,
        weekendShutdown: envConfig.weekendShutdown,
        dailyCleanup: '02:00 UTC',
        weeklyLifecycleManagement: 'Sunday 03:00 UTC',
      }),
      description: 'Automation schedule configuration',
      exportName: `${id}-AutomationSchedule`,
    });
  }
}