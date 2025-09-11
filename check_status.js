#!/usr/bin/env node

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const SSH = 'ssh vps';

async function checkStatus() {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║     Heliolens Production Status        ║');
    console.log('╚════════════════════════════════════════╝\n');

    try {
        // Check disk space
        const { stdout: diskSpace } = await execAsync(`${SSH} "df -h / | tail -1"`);
        const diskMatch = diskSpace.match(/(\d+)%/);
        const diskUsage = diskMatch ? parseInt(diskMatch[1]) : 0;
        const diskStatus = diskUsage < 80 ? '✅' : diskUsage < 90 ? '⚠️' : '❌';
        console.log(`${diskStatus} Disk Usage: ${diskUsage}%`);

        // Check if production is running
        const { stdout: processCheck } = await execAsync(`${SSH} "ps aux | grep -E 'vps_daily|vps_production|ffmpeg' | grep -v grep | wc -l"`);
        const processCount = parseInt(processCheck.trim());
        const isRunning = processCount > 0;
        console.log(`${isRunning ? '🔄' : '⏸️'} Production: ${isRunning ? 'Running' : 'Idle'}`);

        // Check latest videos
        const { stdout: latestVideos } = await execAsync(`${SSH} "ls -t /opt/heliosphere/videos/*.mp4 2>/dev/null | head -3"`);
        const videos = latestVideos.trim().split('\n').filter(v => v);
        console.log('\n📹 Latest Videos:');
        videos.forEach(v => {
            const dateMatch = v.match(/(\d{4}-\d{2}-\d{2})/);
            if (dateMatch) {
                console.log(`   • ${dateMatch[1]}`);
            }
        });

        // Check cron job status
        try {
            const { stdout: cronStatus } = await execAsync(`${SSH} "crontab -l | grep cron_production"`);
            if (cronStatus.trim()) {
                console.log(`\n🔧 Cron Job: ✅ Configured`);
                console.log(`   Schedule: Daily at 3:00 AM UTC`);
            }
        } catch (e) {
            console.log(`\n🔧 Cron Job: ❌ Not configured`);
        }

        // Check if FFmpeg is running (video generation)
        const { stdout: ffmpegCheck } = await execAsync(`${SSH} "ps aux | grep ffmpeg | grep -v grep | head -1"`);
        if (ffmpegCheck.trim()) {
            const videoMatch = ffmpegCheck.match(/heliosphere_(\w+)_(\d{4}-\d{2}-\d{2})/);
            if (videoMatch) {
                console.log(`\n🎬 Currently Generating: ${videoMatch[1]} video for ${videoMatch[2]}`);
                
                // Check file size
                const { stdout: fileSize } = await execAsync(`${SSH} "ls -lah /opt/heliosphere/videos/heliosphere_${videoMatch[1]}_${videoMatch[2]}.mp4 2>/dev/null | awk '{print \\$5}'"`);
                if (fileSize.trim() && fileSize.trim() !== '0') {
                    console.log(`   📊 Progress: ${fileSize.trim()}`);
                }
            }
        }

        // Check website status
        try {
            const { stdout: websiteCheck } = await execAsync('curl -s https://heliosphere.pages.dev | grep -o "uploadDate.*2025-[0-9][0-9]-[0-9][0-9]" | head -1');
            const uploadMatch = websiteCheck.match(/(\d{4}-\d{2}-\d{2})/);
            if (uploadMatch) {
                console.log(`\n🌐 Website Updated: ${uploadMatch[1]}`);
            }
        } catch (e) {
            // curl might not be available on Windows
            console.log('\n🌐 Website: Check https://heliosphere.pages.dev');
        }

        // Check for errors in recent logs
        try {
            const { stdout: errorCheck } = await execAsync(`${SSH} "tail -100 /opt/heliosphere/logs/daily_production.log 2>/dev/null | grep -E 'ERROR|Failed|FAILED' | tail -3"`);
            if (errorCheck.trim()) {
                console.log('\n⚠️ Recent Errors:');
                errorCheck.trim().split('\n').forEach(err => {
                    console.log(`   ${err.substring(0, 80)}...`);
                });
            }
        } catch (e) {
            // Log file might not exist yet
        }

        console.log('\n' + '─'.repeat(42));
        
        // Summary
        if (isRunning) {
            console.log('📊 Status: Production is actively running');
        } else if (diskUsage > 80) {
            console.log('⚠️ Status: May need disk cleanup');
        } else {
            console.log('✅ Status: System idle, ready for next run');
        }

    } catch (error) {
        console.error('❌ Error checking status:', error.message);
        console.log('\nTip: Make sure SSH is configured with:');
        console.log('  ssh vps');
    }
}

// Run the check
checkStatus();