"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sessions_js_1 = require("./sessions.js");
const fs_1 = require("fs");
const projectPath = '/Users/ray/Documents/DisCode';
console.log('Project Path:', projectPath);
const escaped = (0, sessions_js_1.escapeProjectPath)(projectPath);
console.log('Escaped Path:', escaped);
const storagePath = (0, sessions_js_1.getProjectStoragePath)(projectPath);
console.log('Storage Path:', storagePath);
console.log('Exists:', (0, fs_1.existsSync)(storagePath));
if ((0, fs_1.existsSync)(storagePath)) {
    console.log('Files in storage:', (0, fs_1.readdirSync)(storagePath));
}
console.log('--- Listing Sessions ---');
(async () => {
    try {
        const sessions = await (0, sessions_js_1.listSessions)(projectPath);
        console.log('Session Count:', sessions.length);
        if (sessions.length > 0) {
            console.log('First Session:', sessions[0]);
        }
        else {
            console.log('No sessions found.');
        }
    }
    catch (error) {
        console.error('Error listing sessions:', error);
    }
})();
