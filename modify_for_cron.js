const fs = require('fs');

// Read the script
let content = fs.readFileSync('/opt/heliosphere/vps_cron_production.js', 'utf8');

// 1. Change from 2 days to 56 days
content = content.replace(
    'const DAYS = 2;',
    'const DAYS = 56;'
);

// 2. Change the title
content = content.replace(
    '2-Day Production Test',
    'Daily Cron Production'
);

// 3. Remove the server setup (port 3002) and replace with direct execution
content = content.replace(
    'const PORT = 3002;',
    '// No server needed for cron'
);

// 4. Add lock file support at the top after imports
const lockCode = `
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

// Insert after imports
content = content.replace(
    'const DAYS = 56;',
    'const DAYS = 56;\n' + lockCode
);

// 5. Remove server endpoints and replace with direct main execution
content = content.replace(/app\.get\('\/monitor'[\s\S]*?app\.listen\(PORT[\s\S]*?\}\);/g, '');
content = content.replace(/app\.get\('\/status'[\s\S]*?\}\);/g, '');

// 6. Add direct execution at the end
content = content + `
// Direct execution for cron
(async () => {
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
    
    try {
        await main();
        console.log('\\n✅ Daily cron production complete!');
        removeLockFile();
        process.exit(0);
    } catch (error) {
        console.error('Error in cron production:', error);
        removeLockFile();
        process.exit(1);
    }
})();
`;

// Write the modified script
fs.writeFileSync('/opt/heliosphere/vps_cron_production.js', content);
console.log('Modified script for cron usage');