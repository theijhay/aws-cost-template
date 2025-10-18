#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

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

function showUsage() {
  log('🛡️  AWS Cost Control Template', 'cyan');
  log('================================', 'cyan');
  log('');
  log('📋 Usage:', 'yellow');
  log('  npx github:theijhay/aws-cost-template connect    # Connect to existing project');
  log('  npx github:theijhay/aws-cost-template demo       # Show demo examples');
  log('  npx github:theijhay/aws-cost-template --help     # Show this help');
  log('');
  log('🚀 Quick Start:', 'green');
  log('  1. Navigate to your existing AWS project');
  log('  2. Run: npx github:theijhay/aws-cost-template connect');
  log('  3. Deploy with: npm run deploy-with-cost-controls');
  log('');
  log('💡 Example:', 'blue');
  log('  cd my-existing-cdk-project');
  log('  npx github:theijhay/aws-cost-template connect');
  log('  npm run deploy-with-cost-controls');
  log('');
  log('📚 Documentation: https://github.com/theijhay/aws-cost-template');
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  log('🛡️  AWS Cost Control Template v1.0.0', 'cyan');
  log('=====================================', 'cyan');
  log('');

  switch (command) {
    case 'connect':
      log('🔗 Starting project connection...', 'yellow');
      log('');
      
      try {
        // Execute the connection script
        const connectScript = path.join(__dirname, 'scripts', 'connect.js');
        
        if (!fs.existsSync(connectScript)) {
          log('❌ Connection script not found. Please ensure the template is properly installed.', 'red');
          process.exit(1);
        }
        
        // Run the connection script
        execSync(`node "${connectScript}"`, { 
          stdio: 'inherit',
          cwd: process.cwd() 
        });
        
      } catch (error) {
        log('❌ Connection failed:', 'red');
        log(`   ${error.message}`, 'red');
        log('');
        log('💡 Troubleshooting:', 'yellow');
        log('   • Ensure you\'re in an AWS project directory');
        log('   • Check that you have package.json, cdk.json, or similar');
        log('   • Verify AWS CLI is configured');
        process.exit(1);
      }
      break;
      
    case 'demo':
      log('🎬 Running demonstration...', 'yellow');
      log('');
      
      try {
        const demoScript = path.join(__dirname, 'scripts', 'demo.sh');
        
        if (!fs.existsSync(demoScript)) {
          log('❌ Demo script not found.', 'red');
          process.exit(1);
        }
        
        execSync(`bash "${demoScript}"`, { 
          stdio: 'inherit',
          cwd: process.cwd() 
        });
        
      } catch (error) {
        log('❌ Demo failed:', 'red');
        log(`   ${error.message}`, 'red');
        process.exit(1);
      }
      break;
      
    case '--help':
    case '-h':
    case 'help':
      showUsage();
      break;
      
    case undefined:
      log('⚡ No command specified. Defaulting to "connect"...', 'yellow');
      log('');
      
      // Default to connect if no command given
      try {
        const connectScript = path.join(__dirname, 'scripts', 'connect.js');
        
        if (!fs.existsSync(connectScript)) {
          log('❌ Connection script not found.', 'red');
          showUsage();
          process.exit(1);
        }
        
        execSync(`node "${connectScript}"`, { 
          stdio: 'inherit',
          cwd: process.cwd() 
        });
        
      } catch (error) {
        log('❌ Connection failed:', 'red');
        log(`   ${error.message}`, 'red');
        log('');
        showUsage();
        process.exit(1);
      }
      break;
      
    default:
      log(`❌ Unknown command: ${command}`, 'red');
      log('');
      showUsage();
      process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  log('❌ Unhandled Rejection:', 'red');
  log(`   ${reason}`, 'red');
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  log('❌ Uncaught Exception:', 'red');
  log(`   ${error.message}`, 'red');
  process.exit(1);
});

// Run main function
if (require.main === module) {
  main();
}

module.exports = { main, showUsage };