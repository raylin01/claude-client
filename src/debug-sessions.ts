
import { listSessions, escapeProjectPath, getProjectStoragePath } from './sessions.js';
import { existsSync, readdirSync } from 'fs';

const projectPath = '/Users/ray/Documents/DisCode';
console.log('Project Path:', projectPath);

const escaped = escapeProjectPath(projectPath);
console.log('Escaped Path:', escaped);

const storagePath = getProjectStoragePath(projectPath);
console.log('Storage Path:', storagePath);
console.log('Exists:', existsSync(storagePath));

if (existsSync(storagePath)) {
    console.log('Files in storage:', readdirSync(storagePath));
}

console.log('--- Listing Sessions ---');
(async () => {
    try {
        const sessions = await listSessions(projectPath);
        console.log('Session Count:', sessions.length);
        if (sessions.length > 0) {
            console.log('First Session:', sessions[0]);
        } else {
            console.log('No sessions found.');
        }
    } catch (error) {
        console.error('Error listing sessions:', error);
    }
})();
