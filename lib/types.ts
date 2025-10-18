import { StackProps } from 'aws-cdk-lib';

export interface CostControlStackProps extends StackProps {
  projectName: string;
  environment: string;
  budget: number;
}

export interface TaggingStackProps extends StackProps {
  projectName: string;
  environment: string;
}

export interface BudgetStackProps extends StackProps {
  projectName: string;
  environment: string;
  budget: number;
}

export interface GovernanceStackProps extends StackProps {
  projectName: string;
  environment: string;
}

export interface AutomationStackProps extends StackProps {
  projectName: string;
  environment: string;
}

export interface MonitoringStackProps extends StackProps {
  projectName: string;
  environment: string;
  budget: number;
}

export interface DeploymentSafetyStackProps extends StackProps {
  projectName: string;
  environment: string;
}

export interface ResourceTags {
  Project: string;
  Environment: string;
  CostCenter: string;
  Owner: string;
  AutoShutdown?: string;
  CreationDate: string;
  Version: string;
  ManagedBy: string;
}

export interface EnvironmentConfig {
  maxInstanceTypes: string[];
  maxStorageSize: number;
  allowedRegions: string[];
  restrictedServices: string[];
  autoShutdown: boolean;
  weekendShutdown: boolean;
}

export const ENVIRONMENT_CONFIGS: Record<string, EnvironmentConfig> = {
  dev: {
    maxInstanceTypes: ['t3.micro', 't3.small'],
    maxStorageSize: 100,
    allowedRegions: ['us-east-1', 'us-west-2'],
    restrictedServices: ['redshift', 'memorydb', 'neptune'],
    autoShutdown: true,
    weekendShutdown: true,
  },
  staging: {
    maxInstanceTypes: ['t3.micro', 't3.small', 't3.medium'],
    maxStorageSize: 500,
    allowedRegions: ['us-east-1', 'us-west-2', 'eu-west-1'],
    restrictedServices: ['redshift', 'memorydb'],
    autoShutdown: true,
    weekendShutdown: false,
  },
  prod: {
    maxInstanceTypes: ['t3.small', 't3.medium', 't3.large', 'm5.large', 'm5.xlarge'],
    maxStorageSize: 2000,
    allowedRegions: ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'],
    restrictedServices: [],
    autoShutdown: false,
    weekendShutdown: false,
  },
  qa: {
    maxInstanceTypes: ['t3.micro', 't3.small', 't3.medium'],
    maxStorageSize: 200,
    allowedRegions: ['us-east-1', 'us-west-2'],
    restrictedServices: ['redshift', 'memorydb', 'neptune'],
    autoShutdown: true,
    weekendShutdown: true,
  },
};

export const BUDGET_THRESHOLDS = {
  WARNING: 50,
  CRITICAL: 80,
  EMERGENCY: 100,
};