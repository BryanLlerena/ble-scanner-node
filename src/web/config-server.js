const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.CONFIG_PORT || 3030;
const ENV_FILE = path.join(__dirname, '.env');

app.use(cors());
app.use(express.json());
app.use(express.static('public-config'));

// Helper to parse .env file content manually to preserve approximate structure if possible,
// but for this requirement we will just read key-values
// Helper to parse .env file content manually to preserve comments
function parseEnv(content) {
    const env = [];
    let currentComment = '';

    content.split(/\r?\n/).forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('#')) {
            currentComment = trimmedLine.substring(1).trim();
        } else {
            const match = line.match(/^([^=]+)=(.*)$/);
            if (match) {
                const key = match[1].trim();
                const value = match[2].trim();
                env.push({
                    key,
                    value: value.replace(/^["'](.*)["']$/, '$1'),
                    description: currentComment
                });
                currentComment = ''; // Reset after associating with a key
            }
        }
    });
    return env;
}

// GET /api/env - Read .env file
app.get('/api/env', (req, res) => {
    fs.readFile(ENV_FILE, 'utf8', (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                return res.json({}); // No .env file, return empty object
            }
            return res.status(500).json({ error: 'Failed to read .env file' });
        }
        const envVars = parseEnv(data);
        res.json(envVars);
    });
});

// POST /api/env - Write .env file
app.post('/api/env', (req, res) => {
    // Expecting an array of { key, value, description }
    const changes = req.body; // Array of items

    fs.readFile(ENV_FILE, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to read .env file for updating' });
        }

        let newContent = data;

        // Handle array or object format (just in case)
        const items = Array.isArray(changes)
            ? changes
            : Object.entries(changes).map(([key, value]) => ({ key, value }));

        items.forEach(item => {
            // Regex to find "KEY=value" (handling quotes, whitespace, etc.)
            // Matches start of line or new line, Key, =, then rest of line
            const regex = new RegExp(`^(${item.key})=(.*)$`, 'm');

            if (regex.test(newContent)) {
                newContent = newContent.replace(regex, `$1=${item.value}`);
            } else {
                // If key doesn't exist, append it
                // Check if file ends with newline
                const prefix = newContent.endsWith('\n') ? '' : '\n';
                newContent += `${prefix}${item.key}=${item.value}\n`;
            }
        });

        fs.writeFile(ENV_FILE, newContent, (err) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to save .env file' });
            }
            res.json({ success: true, message: 'Configuration saved' });
        });
    });
});

// POST /api/restart - Restart PM2 processes
app.post('/api/restart', (req, res) => {
    console.log('Restarting processes via PM2...');

    // Reload process via ecosystem.config.js
    // Using 'pm2 reload' or 'pm2 restart' with ecosystem file
    exec('pm2 restart ecosystem.config.js', (error, stdout, stderr) => {
        if (error) {
            console.error(`exec error: ${error}`);
            return res.status(500).json({ error: 'Failed to restart processes', details: stderr });
        }
        console.log(`stdout: ${stdout}`);
        res.json({ success: true, message: 'Processes restarting...' });
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`⚙️ Config Server running at http://0.0.0.0:${PORT}`);
});
