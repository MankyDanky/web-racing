// Single source of truth for sanitizers (#30) instead of re-declaring them.
import {
  sanitizePlayerName, sanitizePlayerColor, sanitizeTrackId, sanitizePeerId,
} from './modules/sanitize.js';
// Env-driven API base URL + self-hosted broker options (#5) instead of a
// hard-coded backend host / public PeerJS cloud.
import { apiUrl, getPeerOptions } from './modules/netConfig.js';
// Deep-link + QR support (#45).
import { renderQRCanvas } from './modules/qrcode.js';
// Versioned config handoff (#35).
import { buildGameConfig, saveGameConfig } from './modules/gameConfig.js';
// Auto-rejoin after an accidental refresh (#46).
import { saveActiveParty, clearActiveParty, loadActiveParty } from './modules/activeParty.js';
// Gated logging (#10).
import { log, warn, error } from './modules/debug.js';

const MAX_PARTY_SIZE = 8;
const PARTY_CODE_PATTERN = /^[A-Z2-9]{6}$/;

// Class to manage the lobby system
class RacingLobby {
    constructor() {
      this.peer = null;
      this.connections = [];
      this.isHost = false;
      this.hostId = null;
      this.playerId = null;
      this.playerName = `Player_${Math.floor(Math.random() * 10000)}`;
      this.players = [];
      this.lastHeartbeat = {}; // Track when we last received a heartbeat from each player
      this.heartbeatInterval = null; // Store the interval for sending heartbeats
      this.connectionCheckInterval = null; // Store the interval for checking connections
      this.selectedMap = 'map1'; // Default map selection
      this.isReady = false; // Add this line to track player's ready status
      
      // Initialize UI elements
      this.initUIElements();
      this.attachEventListeners();
      this.initCarColorCarousel();
      this.initMapSelector(); // Add this line to initialize the map selector
      
      // Initialize PeerJS
      this.initPeerJS();
    }
    
    initUIElements() {
      // Host elements
      this.createPartyBtn = document.getElementById('create-party-btn');
      this.hostInfo = document.getElementById('host-info');
      this.partyCodeDisplay = document.getElementById('party-code');
      this.copyCodeBtn = document.getElementById('copy-code-btn');
      this.hostStopBtn = document.getElementById('host-stop-btn');
      
      // Add this line to reference the map selector container
      this.mapSelectorContainer = document.querySelector('.map-selector-container');
      
      // Initially disable the map selector for everyone
      this.mapSelectorContainer.classList.add('disabled');
      
      // Center elements
      this.playerNameInput = document.getElementById('player-name-input');
      this.playBtn = document.getElementById('play-btn');
      
      // Join elements
      this.joinCodeInput = document.getElementById('join-code-input');
      this.joinPartyBtn = document.getElementById('join-party-btn');
      this.joinStatus = document.getElementById('join-status');
      this.joinSection = document.querySelector('.join-section');
      
      // Player list
      this.playerList = document.getElementById('player-list');
      
      // Racers panel
      this.racersTitle = document.querySelector('.right-panel .panel-title');
      this.playersContainer = document.querySelector('.players-container');
      
      // Initially hide just the racers title and player list, not the join section
      this.racersTitle.classList.add('hidden');
      this.playersContainer.classList.add('hidden');
      
      // Initialize player name with random name
      this.playerNameInput.value = this.playerName;
    }
    
    initPeerJS() {
      // Use a cryptographically-random UUID as the PeerJS id (#12) instead of a
      // short/sequential/guessable value, and honour a self-hosted broker (#5).
      let requestedId;
      try {
        requestedId = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? `racez-${crypto.randomUUID()}` : undefined;
      } catch (e) { requestedId = undefined; }

      const peerOptions = getPeerOptions();
      if (requestedId) {
        this.peer = peerOptions ? new Peer(requestedId, peerOptions) : new Peer(requestedId);
      } else {
        this.peer = peerOptions ? new Peer(peerOptions) : new Peer();
      }

      this.peer.on('open', (id) => {
        this.playerId = id;
        // Store playerId in localStorage so it persists between pages
        localStorage.setItem('myPlayerId', id);
        log('My peer ID is: ' + id);
      });
      
      this.peer.on('connection', (conn) => {
        this.handleIncomingConnection(conn);
      });
      
      this.peer.on('error', (err) => {
        error('Peer connection error:', err);
        
        if (err.type === 'peer-unavailable') {
          this.joinStatus.textContent = 'Could not find that party. Check the code and try again.';
        } else {
          this.joinStatus.textContent = `Connection error: ${err.type}`;
        }
      });
    }
    
