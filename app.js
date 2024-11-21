// Global variables
let ws = null;
let serverConnected = false;
let voices = [];
let renderCount = 0;
let itemCount = 0;
let renderID = Math.floor(Math.random() * 0xffff);
let demoCache = {};
let audioBuffers = {};
let zip = new JSZip();

// UI Elements
const serverAddressInput = document.getElementById('serverAddress');
const serverPortInput = document.getElementById('serverPort');
const connectButton = document.getElementById('connectButton');
const connectionStatus = document.getElementById('connectionStatus');
const voicesList = document.getElementById('voicesList');
const quickspeakForm = document.getElementById('quickspeakForm');
const quickspeakInput = document.getElementById('quickspeakInput');
const scriptInput = document.getElementById('scriptInput');
const renderButton = document.getElementById('renderButton');
const statusDisplay = document.getElementById('status');

// Event Listeners
connectButton.addEventListener('click', connectToServer);
quickspeakForm.addEventListener('submit', onQuickspeakSubmit);
renderButton.addEventListener('click', onRenderClick);

// Connect to the server
function connectToServer() {
    const host = serverAddressInput.value.trim();
    const port = serverPortInput.value.trim();

    if (!host || !port) {
        alert('Please enter both server address and port.');
        return;
    }

    const protocol = (location.protocol === 'https:') ? 'wss://' : 'ws://';
    const url = `${protocol}${host}:${port}/`;

    ws = new WebSocket(url);

    ws.binaryType = 'arraybuffer';

    ws.onopen = function () {
        serverConnected = true;
        connectionStatus.textContent = 'Connected to server.';
        ws.send(JSON.stringify({ user: 2 }));
    };

    ws.onmessage = function (event) {
        if (typeof event.data === 'string') {
            handleTextMessage(event.data);
        } else {
            handleBinaryMessage(event.data);
        }
    };

    ws.onclose = function () {
        serverConnected = false;
        connectionStatus.textContent = 'Disconnected from server.';
    };

    ws.onerror = function (error) {
        console.error('WebSocket error:', error);
        serverConnected = false;
        connectionStatus.textContent = 'Error connecting to server.';
    };
}

function handleTextMessage(data) {
    try {
        const msg = JSON.parse(data);
        if (msg.voices) {
            updateVoicesList(msg.voices);
        } else if (msg.warning) {
            displayStatus(`Warning: ${msg.warning}`);
        } else if (msg.error) {
            displayStatus(`Error: ${msg.error}`);
        } else {
            // Handle other messages if necessary
        }
    } catch (e) {
        console.error('Failed to parse message:', e);
    }
}

function handleBinaryMessage(data) {
    const arrayBuffer = data;
    const dataView = new DataView(arrayBuffer);
    const idLength = dataView.getUint16(0, true);
    const idBytes = new Uint8Array(arrayBuffer.slice(2, 2 + idLength));
    const idStr = new TextDecoder().decode(idBytes);
    const audioData = arrayBuffer.slice(2 + idLength);

    const idParts = idStr.split('_');
    if (idParts.length < 3) {
        console.error('Invalid ID format:', idStr);
        return;
    }

    const isRendering = idParts[1] === renderID.toString();
    if (isRendering) {
        renderCount += 1;
        const filename = `${idParts[2]}.wav`;
        zip.file(filename, audioData);

        if (renderCount === itemCount) {
            // All files received, prompt download
            zip.generateAsync({ type: 'blob' }).then(function (content) {
                saveAs(content, 'output.zip');
                // Reset counters and zip
                renderCount = 0;
                itemCount = 0;
                zip = new JSZip();
                displayStatus('Rendering complete. Download started.');
            });
        } else {
            displayStatus(`Rendering... (${renderCount}/${itemCount})`);
        }
    } else {
        // Handle quickspeak audio
        playAudioFromData(audioData);
    }
}

function updateVoicesList(voicesArray) {
    voices = voicesArray;
    voicesList.innerHTML = '';
    voicesList.appendChild(new Option('-- Select a voice --', ''));
    voices.forEach(function (voice) {
        voicesList.appendChild(new Option(voice, voice));
    });
}

function onQuickspeakSubmit(event) {
    event.preventDefault(); // Prevent the form from submitting and refreshing the page

    const text = quickspeakInput.value.trim();
    const voice = voicesList.value;

    if (text && voice) {
        starspeak(`${voice}: ${text}`);
        quickspeakInput.value = ''; // Clear the input field after sending
    } else {
        alert('Please enter text and select a voice.');
    }
}

function starspeak(text) {
    if (!serverConnected) {
        alert('Not connected to the server.');
        return;
    }

    sha256(text).then(function (dataHash) {
        if (demoCache[dataHash]) {
            playAudioFromData(demoCache[dataHash]);
        } else {
            sendRequest(text, false);
        }
    });
}

function sendRequest(text, rendering) {
    if (!serverConnected) {
        alert('Not connected to the server.');
        return;
    }

    if (rendering) {
        itemCount = text.split('\n').filter(line => line.trim() && !line.trim().startsWith(';')).length;
        renderCount = 0;
        renderID = Math.floor(Math.random() * 0xffff); // Reset renderID for each new render
        displayStatus('Rendering started...');
    }

    const requestId = rendering ? renderID.toString() : null;
    const lines = text.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith(';'));

    const message = {
        id: requestId || 'quickspeak',
        user: 2,
        request: lines
    };

    ws.send(JSON.stringify(message));
}

function onRenderClick() {
    const text = scriptInput.value.trim();
    if (text) {
        sendRequest(text, true);
    } else {
        alert('Please enter a script to render.');
    }
}

function playAudioFromData(arrayBuffer) {
    const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play();
}

function displayStatus(message) {
    statusDisplay.textContent = message;
}

// Utility function to compute SHA-256 hash
function sha256(str) {
    const buffer = new TextEncoder('utf-8').encode(str);
    return crypto.subtle.digest('SHA-256', buffer).then(function (hash) {
        return hex(hash);
    });
}

function hex(buffer) {
    const hexCodes = [];
    const view = new DataView(buffer);
    for (let i = 0; i < view.byteLength; i += 4) {
        // Using getUint32 reduces the number of iterations needed (we process 4 bytes each time)
        const value = view.getUint32(i);
        const stringValue = value.toString(16);
        // Pad with zeros
        const padding = '00000000';
        const paddedValue = (padding + stringValue).slice(-padding.length);
        hexCodes.push(paddedValue);
    }
    return hexCodes.join('');
}

// Note: FileSaver.js is included via CDN in the HTML file
// You can use the saveAs function directly
