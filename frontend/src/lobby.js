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
      
      // Initialize PeerJS
      this.initPeerJS();
    }
    
    initUIElements() {
      // Host elements
      this.createPartyBtn = document.getElementById('create-party-btn');
      this.hostInfo = document.getElementById('host-info');
      this.partyCodeDisplay = document.getElementById('party-code');
      this.copyCodeBtn = document.getElementById('copy-code-btn');
      this.trackSelect = document.getElementById('track-select');
      
      // Join elements
      this.joinCodeInput = document.getElementById('join-code-input');
      this.joinPartyBtn = document.getElementById('join-party-btn');
      this.joinStatus = document.getElementById('join-status');
      
      // Player list
      this.playerList = document.getElementById('player-list');
      
      // Play button
      this.playBtn = document.getElementById('play-btn');
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
      
      // Play button
      this.playBtn.addEventListener('click', () => {
        if (this.playBtn.classList.contains('disabled')) return;
        
        // If we're the host, notify all players to start the game
        if (this.isHost) {
          const gameConfig = {
            type: 'startGame',
            trackId: this.trackSelect.value,
            players: this.players
          };
          
          this.broadcastToAll(gameConfig);
          
          // Save game config to session storage
          sessionStorage.setItem('gameConfig', JSON.stringify(gameConfig));
          
          // Close all connections to free up the ID
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
          
          // Wait a moment for connections to close before navigating
          setTimeout(() => {
            window.location.href = 'game.html';
          }, 500);
        }
      });
    }
    
    createParty() {
      this.isHost = true;
      
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
      this.createPartyBtn.textContent = "Creating party...";
      
      // Register with backend to get a short code
      fetch('http://localhost:8000/api/party-codes/create/', {
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
      fetch(`http://localhost:8000/api/party-codes/lookup/${code}/`)
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
            
            // Send player info to host
            conn.send({
              type: 'joinRequest',
              playerId: this.playerId,
              playerName: this.playerName
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
              isHost: false
            };
            
            this.players.push(newPlayer);
            this.updatePlayerList();
            
            // Send current party state to the new player
            conn.send({
              type: 'partyState',
              players: this.players,
              trackId: this.trackSelect.value
            });
            
            // Notify other players about the new player
            this.broadcastToAll({
              type: 'playerJoined',
              player: newPlayer
            }, conn.peer); // Don't send to the player who just joined
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
      }
    }
    
    broadcastToAll(message, excludePeerId = null) {
      this.connections.forEach(conn => {
        if (conn.peerId !== excludePeerId) {
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
          trackId: this.trackSelect.value
        });
      }
    }
  }
  
  // Initialize the lobby when the page loads
  document.addEventListener('DOMContentLoaded', () => {
    const lobby = new RacingLobby();
  });