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
      
      // Initialize UI elements
      this.initUIElements();
      this.attachEventListeners();
      this.initCarColorCarousel(); // Add this line
      
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
      
      // Initialize player name with random name
      this.playerNameInput.value = this.playerName;
    }
    
    initPeerJS() {
      // Create a new Peer with a random ID
      this.peer = new Peer();
      
      this.peer.on('open', (id) => {
        this.playerId = id;
        // Store playerId in localStorage so it persists between pages
        localStorage.setItem('myPlayerId', id);
        console.log('My peer ID is: ' + id);
      });
      
      this.peer.on('connection', (conn) => {
        this.handleIncomingConnection(conn);
      });
      
      this.peer.on('error', (err) => {
        console.error('Peer connection error:', err);
        
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
            console.error('Failed to copy: ', err);
          });
      });
      
      // Join party button
      this.joinPartyBtn.addEventListener('click', () => {
        const code = this.joinCodeInput.value.trim().toUpperCase();
        if (code) {
          this.joinParty(code);
        } else {
          this.joinStatus.textContent = 'Please enter a party code';
        }
      });
      
      // Player name input - update player name when changed
      this.playerNameInput.addEventListener('input', () => {
        this.playerName = this.playerNameInput.value.trim() || `Player_${Math.floor(Math.random() * 10000)}`;
        
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
                trackId: 'map1'
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
      
      // Play button - simplify logic to ensure multiplayer when hosting
      this.playBtn.addEventListener('click', () => {
        // If player has entered a name, use it
        if (this.playerNameInput.value.trim()) {
          this.playerName = this.playerNameInput.value.trim();
        }
        
        if (this.isHost) {
          // Host always starts a multiplayer game
          console.log("Starting multiplayer game as host");
          this.startMultiplayerGame();
        } else if (this.hostId) {
          // If in a party but not host, show friendly message
          alert('Only the host can start the race. Wait for the host to begin!');
        } else {
          // Not in a party - start single player game
          console.log("Starting single player game");
          this.startSinglePlayerGame();
        }
      });
    }
    
    createParty() {
      this.isHost = true;
      
      // Hide join section when hosting
      this.joinSection.classList.add('hidden');
      
      // Wait for peer ID to be assigned before creating party
      if (!this.playerId) {
        this.createPartyBtn.textContent = "Initializing...";
        this.createPartyBtn.disabled = true;
        
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
      // Register with backend to get a short code
      fetch('https://mankydanky.pythonanywhere.com/api/party-codes/create/', {
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
        console.log('Party created with code:', data.code);
        
        // Display the short code
        this.partyCodeDisplay.textContent = data.code;
        
        // Show host info
        this.hostInfo.classList.remove('hidden');
        this.createPartyBtn.classList.add('hidden');
        
        // Add host to player list
        this.players = [{
          id: this.playerId,
          name: this.playerName,
          isHost: true
        }];
        
        this.updatePlayerList();
        
        // Enable the play button
        this.playBtn.classList.remove('disabled');
      })
      .catch(error => {
        console.error('Error creating party:', error);
        this.createPartyBtn.textContent = "Create Party";
        this.createPartyBtn.disabled = false;
        alert("Error creating party. Please try again.");
      });
    }
    
    joinParty(code) {
      this.joinStatus.textContent = 'Looking up party...';
      
      // Look up the peer ID from the short code
      fetch(`https://mankydanky.pythonanywhere.com/api/party-codes/lookup/${code}/`)
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
            
            this.joinStatus.textContent = 'Connected to party!';
          });
          
          conn.on('error', (err) => {
            console.error('Connection error:', err);
            this.joinStatus.textContent = 'Error connecting to host.';
          });
        })
        .catch(error => {
          console.error('Error looking up party:', error);
          this.joinStatus.textContent = 'Could not find that party. Check the code and try again.';
        });
    }
    
    handleIncomingConnection(conn) {
      console.log('Incoming connection from:', conn.peer);
      
      // Store the connection
      this.connections.push({
        peerId: conn.peer,
        connection: conn
      });
      
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
      console.log('Received message:', data);
      
      switch(data.type) {
        case 'joinRequest':
          if (this.isHost) {
            // Add new player to the party
            const newPlayer = {
              id: data.playerId,
              name: data.playerName,
              isHost: false,
              playerColor: data.playerColor || 'red' // Save the player's color
            };
            
            this.players.push(newPlayer);
            this.updatePlayerList();
            
            // Send current party state to the new player
            conn.send({
              type: 'partyState',
              players: this.players,
              // Use hardcoded map ID
              trackId: 'map1'
            });
            
            // Notify other players about the new player
            this.broadcastToAll({
              type: 'playerJoined',
              player: newPlayer
            }, conn.peer);
          }
          break;
          
        case 'partyState':
          // Update our local player list
          this.players = data.players;
          this.updatePlayerList();
          break;
          
        case 'playerJoined':
          // Add new player to our list
          this.players.push(data.player);
          this.updatePlayerList();
          break;
          
        case 'startGame':
          // Host has started the game - save config and navigate to game
          sessionStorage.setItem('gameConfig', JSON.stringify(data));
          window.location.href = 'game.html';
          break;
          
        case 'partyEnded':
          alert('The host has ended the party.');
          window.location.reload(); // Reload the page to reset everything
          break;

        case 'playerUpdate':
          if (this.isHost) {
            // Find the player in the list
            const playerIndex = this.players.findIndex(p => p.id === data.playerId);
            if (playerIndex !== -1) {
              // Update player info
              this.players[playerIndex].name = data.playerName;
              this.players[playerIndex].playerColor = data.playerColor;
              
              // Update UI
              this.updatePlayerList();
              
              // Broadcast the updated player list to all players
              this.broadcastToAll({
                type: 'partyState',
                players: this.players,
                trackId: 'map1'
              });
            }
          }
          break;
      }
    }
    
    broadcastToAll(message, excludePeerId = null) {
      console.log('Broadcasting message:', message);
      this.connections.forEach(conn => {
        if (conn.peerId !== excludePeerId) {
          console.log('Broadcasting message to:', conn.peerId);
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
          li.textContent = player.name;
          
          if (player.isHost) {
            const hostBadge = document.createElement('span');
            hostBadge.textContent = 'HOST';
            hostBadge.classList.add('host-badge');
            li.appendChild(hostBadge);
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
          // Use hardcoded map ID
          trackId: 'map1'
        });
      }
    }
    
    startMultiplayerGame() {
      console.log("Creating multiplayer game with players:", this.players);
      
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
      
      const gameConfig = {
        type: 'startGame',
        trackId: 'map1',
        players: this.players,
        multiplayer: true
      };
      
      // Broadcast to all connected players
      this.broadcastToAll({
        type: 'startGame',
        trackId: 'map1',
        players: this.players,
        multiplayer: true
      });
      
      // Save game config to session storage
      sessionStorage.setItem('gameConfig', JSON.stringify(gameConfig));
      console.log("Game config saved:", gameConfig);
      
      // Navigate to game page
      console.log("Navigating to game.html");
      setTimeout(() => {
        // Close all connections after notifying other players
        this.connections.forEach(conn => {
          try {
            conn.connection.close();
          } catch (e) {
            console.log('Error closing connection:', e);
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
      // Create a single player game config
      const gameConfig = {
        type: 'startGame',
        trackId: 'map1',
        players: [{
          id: this.playerId || 'solo-player',
          name: this.playerName,
          isHost: true
        }],
        isSinglePlayer: true
      };
      
      // Save game config to session storage
      sessionStorage.setItem('gameConfig', JSON.stringify(gameConfig));
      
      // Navigate to game page
      window.location.href = 'game.html';
    }
    
    stopHosting() {
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
          console.log('Error closing connection:', e);
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
      this.joinSection.classList.remove('hidden');
      
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
        console.log('Sending update to host:', message);
        hostConnection.connection.send(message);
      } else {
        console.error('No host connection found');
      }
    }
  }
  
  // Initialize the lobby when the page loads
  document.addEventListener('DOMContentLoaded', () => {
    const lobby = new RacingLobby();
  });