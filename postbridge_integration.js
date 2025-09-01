#!/usr/bin/env node

/**
 * PostBridge Integration for Heliolens
 * 
 * Handles automated social media posting through PostBridge API
 * 
 * Built with AI + Vibes | www.builtbyvibes.com | @builtbyvibes
 */

import fs from 'fs/promises';
import fetch from 'node-fetch';
import FormData from 'form-data';
import dotenv from 'dotenv';

dotenv.config();

const POSTBRIDGE_CONFIG = {
    API_URL: 'https://api.post-bridge.com/v1',
    API_KEY: process.env.POSTBRIDGE_API_KEY,
    PLATFORMS: ['twitter', 'instagram', 'tiktok', 'youtube_shorts']
};

/**
 * Create a new post on PostBridge
 */
export async function createPost(videoPath, options = {}) {
    const {
        caption = generateCaption(),
        platforms = POSTBRIDGE_CONFIG.PLATFORMS,
        schedule = 'immediate',
        hashtags = ['#Heliolens', '#SolarActivity', '#SpaceWeather', '#NASA', '#BuiltByVibes'],
        metadata = {}
    } = options;
    
    if (!POSTBRIDGE_CONFIG.API_KEY) {
        throw new Error('PostBridge API key not configured in .env file');
    }
    
    console.log('📤 Creating PostBridge post...');
    
    try {
        // Read video file
        const videoBuffer = await fs.readFile(videoPath);
        const stats = await fs.stat(videoPath);
        
        // Create form data
        const formData = new FormData();
        formData.append('video', videoBuffer, {
            filename: 'heliolens_social.mp4',
            contentType: 'video/mp4'
        });
        formData.append('caption', caption);
        formData.append('hashtags', JSON.stringify(hashtags));
        formData.append('platforms', JSON.stringify(platforms));
        formData.append('schedule', schedule);
        formData.append('metadata', JSON.stringify({
            ...metadata,
            source: 'Heliolens',
            version: '2.0',
            generatedAt: new Date().toISOString()
        }));
        
        // Send request
        const response = await fetch(`${POSTBRIDGE_CONFIG.API_URL}/posts`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${POSTBRIDGE_CONFIG.API_KEY}`,
                ...formData.getHeaders()
            },
            body: formData
        });
        
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`PostBridge API error: ${response.status} - ${error}`);
        }
        
        const result = await response.json();
        
        console.log('✅ Post created successfully');
        console.log(`   Post ID: ${result.id}`);
        console.log(`   Status: ${result.status}`);
        console.log(`   Platforms: ${result.platforms.join(', ')}`);
        
        return result;
        
    } catch (error) {
        console.error('❌ PostBridge error:', error.message);
        throw error;
    }
}

/**
 * Generate caption for the post
 */
export function generateCaption(customDate = null) {
    const date = customDate || new Date();
    const dateStr = date.toLocaleDateString('en-US', { 
        month: 'long', 
        day: 'numeric', 
        year: 'numeric' 
    });
    
    const captions = [
        `☀️ HELIOLENS Daily Solar Update - ${dateStr}

Watch 30 days of our Sun's corona in stunning detail. Real NASA satellite imagery showing solar flares, coronal mass ejections, and the ever-changing solar atmosphere.

🛰️ Data: SOHO/LASCO + SDO/AIA
🎬 5,760 frames @ 24fps
🌟 Updated daily with latest solar activity

Built with AI + Vibes
www.builtbyvibes.com | @builtbyvibes`,

        `🌟 Today's Solar Activity Report

The Sun never sleeps! Here's 30 days of solar dynamics compressed into 2 minutes. Watch massive plasma loops, explosive flares, and the mesmerizing dance of our star's corona.

📊 Current solar cycle: Active
🔭 Captured by NASA satellites
⚡ Real-time space weather

HELIOLENS - Your window to the Sun
Built by @builtbyvibes`,

        `🔥 Solar Corona Timelapse

Witness the raw power of our star! This isn't CGI - it's real NASA satellite data showing the Sun's million-degree atmosphere over the past 30 days.

What you're seeing:
• Coronal mass ejections
• Solar flares
• Plasma loops
• Solar wind streams

Built with love, AI, and vibes ✨
www.builtbyvibes.com`
    ];
    
    // Rotate through captions
    const captionIndex = date.getDate() % captions.length;
    return captions[captionIndex];
}

/**
 * Schedule a post for a specific time
 */
export async function schedulePost(videoPath, scheduleTime, options = {}) {
    const scheduledOptions = {
        ...options,
        schedule: scheduleTime.toISOString()
    };
    
    return createPost(videoPath, scheduledOptions);
}

/**
 * Get post status
 */
export async function getPostStatus(postId) {
    if (!POSTBRIDGE_CONFIG.API_KEY) {
        throw new Error('PostBridge API key not configured');
    }
    
    try {
        const response = await fetch(`${POSTBRIDGE_CONFIG.API_URL}/posts/${postId}`, {
            headers: {
                'Authorization': `Bearer ${POSTBRIDGE_CONFIG.API_KEY}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to get post status: ${response.statusText}`);
        }
        
        return await response.json();
        
    } catch (error) {
        console.error('❌ Error getting post status:', error.message);
        throw error;
    }
}

/**
 * Delete a post
 */
export async function deletePost(postId) {
    if (!POSTBRIDGE_CONFIG.API_KEY) {
        throw new Error('PostBridge API key not configured');
    }
    
    try {
        const response = await fetch(`${POSTBRIDGE_CONFIG.API_URL}/posts/${postId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${POSTBRIDGE_CONFIG.API_KEY}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to delete post: ${response.statusText}`);
        }
        
        console.log(`✅ Post ${postId} deleted successfully`);
        return true;
        
    } catch (error) {
        console.error('❌ Error deleting post:', error.message);
        throw error;
    }
}

/**
 * Test PostBridge connection
 */
export async function testConnection() {
    if (!POSTBRIDGE_CONFIG.API_KEY) {
        console.error('❌ PostBridge API key not configured in .env file');
        console.log('   Add POSTBRIDGE_API_KEY=your_key_here to your .env file');
        return false;
    }
    
    try {
        const response = await fetch(`${POSTBRIDGE_CONFIG.API_URL}/auth/verify`, {
            headers: {
                'Authorization': `Bearer ${POSTBRIDGE_CONFIG.API_KEY}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log('✅ PostBridge connection successful');
            console.log(`   Account: ${data.account}`);
            console.log(`   Platforms: ${data.platforms.join(', ')}`);
            return true;
        } else {
            console.error('❌ PostBridge authentication failed');
            return false;
        }
    } catch (error) {
        console.error('❌ PostBridge connection error:', error.message);
        return false;
    }
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
    const command = process.argv[2];
    
    switch (command) {
        case 'test':
            testConnection();
            break;
            
        case 'post':
            const videoPath = process.argv[3];
            if (!videoPath) {
                console.error('Usage: node postbridge_integration.js post <video_path>');
                process.exit(1);
            }
            createPost(videoPath).catch(console.error);
            break;
            
        case 'status':
            const postId = process.argv[3];
            if (!postId) {
                console.error('Usage: node postbridge_integration.js status <post_id>');
                process.exit(1);
            }
            getPostStatus(postId).then(console.log).catch(console.error);
            break;
            
        default:
            console.log(`
Heliolens PostBridge Integration

Usage:
  node postbridge_integration.js test              - Test connection
  node postbridge_integration.js post <video>      - Create a post
  node postbridge_integration.js status <post_id>  - Get post status

Built with AI + Vibes | www.builtbyvibes.com
            `);
    }
}