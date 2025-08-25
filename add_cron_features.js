const fs = require('fs');

// Read the base script
let content = fs.readFileSync('/opt/heliosphere/vps_daily_cron_fixed.js', 'utf8');

// 1. Add lock file support
const lockFileCode = `
// Lock file management
const LOCK_FILE = '/opt/heliosphere/production.lock';

function createLockFile() {
    const lockData = {
        pid: process.pid,
        timestamp: Date.now(),
        startTime: new Date().toISOString()
    };
    fs.writeFileSync(LOCK_FILE, JSON.stringify(lockData));
    console.log('Lock file created');
}

function removeLockFile() {
    if (fs.existsSync(LOCK_FILE)) {
        fs.unlinkSync(LOCK_FILE);
        console.log('Lock file removed');
    }
}

function checkLockFile() {
    if (fs.existsSync(LOCK_FILE)) {
        const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
        const lockAge = Date.now() - lockData.timestamp;
        
        // If lock is older than 12 hours, consider it stale
        if (lockAge > 12 * 60 * 60 * 1000) {
            console.log('Removing stale lock file');
            removeLockFile();
            return false;
        }
        
        console.log(\`Process already running (PID: \${lockData.pid}, started: \${lockData.startTime})\`);
        return true;
    }
    return false;
}
`;

// Insert lock file code after imports
content = content.replace(
    'const PRODUCTION_RUN = args.includes(\'--run\');',
    'const PRODUCTION_RUN = args.includes(\'--run\');\n' + lockFileCode
);

// 2. Add lock check at start
const lockCheckCode = `async function main() {
    // Check for existing lock file
    if (checkLockFile()) {
        console.log('Exiting due to existing lock file');
        process.exit(0);
    }
    
    // Create lock file for this run
    createLockFile();
    
    // Ensure lock file is cleaned up on exit
    process.on('exit', removeLockFile);
    process.on('SIGINT', () => {
        removeLockFile();
        process.exit(0);
    });
    process.on('SIGTERM', () => {
        removeLockFile();
        process.exit(0);
    });
`;

content = content.replace(
    'async function main() {',
    lockCheckCode
);

// 3. Change default to 56 days for cron
content = content.replace(
    'const DAYS = args.includes(\'--days\') ? parseInt(args[args.indexOf(\'--days\') + 1]) : 2;',
    'const DAYS = args.includes(\'--days\') ? parseInt(args[args.indexOf(\'--days\') + 1]) : 56;'
);

// 4. Add clean exit after completion
content = content.replace(
    'console.log(\'\\n✅ Daily production complete!\');',
    'console.log(\'\\n✅ Daily production complete!\');\n    removeLockFile();\n    process.exit(0);'
);

// 5. Also clean up lock on any errors
content = content.replace(
    'console.error(\'Error in main:\', error);',
    'console.error(\'Error in main:\', error);\n        removeLockFile();'
);

// Write the modified script
fs.writeFileSync('/opt/heliosphere/vps_daily_cron_fixed.js', content);
console.log('Added cron features to script');