const fs = require('fs');

// The corrupted line
const corruptedLine = 'const imageRadius = finalSize / 2;    const compositeRatio = compositeRadius / imageRadius;    const featherStart = Math.max(0, compositeRadius - featherRadius);    const featherStartRatio = featherStart / imageRadius;        const svgMask = ;';

// The fixed lines
const fixedLines = `    const imageRadius = finalSize / 2;
    const compositeRatio = compositeRadius / imageRadius;
    const featherStart = Math.max(0, compositeRadius - featherRadius);
    const featherStartRatio = featherStart / imageRadius;
    
    const svgMask = \`
        <svg width="\${finalSize}" height="\${finalSize}">
            <defs>
                <radialGradient id="feather" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="\${featherStartRatio * 100}%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="\${compositeRatio * 100}%" style="stop-color:white;stop-opacity:0" />
                </radialGradient>
            </defs>
            <circle cx="50%" cy="50%" r="50%" fill="url(#feather)" />
        </svg>
    \`;`;

// Files to fix
const files = [
    '/opt/heliosphere/vps_production_unified.js',
    '/opt/heliosphere/vps_daily_cron_fixed.js'
];

for (const file of files) {
    if (fs.existsSync(file)) {
        let content = fs.readFileSync(file, 'utf8');
        if (content.includes(corruptedLine)) {
            content = content.replace(corruptedLine, fixedLines);
            fs.writeFileSync(file, content);
            console.log(`Fixed: ${file}`);
        } else {
            console.log(`Not corrupted or already fixed: ${file}`);
        }
    }
}