    attachEventListeners() {
      // Create party button
      this.createPartyBtn.addEventListener('click', () => {
        this.createParty();
      });
      
      // Copy code button
      this.copyCodeBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(this.partyCodeDisplay.textContent)
          .then(() => {
            this.copyCodeBtn.textContent = 'Copied!';
            setTimeout(() => this.copyCodeBtn.textContent = 'Copy', 2000);
          })
          .catch(err => {
            error('Failed to copy: ', err);
          });
      });
      
      // Join party button
      this.joinPartyBtn.addEventListener('click', () => {
        const code = this.joinCodeInput.value.trim().toUpperCase();
        if (PARTY_CODE_PATTERN.test(code)) {
          this.joinParty(code);
        } else {
          this.joinStatus.textContent = 'Please enter a valid 6-character party code';
        }
      });
      
      // Player name input - update player name when changed
      this.playerNameInput.addEventListener('input', () => {
        this.playerName = sanitizePlayerName(this.playerNameInput.value, '') || `Player_${Math.floor(Math.random() * 10000)}`;
        
        // Update name in player list if we're in a party
        if (this.players.length > 0) {
          const currentPlayer = this.players.find(p => p.id === this.playerId);
          if (currentPlayer) {
            currentPlayer.name = this.playerName;
            
            // If host, broadcast to all players
            if (this.isHost) {
              this.broadcastToAll({
                type: 'partyState',
                players: this.players,
                trackId: this.selectedMap
              });
            } else if (this.hostId) {
              // If guest, send update to host
              this.sendToHost({
                type: 'playerUpdate',
                playerId: this.playerId,
                playerName: this.playerName,
                playerColor: sessionStorage.getItem('carColor') || 'red'
              });
            }
          }
          this.updatePlayerList();
        }
      });
      
      // Stop hosting button
      this.hostStopBtn.addEventListener('click', () => {
        if (this.isHost) {
          this.stopHosting();
        }
      });
      
      // Play button - modify logic to start multiplayer game without checking ready status
      this.playBtn.addEventListener('click', () => {
        // If player has entered a name, use it
        if (this.playerNameInput.value.trim()) {
          this.playerName = sanitizePlayerName(this.playerNameInput.value);
        }
        
        if (this.isHost) {
          // Host starts a multiplayer game without checking ready status
          log("Starting multiplayer game as host");
          this.startMultiplayerGame();
        } else if (this.hostId) {
          // Toggle ready status when not host
          this.toggleReadyStatus();
        } else {
          // Not in a party - start single player game
          log("Starting single player game");
          this.startSinglePlayerGame();
        }
      });

      // Enable map selection for single player games
      if (!this.isHost && !this.hostId) {
        this.mapSelectorContainer.classList.remove('disabled');
      }
    }
    
    createParty() {
      // Disable button and show loading state immediately
      this.createPartyBtn.textContent = "Creating party...";
      this.createPartyBtn.disabled = true;
      
      this.isHost = true;
      
      // Hide join section when hosting
      this.joinSection.classList.add('hidden');
      
      // Wait for peer ID to be assigned before creating party
      if (!this.playerId) {
        this.createPartyBtn.textContent = "Initializing...";
        
        // Check every 100ms if peer ID is available
        const checkPeerId = setInterval(() => {
          if (this.playerId) {
            clearInterval(checkPeerId);
            this.createPartyWithPeerId();
          }
        }, 100);
        
        return;
      }
      
      this.createPartyWithPeerId();
    }
    
    createPartyWithPeerId() {
      // Update button to show we're communicating with server
      this.createPartyBtn.textContent = "Connecting to server...";
      
      // Register with backend to get a short code
      fetch(apiUrl('/api/party-codes/create/'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          peer_id: this.playerId
        })
      })
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to create party code');
        }
        return response.json();
      })
      .then(data => {
        log('Party created with code:', data.code);
        
        // Display the short code
        this.partyCodeDisplay.textContent = data.code;

        // Show a QR code + deep-link for phone players to scan/tap (#45)
        this.showPartyShare(data.code);

        // Show host info
        this.hostInfo.classList.remove('hidden');
        this.createPartyBtn.classList.add('hidden');
        
        // Show racers panel when hosting (title and player list only)
        this.racersTitle.classList.remove('hidden');
        this.playersContainer.classList.remove('hidden');
        
        // Enable the map selector for host
        this.mapSelectorContainer.classList.remove('disabled');
        
        // Add host to player list
        this.players = [{
          id: this.playerId,
          name: this.playerName,
          isHost: true
        }];
        
        this.updatePlayerList();
        
        // Start heartbeat monitoring
        this.startHeartbeatMonitoring();
        
        // Enable the play button
        this.playBtn.classList.remove('disabled');
      })
      .catch(error => {
        error('Error creating party:', error);
        
        // Reset the button
        this.createPartyBtn.textContent = "Create Party";
        this.createPartyBtn.disabled = false;
        this.isHost = false;
        
        // Show join section again
        this.joinSection.classList.remove('hidden');
        
        // Show error message
        alert("Error creating party. Please try again.");
      });
    }
    
    joinParty(code) {
      this.joinStatus.textContent = 'Looking up party...';
      
      // Look up the peer ID from the short code
      fetch(apiUrl(`/api/party-codes/lookup/${code}/`))
        .then(response => {
          if (!response.ok) {
            throw new Error('Party not found');
          }
          return response.json();
        })
        .then(data => {
          const hostPeerId = data.peer_id;
          this.joinStatus.textContent = 'Connecting to party...';
          
          // Connect to the host using the real peer ID
          const conn = this.peer.connect(hostPeerId);
          
          conn.on('open', () => {
            this.hostId = hostPeerId;

            // Remember this party so an accidental refresh can auto-rejoin (#46).
            saveActiveParty({ code, playerName: this.playerName, role: 'guest' });

            // Show racers panel when joining a party
            this.racersTitle.classList.remove('hidden');
            this.playersContainer.classList.remove('hidden');
            
            // Hide the join party controls
            this.joinSection.classList.add('hidden');
            
            // Ensure map selector remains disabled for non-hosts
            this.mapSelectorContainer.classList.add('disabled');
            
            // Change Play button to Ready button when joining a party
            this.playBtn.textContent = 'Ready Up';
            this.playBtn.classList.add('ready-button');
            
            // Send player info to host with color
            conn.send({
              type: 'joinRequest',
              playerId: this.playerId,
              playerName: this.playerName,
              playerColor: sessionStorage.getItem('carColor') || 'red'
            });
            
            // Store the connection
            this.connections.push({
              peerId: hostPeerId,
              connection: conn
            });
            
            // Handle incoming messages
            conn.on('data', (data) => {
              this.handleMessage(conn, data);
            });
            
            // Handle connection closed - IMPORTANT: Add this handler
            conn.on('close', () => {
              log('Connection to host was closed');
              this.handleHostDisconnection();
            });
            
            // Add error handler to also catch disconnections
            conn.on('error', (err) => {
              error('Connection to host error:', err);
              this.handleHostDisconnection();
            });
            
            // Start heartbeat monitoring
            this.startHeartbeatMonitoring();
            
            this.joinStatus.textContent = 'Connected to party!';
          });
          
          conn.on('error', (err) => {
            error('Connection error:', err);
            this.joinStatus.textContent = 'Error connecting to host.';
          });
        })
        .catch(error => {
          error('Error looking up party:', error);
          this.joinStatus.textContent = 'Could not find that party. Check the code and try again.';
          // If a rejoin attempt (#46) hit a party that no longer exists, drop
          // the stale record so we don't keep retrying on every refresh.
          clearActiveParty();
        });
    }
    
    handleHostDisconnection() {
      // Only process if we're actually in a party
      if (!this.hostId) return;
      
      log('Host has disconnected - leaving party');

      // Nothing to rejoin anymore (#46).
      clearActiveParty();

      // Clear heartbeat intervals
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }
      
      // Reset state
      this.hostId = null;
      this.connections = [];
      this.players = [];
      
      // Update UI
      this.racersTitle.classList.add('hidden');
      this.playersContainer.classList.add('hidden');
      this.joinSection.classList.remove('hidden');
      this.joinStatus.textContent = 'Host disconnected. Party ended.';
      this.joinCodeInput.value = '';
      
      // Re-enable map selection for single-player mode
      this.mapSelectorContainer.classList.remove('disabled');
      
      // Update player list to show no players
      this.updatePlayerList();
    }
    
    leaveParty() {
      // Deliberately leaving - don't auto-rejoin on next load (#46).
      clearActiveParty();

      // Clear heartbeat intervals
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }
      
      if (!this.hostId) return;
      
      // Find the host connection
      const hostConnection = this.connections.find(conn => conn.peerId === this.hostId);
      if (hostConnection && hostConnection.connection) {
        // Notify host that we're leaving
        hostConnection.connection.send({
          type: 'playerLeft',
          playerId: this.playerId
        });
        
        // Close the connection
        try {
          hostConnection.connection.close();
        } catch (e) {
          log('Error closing connection:', e);
        }
      }
      
      // Reset state
      this.hostId = null;
      this.connections = [];
      this.players = [];
      
      // Update UI
      this.racersTitle.classList.add('hidden');
      this.playersContainer.classList.add('hidden');
      this.joinSection.classList.remove('hidden');
      this.joinStatus.textContent = '';
      this.joinCodeInput.value = '';
      
      // Re-enable map selection for single-player mode
      this.mapSelectorContainer.classList.remove('disabled');
      
      // Update player list to show no players
      this.updatePlayerList();
    }
    
    handleIncomingConnection(conn) {
      log('Incoming connection from:', conn.peer);
      
      // Store the connection
      this.connections.push({
        peerId: conn.peer,
        connection: conn
      });
      
      // Initialize heartbeat for this connection
      this.lastHeartbeat[conn.peer] = Date.now();
      
      // Handle incoming messages
      conn.on('data', (data) => {
        this.handleMessage(conn, data);
      });
      
      conn.on('close', () => {
        // Remove player when they disconnect
        this.removePlayer(conn.peer);
      });
    }
    
    handleMessage(conn, data) {
      if (!data || typeof data !== 'object') return;

      log('Received message:', data.type);
      
      // Update last heartbeat time for this connection
      // (fall back to the authenticated peer ID of the connection itself)
      const senderId = sanitizePeerId(data.playerId) || conn.peer;
      this.lastHeartbeat[senderId] = Date.now();
      
      switch(data.type) {
        case 'heartbeat':
          // Just update the timestamp, no further processing needed
          break;
          
        case 'joinRequest':
          if (this.isHost) {
            const requestPeerId = sanitizePeerId(data.playerId);

            // Reject requests whose claimed ID does not match the actual
            // peer connection, or once the party is full
            if (!requestPeerId || requestPeerId !== conn.peer || this.players.length >= MAX_PARTY_SIZE) {
              warn('Rejected invalid join request from:', conn.peer);
              break;
            }

            // Add new player to the party
            const newPlayer = {
              id: requestPeerId,
              name: sanitizePlayerName(data.playerName),
              isHost: false,
              isReady: false, // Initialize as not ready
              playerColor: sanitizePlayerColor(data.playerColor)
            };
            
            // Initialize heartbeat timestamp for this player
            this.lastHeartbeat[data.playerId] = Date.now();
            
            this.players.push(newPlayer);
            this.updatePlayerList();
            
            // Send current party state to the new player
            conn.send({
              type: 'partyState',
              players: this.players,
              trackId: this.selectedMap
            });
            
            // Notify other players about the new player
            this.broadcastToAll({
              type: 'playerJoined',
              player: newPlayer
            }, conn.peer);
          }
          break;
          
        case 'partyState':
          {
            // Rebuild our local player list from the received roster,
            // validating every field before it reaches the UI or gameConfig
            const receivedPlayers = Array.isArray(data.players) ? data.players : [];
            this.players = receivedPlayers
              .map(player => {
                if (!player || typeof player !== 'object') return null;
                const playerId = sanitizePeerId(player.id);
                if (!playerId) return null;
                return {
                  id: playerId,
                  name: sanitizePlayerName(player.name),
                  isHost: player.isHost === true,
                  isReady: player.isReady === true,
                  playerColor: sanitizePlayerColor(player.playerColor)
                };
              })
              .filter(Boolean);
          }
          this.updatePlayerList();
          
          // Check if client should update its own ready status
          if (!this.isHost) {
            const myPlayerInfo = this.players.find(p => p.id === this.playerId);
            if (myPlayerInfo) {
              this.isReady = myPlayerInfo.isReady;
              
              // Update ready button appearance
              if (this.isReady) {
                this.playBtn.textContent = 'Cancel Ready';
                this.playBtn.classList.add('ready-active');
              } else {
                this.playBtn.textContent = 'Ready Up';
                this.playBtn.classList.remove('ready-active');
              }
            }
          }
          
          // Add these lines to update the map when receiving party state
          if (data.trackId) {
            const stateTrackId = sanitizeTrackId(data.trackId);

            if (stateTrackId !== this.selectedMap) {
              this.selectedMap = stateTrackId;

              // Update the UI to show the selected map
              const partyStateDropdownOptions = document.querySelectorAll('.dropdown-option');
              const partyStateSelectedMapName = document.querySelector('.selected-map-name');

              partyStateDropdownOptions.forEach(opt => {
                const mapId = opt.getAttribute('data-map-id');
                if (mapId === stateTrackId) {
                  opt.classList.add('selected');
                  partyStateSelectedMapName.textContent = opt.textContent;
                } else {
                  opt.classList.remove('selected');
                }
              });

              // Dispatch an event to update the background
              document.dispatchEvent(new CustomEvent('mapChanged', {
                detail: { mapId: stateTrackId }
              }));
            }
          }
          break;
          
        case 'playerJoined':
          {
            // Validate the new player entry before adding it to our list
            const joined = (data.player && typeof data.player === 'object') ? data.player : null;
            const joinedId = joined ? sanitizePeerId(joined.id) : null;
            if (!joinedId || this.players.some(p => p.id === joinedId)) break;

            this.players.push({
              id: joinedId,
              name: sanitizePlayerName(joined.name),
              isHost: joined.isHost === true,
              isReady: joined.isReady === true,
              playerColor: sanitizePlayerColor(joined.playerColor)
            });
          }
          this.updatePlayerList();
          break;
          
        case 'startGame':
          {
            // Host has started the game - sanitize the config before saving
            // it, since it will drive UI rendering on the game page
            const players = (Array.isArray(data.players) ? data.players : [])
              .map(player => {
                if (!player || typeof player !== 'object') return null;
                const playerId = sanitizePeerId(player.id);
                if (!playerId) return null;
                return {
                  id: playerId,
                  name: sanitizePlayerName(player.name),
                  isHost: player.isHost === true,
                  isReady: player.isReady === true,
                  playerColor: sanitizePlayerColor(player.playerColor)
                };
              })
              .filter(Boolean);

            saveGameConfig(buildGameConfig({
              trackId: sanitizeTrackId(data.trackId),
              players,
              multiplayer: data.multiplayer === true,
            }));
          }
          // The race is starting - the game page owns state from here, so drop
          // the lobby rejoin record (#46).
          clearActiveParty();
          window.location.href = 'game.html';
          break;
          
        case 'partyEnded':
          alert('The host has ended the party.');
          // Party is gone - don't try to rejoin it after the reload (#46).
          clearActiveParty();
          // Hide only the racers title and player list
          this.racersTitle.classList.add('hidden');
          this.playersContainer.classList.add('hidden');
          window.location.reload(); // Reload the page to reset everything
          break;

        case 'playerUpdate':
          if (this.isHost) {
            // Guests may only update their own player entry - reject
            // attempts to spoof another player's ID
            const updatePeerId = sanitizePeerId(data.playerId);
            if (!updatePeerId || updatePeerId !== conn.peer) break;

            // Find the player in the list
            const playerIndex = this.players.findIndex(p => p.id === updatePeerId);
            if (playerIndex !== -1) {
              // Update player info
              this.players[playerIndex].name = sanitizePlayerName(data.playerName);
              this.players[playerIndex].playerColor = sanitizePlayerColor(data.playerColor);
              
              // Also update ready status if provided in the message
              if (typeof data.isReady !== 'undefined') {
                this.players[playerIndex].isReady = data.isReady;
                log(`Updated player ${data.playerName} ready status: ${data.isReady}`);
              }
              
              // Update UI
              this.updatePlayerList();
              
              // Broadcast the updated player list to all players
              this.broadcastToAll({
                type: 'partyState',
                players: this.players,
                trackId: this.selectedMap
              });
            }
          }
          break;

        case 'playerLeft':
          if (this.isHost) {
            // Remove the player from the list
            this.removePlayer(data.playerId);
            
            // Broadcast updated player list
            this.broadcastToAll({
              type: 'partyState',
              players: this.players,
              trackId: this.selectedMap
            });
          }
          break;

        case 'mapUpdate':
          {
            // Update our selected map (whitelisted - it is used in model URLs)
            const mapUpdateTrackId = sanitizeTrackId(data.trackId);
            this.selectedMap = mapUpdateTrackId;

            // Update the UI to show the selected map
            const dropdownOptions = document.querySelectorAll('.dropdown-option');
            const selectedMapName = document.querySelector('.selected-map-name');

            dropdownOptions.forEach(opt => {
              const mapId = opt.getAttribute('data-map-id');
              if (mapId === mapUpdateTrackId) {
                opt.classList.add('selected');
                selectedMapName.textContent = opt.textContent;
              } else {
                opt.classList.remove('selected');
              }
            });

            // Dispatch an event to update the background
            document.dispatchEvent(new CustomEvent('mapChanged', {
              detail: { mapId: mapUpdateTrackId }
            }));
          }
          break;

        case 'playerReady':
          if (this.isHost) {
            // Find the player in the list
            const playerIndex = this.players.findIndex(p => p.id === data.playerId);
            if (playerIndex !== -1) {
              // Update player ready status
              this.players[playerIndex].isReady = data.isReady;
              
              // Update UI
              this.updatePlayerList();
              
              // Broadcast the updated player list to all players
              this.broadcastToAll({
                type: 'partyState',
                players: this.players,
                trackId: this.selectedMap
              });
            }
          }
          break;

        case 'kicked':
          // Kicked out - don't auto-rejoin (#46).
          clearActiveParty();
          // Reset state and UI
          this.hostId = null;
          this.connections = [];
          this.players = [];
          
          // Update UI
          this.racersTitle.classList.add('hidden');
          this.playersContainer.classList.add('hidden');
          this.joinSection.classList.remove('hidden');
          this.joinStatus.textContent = 'You were kicked from the party.';
          this.joinCodeInput.value = '';
          
          // Remove ready button styling
          this.playBtn.textContent = 'PLAY GAME';
          this.playBtn.classList.remove('ready-button');
          this.playBtn.classList.remove('ready-active');
          
          // Re-enable map selection for single-player mode
          this.mapSelectorContainer.classList.remove('disabled');
          
          // Update player list to show no players
          this.updatePlayerList();
          break;
      }
    }

    toggleReadyStatus() {
      log(`Toggling ready status. Current status: ${this.isReady}`);
      this.isReady = !this.isReady;
      log(`New ready status: ${this.isReady}`);
      
      // Update button text
      if (this.isReady) {
        this.playBtn.textContent = 'Cancel Ready';
        this.playBtn.classList.add('ready-active');
      } else {
        this.playBtn.textContent = 'Ready Up';
        this.playBtn.classList.remove('ready-active');
      }
      
      // Send ready status to host
      const message = {
        type: 'playerReady',
        playerId: this.playerId,
        isReady: this.isReady
      };
      log('Sending ready status to host:', message);
      this.sendToHost(message);
    }
    
    broadcastToAll(message, excludePeerId = null) {
      log('Broadcasting message:', message);
      this.connections.forEach(conn => {
        if (conn.peerId !== excludePeerId) {
          log('Broadcasting message to:', conn.peerId);
          conn.connection.send(message);
        }
      });
    }
    
    updatePlayerList() {
      // Clear existing list
      this.playerList.innerHTML = '';
      
      if (this.players.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No players in party yet';
        li.classList.add('no-players');
        this.playerList.appendChild(li);
      } else {
        this.players.forEach(player => {
          const li = document.createElement('li');
          
          // Create flex container for player info
          li.style.display = 'flex';
          li.style.alignItems = 'center';
          li.style.gap = '8px';
          
          // Add ready status indicator for non-hosts
          if (!player.isHost) {
            const readyStatus = document.createElement('span');
            if (player.isReady) {
              readyStatus.innerHTML = '●'; // White filled circle for ready
              readyStatus.style.color = '#ffffff';
            } else {
              readyStatus.innerHTML = '○'; // Hollow circle for not ready
              readyStatus.style.color = '#888';
            }
            readyStatus.style.fontSize = '18px';
            li.appendChild(readyStatus);
          } else {
            // Add a spacer for host alignment
            const spacer = document.createElement('span');
            spacer.style.width = '12px';
            li.appendChild(spacer);
          }
          
          // Player name
          const nameSpan = document.createElement('span');
          nameSpan.textContent = player.name;
          li.appendChild(nameSpan);
          
          if (player.isHost) {
            const hostBadge = document.createElement('span');
            hostBadge.textContent = 'HOST';
            hostBadge.classList.add('host-badge');
            li.appendChild(hostBadge);
          } 
          // Add kick button for the host to remove other players
          else if (this.isHost && player.id !== this.playerId) {
            const kickButton = document.createElement('button');
            kickButton.textContent = 'KICK';
            kickButton.classList.add('exit-button'); // Reuse the exit button style
            kickButton.addEventListener('click', () => this.kickPlayer(player.id));
            li.appendChild(kickButton);
          }
          // Add exit button for current player if not host
          else if (player.id === this.playerId && !this.isHost) {
            const exitButton = document.createElement('button');
            exitButton.textContent = 'EXIT';
            exitButton.classList.add('exit-button');
            exitButton.addEventListener('click', () => this.leaveParty());
            li.appendChild(exitButton);
          }
          
          this.playerList.appendChild(li);
        });
      }
    }
    
    removePlayer(peerId) {
      // Remove player from list
      this.players = this.players.filter(player => player.id !== peerId);
      this.updatePlayerList();
      
      // Remove connection
      this.connections = this.connections.filter(conn => conn.peerId !== peerId);
      
      // If host, notify others
      if (this.isHost) {
        this.broadcastToAll({
          type: 'partyState',
          players: this.players,
          trackId: this.selectedMap
        });
      }
    }

    kickPlayer(playerId) {
      // Find the player to kick
      const playerToKick = this.players.find(player => player.id === playerId);
      if (!playerToKick) return;
      
      log(`Kicking player: ${playerToKick.name} (${playerId})`);
      
      // Find the connection to this player
      const connectionToKick = this.connections.find(conn => conn.peerId === playerId);
      
      // Notify the player they've been kicked
      if (connectionToKick && connectionToKick.connection) {
        connectionToKick.connection.send({
          type: 'kicked',
          message: 'You have been kicked from the party by the host'
        });
        setTimeout(() => {
          // Close the connection
          try {
            connectionToKick.connection.close();
          } catch (e) {
            log('Error closing connection:', e);
          }
        }, 200);
      }
      
      // Remove the player from the list
      this.removePlayer(playerId);
      
      // Broadcast updated player list to all remaining players
      this.broadcastToAll({
        type: 'partyState',
        players: this.players,
        trackId: this.selectedMap
      });
    }
    
    startMultiplayerGame() {
      log("Creating multiplayer game with players:", this.players);
      
      // Ensure there's at least the host in the players list
      if (this.players.length === 0) {
        this.players = [{
          id: this.playerId,
          name: this.playerName,
          isHost: true,
          playerColor: sessionStorage.getItem('carColor') || 'red'
        }];
      } else {
        // Update the host's color in the players array
        const hostIndex = this.players.findIndex(p => p.id === this.playerId);
        if (hostIndex !== -1) {
          this.players[hostIndex].playerColor = sessionStorage.getItem('carColor') || 'red';
        }
      }
      
      // Versioned, validated config handoff (#35)
      const gameConfig = buildGameConfig({
        trackId: this.selectedMap,
        players: this.players,
        multiplayer: true,
      });

      // Broadcast to all connected players
      this.broadcastToAll({
        type: 'startGame',
        trackId: this.selectedMap, // Use selected map
        players: this.players,
        multiplayer: true
      });

      // Save game config to session storage
      saveGameConfig(gameConfig);
      // The game page takes over now - clear the lobby rejoin record (#46).
      clearActiveParty();
      log("Game config saved:", gameConfig);
      
      // Navigate to game page
      log("Navigating to game.html");
      setTimeout(() => {
        // Close all connections after notifying other players
        this.connections.forEach(conn => {
          try {
            conn.connection.close();
          } catch (e) {
            log('Error closing connection:', e);
          }
        });
        // Close the peer connection
        if (this.peer) {
          this.peer.disconnect();
        }
        window.location.href = 'game.html';
      }, 200);
    }
    
    startSinglePlayerGame() {
      // Versioned, validated single-player config (#35)
      const gameConfig = buildGameConfig({
        trackId: this.selectedMap,
        players: [{
          id: this.playerId || `solo-${Date.now()}`,
          name: this.playerName,
          isHost: true,
          playerColor: sessionStorage.getItem('carColor') || 'red',
        }],
        multiplayer: false,
        isSinglePlayer: true,
      });

      saveGameConfig(gameConfig);
      clearActiveParty(); // (#46)
      window.location.href = 'game.html';
    }
    
    stopHosting() {
      // Host is tearing the party down - no rejoin (#46).
      clearActiveParty();

      // Clear heartbeat intervals
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }
      
      if (this.connectionCheckInterval) {
        clearInterval(this.connectionCheckInterval);
        this.connectionCheckInterval = null;
      }
      
      // Notify all connected players that the party is ending
      this.broadcastToAll({
        type: 'partyEnded',
        message: 'Host has ended the party'
      });
      
      // Close all connections
      this.connections.forEach(conn => {
        try {
          conn.connection.close();
        } catch (e) {
          log('Error closing connection:', e);
        }
      });
      
      // Reset party state
      this.connections = [];
      this.players = [];
      this.isHost = false;
      
      // Reset UI
      this.hostInfo.classList.add('hidden');
      this.createPartyBtn.classList.remove('hidden');
      this.createPartyBtn.disabled = false;
      this.createPartyBtn.textContent = "Create Party";
      this.joinSection.classList.remove('hidden');
      
      // Hide racers title and player list when no longer hosting
      this.racersTitle.classList.add('hidden');
      this.playersContainer.classList.add('hidden');
      
      // Disable map selector when no longer host
      this.mapSelectorContainer.classList.add('disabled');
      
      // Update player list to show no players
      this.updatePlayerList();
      
      // Disconnect and reinitialize peer connection
      if (this.peer) {
        this.peer.disconnect();
        this.initPeerJS();
      }
    }

    initCarColorCarousel() {
      const colorOptions = document.querySelectorAll('.color-option');
      
      // Get the stored color (if any)
      const storedColor = sessionStorage.getItem('carColor') || 'red';
      let foundStoredColor = false;
      
      // Update UI to match stored color
      colorOptions.forEach(option => {
        const optionColor = option.getAttribute('data-color');
        
        // If this is the stored color, mark it as active
        if (optionColor === storedColor) {
          // Remove active class from all options first
          colorOptions.forEach(opt => opt.classList.remove('active'));
          
          // Add active class to this option
          option.classList.add('active');
          foundStoredColor = true;
        }
        
        // Add click event listener
        option.addEventListener('click', () => {
          // Remove active class from all options
          colorOptions.forEach(opt => opt.classList.remove('active'));
          
          // Add active class to clicked option
          option.classList.add('active');
          
          // Get selected color name
          const color = option.getAttribute('data-color');
          
          // Store selected color in session storage
          sessionStorage.setItem('carColor', color);
          
          // If we're in a party as a guest, notify the host
          if (this.hostId && !this.isHost) {
            this.sendToHost({
              type: 'playerUpdate',
              playerId: this.playerId,
              playerName: this.playerName,
              playerColor: color
            });
          }
        });
      });
      
      // If stored color wasn't found in options, default to red
      if (!foundStoredColor) {
        sessionStorage.setItem('carColor', 'red');
        colorOptions[0].classList.add('active');
      }
    }

    setupColorChangeListener() {
      const colorOptions = document.querySelectorAll('.color-option');
      
      colorOptions.forEach(option => {
        option.addEventListener('click', () => {
          // Remove active class from all options
          colorOptions.forEach(opt => opt.classList.remove('active'));
          
          // Add active class to clicked option
          option.classList.add('active');
          
          // Get selected color name
          const color = option.getAttribute('data-color');
          
          // Store selected color in session storage
          sessionStorage.setItem('carColor', color);
          
          // If we're in a party as a guest, notify the host
          if (this.hostId && !this.isHost) {
            this.sendToHost({
              type: 'playerUpdate',
              playerId: this.playerId,
              playerName: this.playerName,
              playerColor: color
            });
          }
        });
      });
    }

    sendToHost(message) {
      const hostConnection = this.connections.find(conn => conn.peerId === this.hostId);
      if (hostConnection && hostConnection.connection) {
        log('Sending update to host:', message);
        hostConnection.connection.send(message);
      } else {
        error('No host connection found');
      }
    }

    startHeartbeatMonitoring() {
      // Only the host needs to check connections
      if (this.isHost) {
        // Host checks if players are still connected every 5 seconds
        this.connectionCheckInterval = setInterval(() => {
          this.checkPlayerConnections();
        }, 5000);
      }
      
      // Everyone sends heartbeats every 3 seconds
      this.heartbeatInterval = setInterval(() => {
        this.sendHeartbeat();
      }, 3000);
    }

    sendHeartbeat() {
      if (this.isHost) {
        // Host broadcasts heartbeat to all clients
        this.broadcastToAll({
          type: 'heartbeat',
          timestamp: Date.now()
        });
      } else if (this.hostId) {
        // Clients only need to send heartbeat to host
        this.sendToHost({
          type: 'heartbeat',
          playerId: this.playerId,
          timestamp: Date.now()
        });
      }
    }

    checkPlayerConnections() {
      if (!this.isHost) return;
      
      const now = Date.now();
      const timeoutThreshold = 5000;
      
      // Get list of disconnected players
      const disconnectedPlayers = this.players.filter(player => {
        // Skip ourselves (the host)
        if (player.id === this.playerId) return false;
        
        // Check if this player has sent a heartbeat recently
        const lastBeat = this.lastHeartbeat[player.id] || 0;
        return (now - lastBeat) > timeoutThreshold;
      });
      
      // Remove any disconnected players
      disconnectedPlayers.forEach(player => {
        log(`Player ${player.name} (${player.id}) timed out - removing from party`);
        this.removePlayer(player.id);
      });
    }

    // Render a QR code + copyable deep-link so phone players can join fast (#45).
    showPartyShare(code) {
      let container = document.getElementById('party-share');
      if (!container) {
        container = document.createElement('div');
        container.id = 'party-share';
        Object.assign(container.style, {
          marginTop: '12px', textAlign: 'center', display: 'flex',
          flexDirection: 'column', alignItems: 'center', gap: '6px',
        });
        // Insert into the host info block.
        const codeDisplayParent = this.partyCodeDisplay?.closest('.code-display') || this.hostInfo;
        if (codeDisplayParent) codeDisplayParent.appendChild(container);
      }
      container.replaceChildren();

      const url = `${window.location.origin}${window.location.pathname}?party=${code}`;

      const qr = renderQRCanvas(url, 4, 3);
      qr.style.borderRadius = '8px';
      qr.style.background = '#fff';
      qr.style.padding = '4px';
      container.appendChild(qr);

      const hint = document.createElement('div');
      hint.textContent = 'Scan to join on your phone';
      hint.style.fontSize = '12px';
      hint.style.opacity = '0.85';
      container.appendChild(hint);

      const linkBtn = document.createElement('button');
      linkBtn.className = 'icon-btn';
      linkBtn.textContent = 'Copy invite link';
      linkBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(url).then(() => {
          linkBtn.textContent = 'Link copied!';
          setTimeout(() => { linkBtn.textContent = 'Copy invite link'; }, 2000);
        }).catch(() => {});
      });
      container.appendChild(linkBtn);
    }

    // Connect to a party code once our peer id is ready, retrying briefly while
    // PeerJS negotiates our id. Shared by deep-link (#45) and rejoin (#46).
    joinPartyWhenReady(code, attemptsLeft = 40) {
      if (this.joinCodeInput) this.joinCodeInput.value = code;
      const attempt = (left) => {
        if (this.playerId) {
          this.joinParty(code);
        } else if (left > 0) {
          setTimeout(() => attempt(left - 1), 150);
        }
      };
      attempt(attemptsLeft);
    }

    // Auto-join a party from a ?party=CODE deep link (#45).
    // Returns true when a deep link was present (so callers can skip rejoin).
    tryDeepLinkJoin() {
      try {
        const params = new URLSearchParams(window.location.search);
        const raw = (params.get('party') || '').trim().toUpperCase();
        if (PARTY_CODE_PATTERN.test(raw)) {
          this.joinPartyWhenReady(raw);
          return true;
        }
      } catch (e) { /* ignore */ }
      return false;
    }

    // After an accidental refresh, silently rejoin the party we were in (#46).
    // Only guests auto-rejoin: a host that refreshed gets a new peer id, which
    // orphans the old code, so we don't try to resurrect a host session.
    tryRejoinActiveParty() {
      let record;
      try {
        record = loadActiveParty();
      } catch (e) {
        record = null;
      }
      if (!record || record.role !== 'guest') {
        // Stale/host record: make sure it can't linger.
        if (record) clearActiveParty();
        return false;
      }

      // Restore the player's chosen name before reconnecting.
      if (record.playerName) {
        this.playerName = record.playerName;
        if (this.playerNameInput) this.playerNameInput.value = record.playerName;
      }

      if (this.joinStatus) this.joinStatus.textContent = 'Reconnecting to your party...';
      this.joinPartyWhenReady(record.code);
      return true;
    }

    initMapSelector() {
      const mapDropdown = document.querySelector('.map-dropdown');
      const dropdownButton = document.querySelector('.dropdown-button');
      const selectedMapName = document.querySelector('.selected-map-name');
      const dropdownOptions = document.querySelectorAll('.dropdown-option');
      
      // Initialize selected map from the HTML structure
      dropdownOptions.forEach(option => {
        if (option.classList.contains('selected')) {
          this.selectedMap = option.getAttribute('data-map-id');
          selectedMapName.textContent = option.textContent;
        }
      });
      
      // Toggle dropdown open/close when button is clicked
      dropdownButton.addEventListener('click', (event) => {
        event.stopPropagation();
        mapDropdown.classList.toggle('open');
      });
      
      // Close dropdown when clicking outside
      document.addEventListener('click', () => {
        mapDropdown.classList.remove('open');
      });
      
      // Handle option selection
      dropdownOptions.forEach(option => {
        option.addEventListener('click', (event) => {
          event.stopPropagation();
          const mapId = option.getAttribute('data-map-id');
          
          // Update selected option
          dropdownOptions.forEach(opt => opt.classList.remove('selected'));
          option.classList.add('selected');
          
          // Update button text
          selectedMapName.textContent = option.textContent;
          
          // Store selected map
          this.selectedMap = mapId;
          
          // Close dropdown
          mapDropdown.classList.remove('open');
          
          // Dispatch an event to update the background
          document.dispatchEvent(new CustomEvent('mapChanged', {
            detail: { mapId: mapId }
          }));
          
          // If host, broadcast to all players
          if (this.isHost) {
            this.broadcastToAll({
              type: 'mapUpdate',
              trackId: mapId
            });
          }
        });
      });
    }
  }
  
  // Initialize the lobby when the page loads
  document.addEventListener('DOMContentLoaded', () => {
    const lobby = new RacingLobby();

    // Auto-join from ?party=CODE deep links / QR scans (#45), otherwise try to
    // rejoin a party we were in before an accidental refresh (#46).
    const deepLinked = lobby.tryDeepLinkJoin();
    if (!deepLinked) lobby.tryRejoinActiveParty();

    // Check for orientation changes
    window.addEventListener('orientationchange', handleOrientationChange);
    window.addEventListener('resize', handleOrientationChange);

    // Tap-to-rotate: fullscreen + landscape lock from the overlay button.
    setupRotateButton();

    // Initial check
    handleOrientationChange();
    
    // Info popup functionality
    const infoBtn = document.getElementById('info-btn');
    const infoPopup = document.getElementById('info-popup');
    const closeInfoBtn = document.getElementById('close-info-btn');
    
    if (infoBtn && infoPopup && closeInfoBtn) {
      // Open popup when info button is clicked
      infoBtn.addEventListener('click', () => {
        infoPopup.classList.remove('hidden');
      });
      
      // Close popup when close button is clicked
      closeInfoBtn.addEventListener('click', () => {
        infoPopup.classList.add('hidden');
      });
      
      // Also close popup when clicking on the overlay
      infoPopup.addEventListener('click', (event) => {
        if (event.target === infoPopup || event.target.classList.contains('info-overlay')) {
          infoPopup.classList.add('hidden');
        }
      });
      
      // Close popup with Escape key
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !infoPopup.classList.contains('hidden')) {
          infoPopup.classList.add('hidden');
        }
      });
    }
  });

  // Tap-to-rotate: request fullscreen then lock to landscape (must be from a
  // user gesture; feature-detected and degrades gracefully).
  async function forceLandscapeRotation() {
    try {
      const docEl = document.documentElement;
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        const req = docEl.requestFullscreen || docEl.webkitRequestFullscreen || docEl.msRequestFullscreen;
        if (req) { try { await req.call(docEl); } catch (e) { /* denied; continue */ } }
      }
      if (screen.orientation && typeof screen.orientation.lock === 'function') {
        for (const mode of ['landscape', 'landscape-primary', 'landscape-secondary']) {
          try { await screen.orientation.lock(mode); break; } catch (e) { /* next */ }
        }
      }
    } catch (e) { /* ignore */ }
    handleOrientationChange();
  }

  function setupRotateButton() {
    const rotateMessage = document.getElementById('rotate-message');
    const btn = document.getElementById('rotate-tap-btn');
    if (!rotateMessage) return;
    const trigger = (e) => { if (e) { e.preventDefault(); e.stopPropagation(); } forceLandscapeRotation(); };
    if (btn) {
      btn.addEventListener('click', trigger);
      btn.addEventListener('touchend', trigger, { passive: false });
    }
    rotateMessage.addEventListener('click', (e) => {
      if (btn && (e.target === btn || btn.contains(e.target))) return;
      trigger(e);
    });
  }

  // Function to handle orientation changes
  function handleOrientationChange() {
    const rotateMessage = document.getElementById('rotate-message');
    const gameContainer = document.querySelector('.game-container');
    
    if (window.innerHeight > window.innerWidth) {
      // Portrait mode
      if (rotateMessage) rotateMessage.style.display = 'flex';
      if (gameContainer) gameContainer.style.display = 'none';
    } else {
      // Landscape mode
      if (rotateMessage) rotateMessage.style.display = 'none';
      if (gameContainer) gameContainer.style.display = 'flex';
    }
  }