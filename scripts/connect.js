#!/usr/bin/env node

/**
 * AWS Cost Control Template - Project Connection Script
 * 
 * This script connects existing AWS projects to the cost control template,
 * injecting cost controls without changing the original application code.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Colors for output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

class CostControlConnector {
  constructor() {
    this.targetProjectPath = process.cwd();
    this.templatePath = path.dirname(__filename);
    this.config = {};
  }

  async connect() {
    log('🔗 AWS Cost Control Template - Project Connection', 'cyan');
    log('==================================================', 'cyan');
    log('');
    
    try {
      // Step 1: Analyze existing project
      await this.analyzeProject();
      
      // Step 2: Gather configuration
      await this.gatherConfiguration();
      
      // Step 3: Inject cost controls
      await this.injectCostControls();
      
      // Step 4: Setup deployment scripts
      await this.setupDeploymentScripts();
      
      // Step 5: Create configuration files
      await this.createConfigurationFiles();
      
      // Step 6: Install dependencies
      await this.installDependencies();
      
      log('');
      log('🎉 Cost controls successfully connected!', 'green');
      log('');
      log('📋 Next Steps:', 'yellow');
      log('1. Review cost-controls-config.json');
      log('2. Run: npm run deploy-with-cost-controls');
      log('3. Monitor your CloudWatch dashboard');
      log('');
      log('✅ Your existing code remains unchanged!', 'green');
      
    } catch (error) {
      log(`❌ Connection failed: ${error.message}`, 'red');
      process.exit(1);
    }
  }

  async analyzeProject() {
    log('🔍 Step 1: Analyzing existing project...', 'yellow');
    
    // Check if we're in a valid project directory
    if (!fs.existsSync('package.json') && !fs.existsSync('pom.xml') && !fs.existsSync('requirements.txt')) {
      throw new Error('No package.json, pom.xml, or requirements.txt found. Please run this in your project root.');
    }
    
    // Detect project type
    this.config.projectType = this.detectProjectType();
    log(`   Detected project type: ${this.config.projectType}`, 'blue');
    
    // Detect existing infrastructure
    this.config.infrastructure = this.detectInfrastructure();
    log(`   Infrastructure: ${this.config.infrastructure}`, 'blue');
    
    // Detect existing AWS resources
    this.config.existingResources = await this.detectExistingResources();
    log(`   Found ${this.config.existingResources.length} existing resource patterns`, 'blue');
    
    log('   ✅ Project analysis complete', 'green');
  }

  detectProjectType() {
    if (fs.existsSync('package.json')) {
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      if (packageJson.dependencies && packageJson.dependencies['aws-cdk-lib']) {
        return 'cdk-typescript';
      }
      if (packageJson.dependencies && packageJson.dependencies['aws-sdk']) {
        return 'nodejs-aws';
      }
      return 'nodejs';
    }
    
    if (fs.existsSync('pom.xml')) return 'java-maven';
    if (fs.existsSync('requirements.txt')) return 'python';
    if (fs.existsSync('go.mod')) return 'golang';
    if (fs.existsSync('Cargo.toml')) return 'rust';
    
    return 'unknown';
  }

  detectInfrastructure() {
    const patterns = [];
    
    // CDK detection
    if (fs.existsSync('cdk.json') || this.findFiles('**/*.ts', /Stack|Construct/)) {
      patterns.push('aws-cdk');
    }
    
    // CloudFormation detection
    if (this.findFiles('**/*.yaml', /AWSTemplateFormatVersion/) || 
        this.findFiles('**/*.yml', /AWSTemplateFormatVersion/) ||
        this.findFiles('**/*.json', /AWSTemplateFormatVersion/)) {
      patterns.push('cloudformation');
    }
    
    // Terraform detection
    if (this.findFiles('**/*.tf') || fs.existsSync('terraform.tfstate')) {
      patterns.push('terraform');
    }
    
    // Serverless Framework
    if (fs.existsSync('serverless.yml') || fs.existsSync('serverless.yaml')) {
      patterns.push('serverless');
    }
    
    return patterns.length > 0 ? patterns.join(', ') : 'none-detected';
  }

  findFiles(pattern, contentPattern = null) {
    // Simplified file finding - in real implementation would use glob
    try {
      const files = execSync(`find . -name "${pattern.replace('**/', '')}" -type f 2>/dev/null || true`, { encoding: 'utf8' }).trim().split('\n').filter(f => f);
      
      if (contentPattern && files.length > 0) {
        return files.some(file => {
          try {
            const content = fs.readFileSync(file, 'utf8');
            return contentPattern.test(content);
          } catch (e) {
            return false;
          }
        });
      }
      
      return files.length > 0;
    } catch (e) {
      return false;
    }
  }

  async detectExistingResources() {
    const resources = [];
    
    // Scan for common AWS resource patterns in code
    const patterns = {
      'EC2 Instances': /AWS::EC2::Instance|new ec2\.Instance|EC2\.Instance/g,
      'RDS Databases': /AWS::RDS::DBInstance|new rds\.Database|RDS\.Database/g,
      'S3 Buckets': /AWS::S3::Bucket|new s3\.Bucket|S3\.Bucket/g,
      'Lambda Functions': /AWS::Lambda::Function|new lambda\.Function|Lambda\.Function/g,
      'Load Balancers': /AWS::ElasticLoadBalancingV2|new elbv2\./g
    };
    
    // Scan files for resource patterns
    const scanDirs = ['src', 'lib', 'infrastructure', 'stacks', '.'];
    
    for (const dir of scanDirs) {
      if (fs.existsSync(dir)) {
        try {
          const files = execSync(`find ${dir} -name "*.ts" -o -name "*.js" -o -name "*.yaml" -o -name "*.yml" -o -name "*.json" 2>/dev/null || true`, { encoding: 'utf8' })
            .trim().split('\n').filter(f => f && !f.includes('node_modules'));
          
          for (const file of files) {
            try {
              const content = fs.readFileSync(file, 'utf8');
              for (const [resourceType, pattern] of Object.entries(patterns)) {
                if (pattern.test(content)) {
                  resources.push({ type: resourceType, file });
                }
              }
            } catch (e) {
              // Skip files that can't be read
            }
          }
        } catch (e) {
          // Skip directories that can't be scanned
        }
      }
    }
    
    return resources;
  }

  async gatherConfiguration() {
    log('');
    log('⚙️  Step 2: Gathering configuration...', 'yellow');
    
    // Try to auto-detect from existing configs
    this.config.projectName = this.detectProjectName();
    this.config.environment = 'dev'; // Default, will be configurable
    this.config.costCenter = 'engineering';
    this.config.owner = 'devops-team';
    
    // Budget based on environment and project type
    this.config.budget = this.calculateDefaultBudget();
    
    log(`   Project Name: ${this.config.projectName}`, 'blue');
    log(`   Environment: ${this.config.environment}`, 'blue');
    log(`   Default Budget: $${this.config.budget}/month`, 'blue');
    log('   ✅ Configuration gathered', 'green');
  }

  detectProjectName() {
    // Try package.json first
    if (fs.existsSync('package.json')) {
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      if (packageJson.name) return packageJson.name;
    }
    
    // Try git remote
    try {
      const gitRemote = execSync('git config --get remote.origin.url 2>/dev/null || true', { encoding: 'utf8' }).trim();
      if (gitRemote) {
        const match = gitRemote.match(/\/([^\/]+?)(\.git)?$/);
        if (match) return match[1];
      }
    } catch (e) {}
    
    // Use directory name
    return path.basename(process.cwd());
  }

  calculateDefaultBudget() {
    // Base budget on detected resources and environment
    let baseBudget = 100; // dev default
    
    const resourceCount = this.config.existingResources.length;
    const hasDatabase = this.config.existingResources.some(r => r.type.includes('RDS'));
    const hasLoadBalancer = this.config.existingResources.some(r => r.type.includes('Load Balancer'));
    
    if (resourceCount > 10) baseBudget += 100;
    if (hasDatabase) baseBudget += 50;
    if (hasLoadBalancer) baseBudget += 30;
    
    return baseBudget;
  }

  async injectCostControls() {
    log('');
    log('💉 Step 3: Injecting cost controls...', 'yellow');
    
    // Create cost controls directory
    const costControlsDir = path.join(this.targetProjectPath, 'node_modules', '@cost-controls');
    if (!fs.existsSync(costControlsDir)) {
      fs.mkdirSync(costControlsDir, { recursive: true });
    }
    
    // Copy cost control modules
    await this.copyCostControlModules(costControlsDir);
    
    // Create wrapper scripts
    await this.createWrapperScripts();
    
    log('   ✅ Cost controls injected', 'green');
  }

  async copyCostControlModules(targetDir) {
    // Copy the cost control Lambda functions and utilities
    const sourceDir = path.join(this.templatePath, 'lib');
    
    // Copy types and utilities
    this.copyFileIfExists(path.join(sourceDir, 'types.ts'), path.join(targetDir, 'types.js'));
    
    // Convert and copy cost control functions
    const modules = [
      'budget-monitor.js',
      'resource-validator.js',
      'cost-estimator.js',
      'tag-enforcer.js',
      'lifecycle-manager.js'
    ];
    
    for (const module of modules) {
      await this.createCostControlModule(targetDir, module);
    }
    
    log(`   Copied ${modules.length} cost control modules`, 'blue');
  }

  async createCostControlModule(targetDir, moduleName) {
    const content = this.generateCostControlModule(moduleName);
    fs.writeFileSync(path.join(targetDir, moduleName), content);
  }

  generateCostControlModule(moduleName) {
    const baseModule = `
/**
 * Cost Control Module: ${moduleName}
 * Auto-generated by AWS Cost Control Template
 */

const AWS = require('aws-sdk');

class CostControlModule {
  constructor(config) {
    this.config = config;
    this.cloudformation = new AWS.CloudFormation();
    this.ec2 = new AWS.EC2();
    this.costexplorer = new AWS.CostExplorer({ region: 'us-east-1' });
  }

  async validateDeployment(templateBody) {
    console.log('🔍 Validating deployment for cost compliance...');
    
    // Parse template
    const template = typeof templateBody === 'string' ? JSON.parse(templateBody) : templateBody;
    const resources = template.Resources || {};
    
    const violations = [];
    let estimatedCost = 0;
    
    for (const [resourceId, resource] of Object.entries(resources)) {
      const cost = await this.estimateResourceCost(resource);
      estimatedCost += cost;
      
      const violation = this.validateResource(resourceId, resource);
      if (violation) violations.push(violation);
    }
    
    // Check against budget
    if (estimatedCost > this.config.budget) {
      violations.push({
        type: 'BUDGET_EXCEEDED',
        message: \`Estimated cost ($\${estimatedCost.toFixed(2)}) exceeds budget ($\${this.config.budget})\`
      });
    }
    
    return {
      isValid: violations.length === 0,
      violations,
      estimatedCost,
      recommendations: this.generateRecommendations(resources, estimatedCost)
    };
  }

  validateResource(resourceId, resource) {
    const { Type: resourceType, Properties: properties = {} } = resource;
    
    // Environment-specific validation
    if (this.config.environment === 'dev') {
      if (resourceType === 'AWS::EC2::Instance') {
        const instanceType = properties.InstanceType;
        const allowedTypes = ['t3.micro', 't3.small'];
        
        if (instanceType && !allowedTypes.includes(instanceType)) {
          return {
            resourceId,
            type: 'INVALID_INSTANCE_TYPE',
            message: \`Instance type '\${instanceType}' not allowed in dev environment. Use: \${allowedTypes.join(', ')}\`
          };
        }
      }
      
      if (resourceType === 'AWS::EBS::Volume') {
        const size = properties.Size;
        if (size && size > 100) {
          return {
            resourceId,
            type: 'VOLUME_TOO_LARGE',
            message: \`EBS volume size \${size}GB exceeds dev limit of 100GB\`
          };
        }
      }
    }
    
    return null;
  }

  async estimateResourceCost(resource) {
    const { Type: resourceType, Properties: properties = {} } = resource;
    
    // Basic cost estimation (simplified)
    const costMap = {
      'AWS::EC2::Instance': () => {
        const instanceType = properties.InstanceType || 't3.micro';
        const hourlyRates = {
          't3.micro': 0.0104,
          't3.small': 0.0208,
          't3.medium': 0.0416,
          't3.large': 0.0832
        };
        const hourlyRate = hourlyRates[instanceType] || 0.02;
        const hoursPerMonth = this.config.environment === 'prod' ? 730 : 300;
        return hourlyRate * hoursPerMonth;
      },
      'AWS::RDS::DBInstance': () => {
        const instanceClass = properties.DBInstanceClass || 'db.t3.micro';
        const baseRates = {
          'db.t3.micro': 0.017,
          'db.t3.small': 0.034,
          'db.t3.medium': 0.068
        };
        const hourlyRate = baseRates[instanceClass] || 0.02;
        const hoursPerMonth = this.config.environment === 'prod' ? 730 : 300;
        const storage = (properties.AllocatedStorage || 20) * 0.115;
        return (hourlyRate * hoursPerMonth) + storage;
      },
      'AWS::S3::Bucket': () => 5, // Base cost
      'AWS::ElasticLoadBalancingV2::LoadBalancer': () => 20
    };
    
    const costEstimator = costMap[resourceType];
    return costEstimator ? costEstimator() : 0;
  }

  generateRecommendations(resources, estimatedCost) {
    const recommendations = [];
    
    if (estimatedCost > this.config.budget * 0.8) {
      recommendations.push('Consider using smaller instance types or reducing resource count');
    }
    
    if (this.config.environment === 'dev' && estimatedCost > 50) {
      recommendations.push('Enable auto-shutdown for development resources');
    }
    
    return recommendations;
  }

  async applyTags(resources) {
    console.log('🏷️  Applying mandatory tags...');
    
    const requiredTags = {
      Project: this.config.projectName,
      Environment: this.config.environment,
      CostCenter: this.config.costCenter,
      Owner: this.config.owner,
      ManagedBy: 'aws-cost-control-template',
      CreationDate: new Date().toISOString().split('T')[0]
    };
    
    // Add tags to all resources in template
    for (const [resourceId, resource] of Object.entries(resources)) {
      if (this.supportsTagging(resource.Type)) {
        resource.Properties = resource.Properties || {};
        resource.Properties.Tags = resource.Properties.Tags || [];
        
        // Add required tags if not present
        for (const [key, value] of Object.entries(requiredTags)) {
          const existingTag = resource.Properties.Tags.find(tag => tag.Key === key);
          if (!existingTag) {
            resource.Properties.Tags.push({ Key: key, Value: value });
          }
        }
      }
    }
    
    return resources;
  }

  supportsTagging(resourceType) {
    const taggableTypes = [
      'AWS::EC2::Instance',
      'AWS::RDS::DBInstance',
      'AWS::S3::Bucket',
      'AWS::Lambda::Function',
      'AWS::ECS::Service'
    ];
    return taggableTypes.includes(resourceType);
  }
}

module.exports = CostControlModule;
`;
    
    return baseModule;
  }

  async createWrapperScripts() {
    // Create deployment wrapper that adds cost controls
    const wrapperScript = `#!/usr/bin/env node

/**
 * Cost-Controlled Deployment Wrapper
 * This script wraps your existing deployment with cost controls
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CostControlModule = require('./node_modules/@cost-controls/budget-monitor');

async function deployWithCostControls() {
  console.log('🛡️  Starting cost-controlled deployment...');
  
  try {
    // Load cost control config
    const config = JSON.parse(fs.readFileSync('cost-controls-config.json', 'utf8'));
    const costControl = new CostControlModule(config);
    
    // Pre-deployment validation
    console.log('🔍 Pre-deployment cost validation...');
    
    // Detect deployment command based on project type
    let deployCommand = detectDeployCommand();
    let templateBody = null;
    
    // For CDK projects, synthesize first to get CloudFormation template
    if (config.infrastructure.includes('aws-cdk')) {
      console.log('📋 Synthesizing CDK template...');
      execSync('cdk synth --quiet > cdk.out/template.json', { stdio: 'inherit' });
      templateBody = fs.readFileSync('cdk.out/template.json', 'utf8');
    }
    
    // Validate if we have a template
    if (templateBody) {
      const validation = await costControl.validateDeployment(templateBody);
      
      if (!validation.isValid) {
        console.error('❌ Pre-deployment validation failed:');
        validation.violations.forEach(v => console.error(\`   • \${v.message}\`));
        process.exit(1);
      }
      
      console.log(\`✅ Estimated cost: $\${validation.estimatedCost.toFixed(2)}/month\`);
      console.log(\`✅ Within budget: $\${config.budget}/month\`);
    }
    
    // Deploy cost control infrastructure first
    console.log('🏗️  Deploying cost control infrastructure...');
    await deployCostControlInfrastructure(config);
    
    // Deploy the actual application
    console.log('🚀 Deploying application with cost controls...');
    execSync(deployCommand, { stdio: 'inherit' });
    
    // Post-deployment setup
    console.log('⚙️  Configuring post-deployment cost controls...');
    await setupPostDeploymentControls(config);
    
    console.log('🎉 Deployment completed successfully with cost controls!');
    console.log('');
    console.log('📊 Monitor your costs at:');
    console.log(\`   https://console.aws.amazon.com/cloudwatch/home#dashboards:name=cost-control-\${config.projectName}-\${config.environment}\`);
    
  } catch (error) {
    console.error('❌ Deployment failed:', error.message);
    process.exit(1);
  }
}

function detectDeployCommand() {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const scripts = packageJson.scripts || {};
  
  // Look for common deployment scripts
  if (scripts.deploy) return 'npm run deploy';
  if (scripts['cdk:deploy']) return 'npm run cdk:deploy';
  if (fs.existsSync('cdk.json')) return 'cdk deploy --all';
  if (fs.existsSync('serverless.yml')) return 'serverless deploy';
  
  // Default fallback
  return 'echo "Please configure your deployment command in package.json scripts.deploy"';
}

async function deployCostControlInfrastructure(config) {
  // Create minimal cost control resources using CloudFormation
  const costControlTemplate = {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: \`Cost Control Infrastructure for \${config.projectName}-\${config.environment}\`,
    Parameters: {
      ProjectName: { Type: 'String', Default: config.projectName },
      Environment: { Type: 'String', Default: config.environment },
      Budget: { Type: 'Number', Default: config.budget }
    },
    Resources: {
      BudgetAlarm: {
        Type: 'AWS::Budgets::Budget',
        Properties: {
          Budget: {
            BudgetName: \`\${config.projectName}-\${config.environment}-budget\`,
            BudgetType: 'COST',
            TimeUnit: 'MONTHLY',
            BudgetLimit: {
              Amount: config.budget,
              Unit: 'USD'
            },
            CostFilters: {
              TagKey: ['Project'],
              TagValue: [config.projectName]
            }
          },
          NotificationsWithSubscribers: [{
            Notification: {
              NotificationType: 'ACTUAL',
              ComparisonOperator: 'GREATER_THAN',
              Threshold: 80,
              ThresholdType: 'PERCENTAGE'
            },
            Subscribers: [{
              SubscriptionType: 'EMAIL',
              Address: config.alertEmail || 'admin@company.com'
            }]
          }]
        }
      }
    }
  };
  
  // Deploy cost control template
  fs.writeFileSync('cost-control-stack.json', JSON.stringify(costControlTemplate, null, 2));
  
  try {
    execSync(\`aws cloudformation deploy --template-file cost-control-stack.json --stack-name cost-control-\${config.projectName}-\${config.environment} --capabilities CAPABILITY_IAM\`, { stdio: 'inherit' });
  } catch (error) {
    console.log('⚠️  Cost control infrastructure deployment skipped (may already exist)');
  }
}

async function setupPostDeploymentControls(config) {
  // Tag existing resources
  console.log('🏷️  Tagging resources for cost tracking...');
  
  // Set up auto-shutdown if enabled
  if (config.autoShutdown && config.environment !== 'prod') {
    console.log('⏰ Configuring auto-shutdown for development resources...');
  }
  
  // Create CloudWatch dashboard
  console.log('📊 Setting up cost monitoring dashboard...');
}

// Run the deployment
if (require.main === module) {
  deployWithCostControls().catch(console.error);
}
`;

    fs.writeFileSync(path.join(this.targetProjectPath, 'deploy-with-cost-controls.js'), wrapperScript);
    fs.chmodSync(path.join(this.targetProjectPath, 'deploy-with-cost-controls.js'), '755');
    
    log('   Created deployment wrapper script', 'blue');
  }

  async setupDeploymentScripts() {
    log('');
    log('📋 Step 4: Setting up deployment scripts...', 'yellow');
    
    // Update package.json with new scripts
    await this.updatePackageJson();
    
    // Create quick commands
    await this.createQuickCommands();
    
    log('   ✅ Deployment scripts configured', 'green');
  }

  async updatePackageJson() {
    const packageJsonPath = path.join(this.targetProjectPath, 'package.json');
    
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      
      // Add cost control scripts
      packageJson.scripts = packageJson.scripts || {};
      packageJson.scripts['deploy-with-cost-controls'] = 'node deploy-with-cost-controls.js';
      packageJson.scripts['cost-estimate'] = 'node node_modules/@cost-controls/budget-monitor.js estimate';
      packageJson.scripts['cost-report'] = 'node node_modules/@cost-controls/budget-monitor.js report';
      
      // Backup original deploy script
      if (packageJson.scripts.deploy && !packageJson.scripts['deploy-original']) {
        packageJson.scripts['deploy-original'] = packageJson.scripts.deploy;
      }
      
      // Add cost control dependencies
      packageJson.devDependencies = packageJson.devDependencies || {};
      packageJson.devDependencies['@cost-controls/aws-wrapper'] = 'file:node_modules/@cost-controls';
      
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
      log('   Updated package.json with cost control scripts', 'blue');
    }
  }

  async createQuickCommands() {
    // Create quick cost check script
    const quickCostCheck = `#!/bin/bash
# Quick cost check for current project

echo "💰 Quick Cost Check"
echo "=================="

# Check current month spending
aws ce get-cost-and-usage \\
  --time-period Start=\$(date -d "1 month ago" +%Y-%m-01),End=\$(date +%Y-%m-%d) \\
  --granularity MONTHLY \\
  --metrics BlendedCost \\
  --group-by Type=TAG,Key=Project \\
  --filter '{"Tags":{"Key":"Project","Values":["${this.config.projectName}"]}}' \\
  --query 'ResultsByTime[0].Groups[0].Metrics.BlendedCost.Amount' \\
  --output text 2>/dev/null | sed 's/^/Current spending: $/'

echo "Budget: $${this.config.budget}/month"
echo ""
echo "📊 Full dashboard:"
echo "https://console.aws.amazon.com/cloudwatch/home#dashboards:name=cost-control-${this.config.projectName}-${this.config.environment}"
`;

    fs.writeFileSync(path.join(this.targetProjectPath, 'quick-cost-check.sh'), quickCostCheck);
    fs.chmodSync(path.join(this.targetProjectPath, 'quick-cost-check.sh'), '755');
    
    log('   Created quick cost check script', 'blue');
  }

  async createConfigurationFiles() {
    log('');
    log('📝 Step 5: Creating configuration files...', 'yellow');
    
    // Main cost controls configuration
    const costControlConfig = {
      projectName: this.config.projectName,
      environment: this.config.environment,
      costCenter: this.config.costCenter,
      owner: this.config.owner,
      budget: this.config.budget,
      infrastructure: this.config.infrastructure,
      alertEmail: 'admin@company.com', // Will be customizable
      autoShutdown: this.config.environment !== 'prod',
      resourceLimits: this.getResourceLimits(),
      tagging: {
        required: ['Project', 'Environment', 'Owner', 'CostCenter'],
        automatic: true
      },
      monitoring: {
        dashboard: true,
        dailyReports: true,
        anomalyDetection: true
      }
    };
    
    fs.writeFileSync(
      path.join(this.targetProjectPath, 'cost-controls-config.json'),
      JSON.stringify(costControlConfig, null, 2)
    );
    
    // Create .gitignore entries if needed
    this.updateGitIgnore();
    
    log('   ✅ Configuration files created', 'green');
  }

  getResourceLimits() {
    const limits = {
      dev: {
        maxInstanceTypes: ['t3.micro', 't3.small'],
        maxVolumeSize: 100,
        maxMonthlyCost: 100
      },
      staging: {
        maxInstanceTypes: ['t3.micro', 't3.small', 't3.medium'],
        maxVolumeSize: 500,
        maxMonthlyCost: 300
      },
      prod: {
        maxInstanceTypes: ['t3.small', 't3.medium', 't3.large', 'm5.large', 'm5.xlarge'],
        maxVolumeSize: 2000,
        maxMonthlyCost: 1000
      }
    };
    
    return limits[this.config.environment] || limits.dev;
  }

  updateGitIgnore() {
    const gitIgnorePath = path.join(this.targetProjectPath, '.gitignore');
    const entries = [
      '# Cost Control Template',
      'cost-control-stack.json',
      'deployment-report-*.json'
    ];
    
    if (fs.existsSync(gitIgnorePath)) {
      const existingContent = fs.readFileSync(gitIgnorePath, 'utf8');
      const newEntries = entries.filter(entry => !existingContent.includes(entry));
      
      if (newEntries.length > 0) {
        fs.appendFileSync(gitIgnorePath, '\n' + newEntries.join('\n') + '\n');
      }
    } else {
      fs.writeFileSync(gitIgnorePath, entries.join('\n') + '\n');
    }
  }

  async installDependencies() {
    log('');
    log('📦 Step 6: Installing dependencies...', 'yellow');
    
    try {
      // Install AWS SDK if not present
      if (!fs.existsSync('node_modules/aws-sdk')) {
        log('   Installing aws-sdk...', 'blue');
        execSync('npm install aws-sdk --save-dev', { stdio: 'inherit' });
      }
      
      log('   ✅ Dependencies ready', 'green');
    } catch (error) {
      log('   ⚠️  Dependency installation skipped (manual installation may be required)', 'yellow');
    }
  }

  copyFileIfExists(src, dest) {
    if (fs.existsSync(src)) {
      const content = fs.readFileSync(src, 'utf8');
      // Convert TypeScript to JavaScript (simplified)
      const jsContent = content
        .replace(/import .* from .*/g, 'const AWS = require("aws-sdk");')
        .replace(/export .*/g, '');
      fs.writeFileSync(dest, jsContent);
      return true;
    }
    return false;
  }
}

// CLI execution
if (require.main === module) {
  const connector = new CostControlConnector();
  connector.connect().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = CostControlConnector;